/*
 * ニコ生ゲーム (akashic) の実行ホスト。AkashicLayer が iframe (sandbox, srcdoc) の中で実行する。
 *
 * 公式プレイヤー (nicolib の AkashicClient / AkashicGameView) と同じ手順で、公式 CDN のランタイムと
 * ゲーム (土台の nicocas と、クルーズなどの子ゲーム) をそのまま動かす最小限の再現。
 *  - root (nicocas) を起動し、mpn の akashic_state を `[32, 2, ":akashic", payload]` として注入する
 *  - 子ゲームは root が external.coe.startSession を呼んだときに起動する
 *  - external.api (投票・フォローなどの HTTP) は親ウィンドウ経由で main が Cookie 付きで代理送信する
 *
 * 親とは postMessage で話す。
 *   親 → 本体: init / batch / apiRes / volume
 *   本体 → 親: ready / api / open / active / pointer / log
 * ES モジュールではなく単体のスクリプトとして srcdoc に埋め込むため、import は使わない。
 */
(() => {
  'use strict';

  /** 子ゲームとして実行を許すのは公式のゲーム配信元だけ (embedded-data の trustedChildOrigin と同じ) */
  const TRUSTED_URL = /^https:\/\/resource\.akashic\.coe\.nicovideo\.jp\//;
  /** 土台のゲーム (nicocas) の版。公式 (usecase) もこの値を固定で使っている */
  const NICOCAS_VERSION = '5.0.2.0';
  const FRONTEND = { frontendId: 9, frontendVersion: '657.0.0' };
  /** 公式の changeMasterVolume は最大音量を 0.4 倍にしている */
  const MAX_VOLUME = 0.4;

  const post = (m) => parent.postMessage(m, '*');
  const log = (level, msg, data) => post({ t: 'log', level, msg, data: data === undefined ? undefined : safeJson(data) });
  function safeJson(o) {
    try {
      return JSON.stringify(o).slice(0, 500);
    } catch (e) {
      return String(o);
    }
  }
  window.addEventListener('error', (e) => log('error', 'window.error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => log('error', 'unhandledrejection: ' + String(e.reason)));

  let init = null; // 親からの init
  let masterVolume = 0;
  let lastEpoch = -1;
  let rootReady = false;
  const pendingBatches = [];

  // ---------- script / runtime ----------
  const scriptCache = new Map();
  function loadScript(url) {
    if (!TRUSTED_URL.test(url)) return Promise.reject(new Error('untrusted script url: ' + url));
    if (!scriptCache.has(url)) {
      scriptCache.set(
        url,
        new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = url;
          s.async = false;
          s.onload = () => res();
          s.onerror = () => rej(new Error('script load failed: ' + url));
          document.head.appendChild(s);
        })
      );
    }
    return scriptCache.get(url);
  }
  const isEngineUrl = (u) => /.*\/engineFilesV.*\.js$/.test(u);
  function detectRuntimes(urls) {
    const eu = urls.find(isEngineUrl);
    const m = eu && eu.match(/.*\/(engineFilesV.*)\.js$/);
    const o = m && window[m[1]];
    if (!o) throw new Error('engineFiles global not found for ' + eu);
    return { GameDriver: o.gameDriver, PdiBrowser: o.pdiBrowser, globalName: m[1] };
  }

  // ---------- レイアウト (nicolib calcAspectFitLayout) ----------
  function viewSize() {
    return { w: document.documentElement.clientWidth || 1, h: document.documentElement.clientHeight || 1 };
  }
  function calcAspectFit(outerW, outerH, natW, natH) {
    const s = Math.min(outerW / natW, outerH / natH);
    const w = natW * s;
    const h = natH * s;
    return { x: (outerW - w) / 2, y: (outerH - h) / 2, width: w, height: h };
  }

  // ---------- ホスト plugin (external.*) ----------
  const apiPending = new Map();
  let apiSeq = 0;
  const apiPlugin = {
    send(req, cb) {
      const id = ++apiSeq;
      apiPending.set(id, cb);
      post({ t: 'api', id, req: { url: req.url, method: req.method, contentType: req.contentType, queries: req.queries, headers: req.headers, body: req.body } });
    }
  };
  function makeNicoPlugin() {
    const frontend = { ...FRONTEND, userAgent: navigator.userAgent };
    const program = { providerType: init.providerType || 'user', providerId: init.providerId || '', contentId: init.programId };
    const account = init.account
      ? {
          id: init.account.id,
          name: init.account.name,
          premium: init.account.premium ? 'premium' : null,
          requestPremiumUpgrade() {},
          followStatus: () => ({ isFollowing: false })
        }
      : undefined;
    const started = performance.now();
    const defer = (cb, v) => setTimeout(() => cb(null, v), 0);
    return {
      nicoAccount: account,
      getFrontend: (cb) => defer(cb, frontend),
      getProgram: (cb) => defer(cb, program),
      getAccount: (cb) => defer(cb, account),
      requestPremiumUpgrade() {},
      getFollowStatus: (cb) => cb(null, { isFollowing: false }),
      getPlaybackPosition: (cb) => cb(null, { currentTimeInMilliseconds: Math.round(performance.now() - started) }),
      getWatchStatus: (cb) => cb(null, { status: 'realtime' }),
      setAccount() {}
    };
  }

  // ---------- GameContent (公式 TrustedGameLoader 相当。iframe 外の隔離は親側が担う) ----------
  class GameContent {
    constructor(view, opt) {
      this.view = view;
      this.opt = opt;
      this.sessionId = opt.sessionId;
      this.contentUrl = opt.contentUrl;
      this.zIndex = opt.zIndex;
      this.game = null;
      this.driver = null;
      this.platform = null;
      this.destroyed = false;
      /** teardown 済みの driver (起動の途中で破棄されたときに、あとから作られた driver も片付けるため) */
      this.tornDown = null;
    }

    async start() {
      const o = this.opt;
      const res = await fetch(this.contentUrl);
      if (!res.ok) throw new Error('content.json http ' + res.status + ' ' + this.contentUrl);
      const cfg = await res.json();
      if (this.destroyed) return this;
      cfg.engine_urls = cfg.engine_urls || [];
      cfg.external = cfg.external || [];
      if (cfg.untrusted || cfg.runInIframe) throw new Error('untrusted content is not supported: ' + this.contentUrl);
      this.engineConfig = cfg;

      const outer = document.createElement('div');
      Object.assign(outer.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none', backgroundColor: 'transparent', zIndex: String(this.zIndex) });
      const inner = document.createElement('div');
      Object.assign(inner.style, { position: 'absolute', pointerEvents: 'none' });
      const cont = document.createElement('div');
      Object.assign(cont.style, { position: 'absolute', width: '100%', height: '100%', borderStyle: 'none', overflow: 'hidden', pointerEvents: 'auto', userSelect: 'none' });
      inner.appendChild(cont);
      outer.appendChild(inner);
      this.view.el.appendChild(outer);
      this.outer = outer;
      this.inner = inner;
      this.cont = cont;

      for (const u of cfg.engine_urls) await loadScript(u);
      for (const name of cfg.external) {
        const p = this.view.plugins[name];
        if (p && p.scriptUrls) for (const u of p.scriptUrls) await loadScript(u);
      }
      if (this.destroyed) return this;
      const rt = detectRuntimes(cfg.engine_urls);
      const amflow = new rt.GameDriver.MemoryAmflowClient({ playId: o.playId });
      this.amflow = amflow;
      const Pdi = rt.PdiBrowser;
      const platform = new Pdi.Platform({ amflow, containerView: cont, audioPlugins: [Pdi.WebAudioPlugin, Pdi.HTMLAudioPlugin] });
      platform._disablePreventDefault = true;
      this.platform = platform;

      // contentUrl の query (width/height/fps) を game.json にマージする (nicolib の _customLoadGameConfiguration)
      const raw = platform.loadGameConfiguration;
      const assetBase = cfg.asset_base_url || cfg.content_url.substr(0, cfg.content_url.lastIndexOf('/')) + '/';
      platform.loadGameConfiguration = (url, cb) => {
        if (url === '<agvw-queryparam>') {
          const q = this.contentUrl
            .slice(this.contentUrl.indexOf('?') + 1)
            .split('&')
            .reduce((a, kv) => {
              const p = kv.split('=');
              try {
                a[p[0]] = JSON.parse(decodeURIComponent(p[1]));
              } catch (e) {
                /* 数値でない query は無視 */
              }
              return a;
            }, {});
          return setTimeout(() => cb(null, q), 0);
        }
        if (url === '<agvw-configuration>') return raw.call(platform, cfg.content_url, cb);
        if (this.contentUrl.indexOf('?') !== -1) {
          return setTimeout(() => cb(null, { definitions: [{ url: '<agvw-configuration>', basePath: assetBase }, '<agvw-queryparam>'] }), 0);
        }
        return raw.call(platform, url, cb);
      };

      const driver = new rt.GameDriver.GameDriver({
        platform,
        player: o.player,
        errorHandler: (e) => log('error', 'GameDriver(' + o.label + '): ' + String((e && (e.stack || e.message)) || e))
      });
      this.driver = driver;
      const created = new Promise((resolve) => {
        driver.gameCreatedTrigger.handle((game) => {
          this.game = game;
          this._onGameCreated(game);
          resolve(game);
        });
      });
      await new Promise((resolve, reject) => {
        driver.initialize(
          {
            configurationUrl: cfg.content_url,
            assetBase,
            profiler: null,
            gameArgs: o.argument,
            driverConfiguration: {
              playId: o.playId,
              playToken: '',
              executionMode: rt.GameDriver.ExecutionMode.Active,
              eventBufferMode: { isSender: false, isReceiver: true, isDiscarder: false }
            },
            loopConfiguration: { loopMode: rt.GameDriver.LoopMode.Realtime, delayIgnoreThreshold: 6, jumpTryThreshold: 30000, targetTimeFunc: undefined, originDate: 0 }
          },
          (err) => (err ? reject(err) : resolve())
        );
      });
      if (this.destroyed) {
        // 読み込み中に終了された (catch-up で子ゲームが立て続けに入れ替わったとき)。起動せずに片付ける
        this.teardown();
        return this;
      }
      (o.initialEvents || []).forEach((e) => amflow.sendEvent(e));
      driver.startGame();
      await created;
      platform.setMasterVolume(masterVolume);
      log('info', `${o.label} started ${this.game.width}x${this.game.height}`);
      return this;
    }

    _onGameCreated(game) {
      this.layout();
      const seen = new Set();
      const load = (name) => {
        if (seen.has(name)) return;
        seen.add(name);
        const p = this.view.plugins[name];
        if (!p) {
          log('warn', `no host plugin for external "${name}" (${this.opt.label})`);
          return;
        }
        (p.requires || []).forEach(load);
        try {
          p.onload(game, null, this);
        } catch (e) {
          log('error', 'plugin ' + name + ' onload: ' + e);
        }
      };
      this.engineConfig.external.forEach(load);
      Object.keys(this.view.plugins)
        .filter((n) => this.view.plugins[n].implicit)
        .forEach(load);
    }

    layout() {
      const g = this.game;
      if (!g) return;
      const { w, h } = viewSize();
      const l = calcAspectFit(w, h, g.width, g.height);
      Object.assign(this.inner.style, { left: l.x + 'px', top: l.y + 'px', width: l.width + 'px', height: l.height + 'px' });
      this.platform.setScale(l.width / g.width, l.height / g.height);
    }

    setVolume(v) {
      try {
        if (this.platform) this.platform.setMasterVolume(v);
      } catch (e) {
        /* 起動途中は無視 */
      }
    }

    sendEvents(evs) {
      try {
        evs.forEach((e) => {
          if (this.driver._eventBuffer && this.driver._eventBuffer.onEvent) this.driver._eventBuffer.onEvent(e);
          else this.amflow.sendEvent(e);
        });
      } catch (e) {
        log('error', 'sendEvents(' + this.opt.label + '): ' + e);
      }
    }

    /** ゲームの停止と driver の破棄 (driver ごとに一度だけ) */
    teardown() {
      const driver = this.driver;
      if (!driver || this.tornDown === driver) return;
      this.tornDown = driver;
      try {
        if (this.game && this.game.audio) {
          try {
            this.game.audio.stopAll ? this.game.audio.stopAll() : (this.game.audio.music.stopAll(), this.game.audio.sound.stopAll());
          } catch (e) {
            /* 音声の停止失敗は無視 */
          }
        }
        driver.stopGame();
        driver.initialize({ driverConfiguration: { playId: null }, configurationUrl: null }, () => {
          try {
            driver.destroy && driver.destroy();
          } catch (e) {
            /* 破棄の失敗は無視 */
          }
        });
      } catch (e) {
        log('warn', 'teardown: ' + e);
      }
    }

    destroy() {
      this.destroyed = true;
      this.teardown();
      if (this.outer && this.outer.parentNode) this.outer.parentNode.removeChild(this.outer);
    }
  }

  // ---------- AkashicGameView 相当 ----------
  class GameView {
    constructor(container) {
      this.el = document.createElement('div');
      Object.assign(this.el.style, { position: 'absolute', inset: '0', overflow: 'hidden', pointerEvents: 'none' });
      container.appendChild(this.el);
      this.sessions = [];
      this.plugins = {};
      this.registerBuiltinPlugins();
    }

    registerPlugin(p) {
      this.plugins[p.name] = p;
    }

    registerBuiltinPlugins() {
      const view = this;
      const nicoPlugin = makeNicoPlugin();
      this.registerPlugin({ name: 'nico', onload: (g) => { g.external.nico = nicoPlugin; } });
      this.registerPlugin({ name: 'api', onload: (g) => { g.external.api = apiPlugin; } });
      this.registerPlugin({
        name: 'send',
        onload: (g) => {
          g.external.send = (ev) => {
            // 公式は nx:open で視聴ページなどを開く。http(s) の URL だけ親に任せる
            if (ev && ev.type === 'nx:open' && typeof ev.url === 'string' && /^https?:\/\//.test(ev.url)) post({ t: 'open', url: ev.url });
          };
        }
      });
      this.registerPlugin({ name: 'ichiba', onload: (g) => { g.external.ichiba = { setVersion() {}, setParameters() {}, updateItems() {} }; } });
      this.registerPlugin({
        name: 'agvSupplement',
        implicit: true,
        onload: (g) => { g.external.agvSupplement = { send() {}, setClickableRegions() {} }; }
      });
      const mem = new Map();
      this.registerPlugin({
        name: 'instanceStorage',
        onload: (g) => {
          const k = (grp, key) => grp + ':' + key;
          g.external.instanceStorage = {
            read: (grp, key, cb) => setTimeout(() => cb(null, mem.has(k(grp, key)) ? mem.get(k(grp, key)) : null), 0),
            write: (grp, key, v, cb) => { mem.set(k(grp, key), v); setTimeout(() => cb && cb(null), 0); },
            delete: (grp, key, cb) => { mem.delete(k(grp, key)); setTimeout(() => cb && cb(null), 0); },
            getLength: (grp, cb) => cb(null, 0),
            getKey: (grp, i, cb) => cb(null, null),
            makeGroupUntrusted: (g2, cb) => cb && cb(null)
          };
        }
      });
      this.registerPlugin({
        name: 'coe',
        onload: (g) => {
          g.external.coe = {
            startSession: (params) => view.startSession(params),
            exitSession: async (sid) => view.exitSession(sid),
            sendLocalEvents() {},
            destroy() {}
          };
        }
      });
    }

    getContentBySessionId(id) {
      return this.sessions.find((s) => s.sessionId === id);
    }

    resolveContentUrl(app) {
      return app.url ? app.url : `https://resource.akashic.coe.nicovideo.jp/coe/contents/${app.type}/${app.version}/content.json`;
    }

    notifyActive() {
      post({ t: 'active', active: this.sessions.length > 0 });
    }

    // nicolib AkashicGameView.startSession (local: true の経路のみ)
    startSession(p) {
      if (!p || !p.application) throw new Error('cannot start session');
      if (!p.local) {
        log('warn', 'non-local session is not supported', p.sessionId);
        return;
      }
      const url = this.resolveContentUrl(p.application);
      if (!TRUSTED_URL.test(url)) {
        log('warn', 'untrusted child content is blocked: ' + url);
        return;
      }
      const c = new GameContent(this, {
        label: 'child:' + (p.application.type || 'unknown'),
        sessionId: p.sessionId,
        playId: p.sessionId,
        contentUrl: url,
        player: { id: 'local-user', name: 'local-user' },
        zIndex: this.sessions.length,
        argument: { coe: { permission: { advance: true, advanceRequest: false, aggregation: false }, roles: [], debugMode: false }, agv: p.additionalData && p.additionalData.agv },
        initialEvents: p.localEvents
      });
      this.sessions.push(c);
      this.notifyActive();
      c.start().catch((e) => log('error', 'child start: ' + String((e && e.stack) || e)));
    }

    exitSession(sid) {
      const c = this.getContentBySessionId(sid);
      if (!c) return;
      this.sessions.splice(this.sessions.indexOf(c)).forEach((s) => s.destroy());
      this.notifyActive();
    }

    relayout() {
      this.sessions.forEach((s) => s.layout());
    }

    setVolume(v) {
      this.sessions.forEach((s) => s.setVolume(v));
    }
  }

  // ---------- AkashicClient 相当 ----------
  const client = {
    view: null,
    root: null,
    async run() {
      this.view = new GameView(document.getElementById('akashic-gameview'));
      const base = init.coeContentBaseUrl;
      const rootUrl = `${base}nicocas/${NICOCAS_VERSION}/content.json?width=1920&height=1080`;
      if (!TRUSTED_URL.test(rootUrl)) throw new Error('untrusted root content url: ' + rootUrl);
      this.root = new GameContent(this.view, {
        label: 'root',
        sessionId: init.programId,
        playId: init.programId,
        contentUrl: rootUrl,
        player: { id: init.account ? init.account.id : '', name: init.account ? init.account.name : '' },
        zIndex: -200,
        argument: { coe: { permission: { advance: true, advanceRequest: false, aggregation: true }, roles: [] } }
      });
      await this.root.start();
      rootReady = true;
      pendingBatches.splice(0).forEach(applyBatch);
    },
    // nicolib AkashicClient.sendLocalAkashicEvent
    sendLocalAkashicEvent(payload) {
      const ev = [32, 2, ':akashic', payload];
      const c = payload.playId ? this.view.getContentBySessionId(payload.playId) : null;
      (c || this.root).sendEvents([ev]);
    },
    relayout() {
      if (this.root) this.root.layout();
      if (this.view) this.view.relayout();
    },
    setVolume(v) {
      if (this.root) this.root.setVolume(v);
      if (this.view) this.view.setVolume(v);
    }
  };

  /** mpn の状態更新を epoch 順に適用する。スナップショットは join、以降は continuation を使い、どちらも shared を続けて適用する */
  function applyBatch(b) {
    if (!rootReady) {
      pendingBatches.push(b);
      return;
    }
    if (b.epoch <= lastEpoch) return;
    lastEpoch = b.epoch;
    (b.snapshot ? b.join : b.continuation).concat(b.shared).forEach((ev) => client.sendLocalAkashicEvent(ev));
  }

  window.addEventListener('resize', () => client.relayout());

  // iframe がマウスを受け取っている間 (ゲーム画面の表示中) は、親にマウスの動きが届かない。
  // 全画面で操作バーを出すために、動きがあったことだけ親へ知らせる
  let lastPointerPost = 0;
  const notifyPointer = () => {
    const now = performance.now();
    if (now - lastPointerPost < 100) return;
    lastPointerPost = now;
    post({ t: 'pointer' });
  };
  window.addEventListener('mousemove', notifyPointer, true);
  window.addEventListener('mousedown', notifyPointer, true);

  window.addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'init':
        if (init) return;
        init = m;
        masterVolume = (m.volume || 0) * MAX_VOLUME;
        client.run().catch((err) => log('error', 'root start failed: ' + String((err && err.stack) || err)));
        break;
      case 'batch':
        if (init) applyBatch(m.batch);
        break;
      case 'volume':
        masterVolume = (m.volume || 0) * MAX_VOLUME;
        client.setVolume(masterVolume);
        break;
      case 'apiRes': {
        const cb = apiPending.get(m.id);
        apiPending.delete(m.id);
        if (cb) (m.err ? cb(new Error(m.err), undefined) : cb(undefined, m.res));
        break;
      }
      default:
        break;
    }
  });

  post({ t: 'ready' });
})();
