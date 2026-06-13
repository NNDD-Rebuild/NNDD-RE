import { useConfig } from '@renderer/hooks/useConfig';

/**
 * 設定 > プレイヤー。
 * 元: コメント描画関連の各オプション
 *  - 表示秒数
 *  - フォント
 *  - 不透明度
 *  - ドロップシャドウ
 *  - アンチエイリアス
 *  - ボールド
 *  - デフォルト音量
 *  - デフォルト再生速度
 *  - リピート
 *  - コメント表示
 */
export function PlayerSettings(): JSX.Element {
  const [volume, setVolume] = useConfig<number>('player.volume', 1);
  const [showComments, setShowComments] = useConfig<boolean>(
    'player.showComments',
    true
  );
  const [opacity, setOpacity] = useConfig<number>(
    'player.commentOpacity',
    1
  );
  const [sizeScale, setSizeScale] = useConfig<number>(
    'player.commentSizeScale',
    1
  );
  const [showSec, setShowSec] = useConfig<number>(
    'player.commentShowSeconds',
    3
  );
  const [fontFamily, setFontFamily] = useConfig<string>(
    'player.commentFontFamily',
    '"MS PGothic", "MSPGothic", "Yu Gothic UI", "Meiryo", sans-serif'
  );
  const [antiAlias, setAntiAlias] = useConfig<boolean>(
    'player.commentAntiAlias',
    true
  );
  const [bold, setBold] = useConfig<boolean>('player.commentBold', false);
  const [dropShadow, setDropShadow] = useConfig<boolean>(
    'player.commentDropShadow',
    true
  );
  const [outlineIntensity, setOutlineIntensity] = useConfig<'light' | 'normal'>(
    'player.commentOutlineIntensity',
    'light'
  );
  const [keepCA, setKeepCA] = useConfig<boolean>(
    'player.commentKeepCA',
    true
  );
  const [rate, setRate] = useConfig<number>('player.playbackRate', 1.0);
  const [repeat, setRepeat] = useConfig<boolean>('player.repeat', false);
  const [streamingMode, setStreamingMode] = useConfig<'hls' | 'native' | 'niconico'>(
    'player.streamingMode',
    'native'
  );
  const [niconicoInheritLogin, setNiconicoInheritLogin] = useConfig<boolean>(
    'player.niconicoInheritLogin',
    true
  );
  const [commentListDisplay, setCommentListDisplay] = useConfig<'tab' | 'window'>(
    'player.commentListDisplay',
    'tab'
  );
  const [pastCommentMaxCount, setPastCommentMaxCount] = useConfig<number>(
    'player.pastCommentMaxCount',
    0
  );
  const [controlUiSize, setControlUiSize] = useConfig<'small' | 'normal' | 'large'>(
    'player.controlUiSize',
    'small'
  );
  const [openVideoLinkInPlayer, setOpenVideoLinkInPlayer] = useConfig<boolean>(
    'player.openVideoLinkInPlayer',
    false
  );

  return (
    <div className="p-4 max-w-3xl">
      <h2 className="text-base font-bold mb-3">プレイヤー</h2>

      <Section title="コメント表示">
        <Row label="コメントを表示する">
          <input
            type="checkbox"
            checked={showComments}
            onChange={(e) => setShowComments(e.target.checked)}
          />
        </Row>
        <Row label={`不透明度: ${Math.round(opacity * 100)}%`}>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="w-64"
          />
        </Row>
        <Row label={`サイズ倍率: ${sizeScale.toFixed(2)}x`}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.05}
              value={sizeScale}
              onChange={(e) => setSizeScale(Number(e.target.value))}
              className="w-64"
            />
            <div className="flex gap-1">
              {[0.75, 1.0, 1.25, 1.5].map((s) => (
                <button
                  key={s}
                  onClick={() => setSizeScale(s)}
                  className={[
                    'text-xs px-2 py-1 rounded',
                    Math.abs(sizeScale - s) < 0.01
                      ? 'bg-nndd-accent text-white'
                      : 'bg-nndd-border hover:bg-nndd-accent/70'
                  ].join(' ')}
                >
                  {s.toFixed(2)}x
                </button>
              ))}
            </div>
          </div>
        </Row>
        <Row label={`流れるコメント表示秒数: ${showSec}秒`}>
          <input
            type="range"
            min={1}
            max={8}
            step={0.5}
            value={showSec}
            onChange={(e) => setShowSec(Number(e.target.value))}
            className="w-64"
          />
        </Row>
        <Row label="フォント">
          <input
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
            className="w-full bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          />
        </Row>
        <Row label="ボールド">
          <input
            type="checkbox"
            checked={bold}
            onChange={(e) => setBold(e.target.checked)}
          />
        </Row>
        <Row label="文字の縁取り">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={dropShadow}
              onChange={(e) => setDropShadow(e.target.checked)}
            />
            <span className="text-xs text-nndd-subtext">縁取りを表示</span>
          </label>
        </Row>
        {dropShadow && (
          <Row label="縁の濃さ">
            <div className="flex gap-3 text-xs">
              {(['light', 'normal'] as const).map((v) => (
                <label key={v} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="outlineIntensity"
                    checked={outlineIntensity === v}
                    onChange={() => setOutlineIntensity(v)}
                  />
                  <span>{v === 'light' ? '薄い' : '普通'}</span>
                </label>
              ))}
            </div>
          </Row>
        )}
        <Row label="アンチエイリアス">
          <input
            type="checkbox"
            checked={antiAlias}
            onChange={(e) => setAntiAlias(e.target.checked)}
          />
        </Row>
        <Row label="コメントアート (CA) 保護">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={keepCA}
              onChange={(e) => setKeepCA(e.target.checked)}
            />
            <span className="text-xs text-nndd-subtext">
              ONにすると歌詞・AA等のコメントアートが崩れにくくなります
            </span>
          </label>
        </Row>
      </Section>

      <Section title="ストリーミング再生">
        <Row label="再生方式">
          <div className="flex flex-col gap-2 text-xs">

            {/* ── ストリーミング ── */}
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="streamingTop"
                checked={streamingMode !== 'niconico'}
                onChange={() => setStreamingMode('native')}
                className="mt-0.5"
              />
              <span>
                ストリーミング (NNDD-RE内蔵プレイヤー)
                <span className="block text-nndd-subtext">
                  コメント描画・シークバーあり
                </span>
              </span>
            </label>

            {/* ストリーミング選択時のサブオプション */}
            {streamingMode !== 'niconico' && (
              <div className="ml-6 flex flex-col gap-2 border-l border-nndd-border pl-3">
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="streamingMode"
                    checked={streamingMode === 'native'}
                    onChange={() => setStreamingMode('native')}
                    className="mt-0.5"
                  />
                  <span>
                    HLS即時再生（ネイティブ）
                    <span className="block text-nndd-subtext">
                      即時再生・シーク可能。コメント描画あり。
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="streamingMode"
                    checked={streamingMode === 'hls'}
                    onChange={() => setStreamingMode('hls')}
                    className="mt-0.5"
                  />
                  <span>
                    HLS即時再生（yt-dlp）
                    <span className="block text-nndd-subtext">
                      HLS proxy 経由でニコニコCDNにアクセス。
                    </span>
                  </span>
                </label>
              </div>
            )}

            {/* ── ニコニコ公式 ── */}
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="streamingTop"
                checked={streamingMode === 'niconico'}
                onChange={() => setStreamingMode('niconico')}
                className="mt-0.5"
              />
              <span>
                ニコニコ公式プレイヤー埋め込み (webview)
                <span className="block text-nndd-subtext">
                  ニコニコ動画の視聴ページで再生
                </span>
              </span>
            </label>
            {streamingMode === 'niconico' && (
              <div className="ml-6 border-l border-nndd-border pl-3">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="niconicoInheritLogin"
                    checked={niconicoInheritLogin ?? true}
                    onChange={(e) => setNiconicoInheritLogin(e.target.checked)}
                  />
                  <span>
                    NNDD-REのログイン情報を引き継ぐ
                    <span className="block text-nndd-subtext">
                      ONにすると nicovideo.jp Cookie を埋め込みプレイヤーに注入します
                    </span>
                  </span>
                </label>
              </div>
            )}
          </div>
        </Row>
      </Section>

      <Section title="コメント一覧">
        <Row label="過去ログ同時描画制限">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={99999}
              step={100}
              value={pastCommentMaxCount}
              onChange={(e) => setPastCommentMaxCount(Math.max(0, Number(e.target.value)))}
              className="w-24 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm text-right"
            />
            <span className="text-xs text-nndd-subtext">
              {pastCommentMaxCount === 0 ? '無制限' : `最大 ${pastCommentMaxCount.toLocaleString()} 件`}
            </span>
          </div>
          <p className="text-xs text-nndd-subtext mt-0.5">
            過去コメント表示時に描画するコメントの上限。0 = 無制限
          </p>
        </Row>
        <Row label="表示方式">
          <div className="flex flex-col gap-2 text-xs">
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="commentListDisplay"
                checked={commentListDisplay === 'tab'}
                onChange={() => setCommentListDisplay('tab')}
                className="mt-0.5"
              />
              <span>
                タブ表示
                <span className="block text-nndd-subtext">
                  サイドパネル内のタブとして表示
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="commentListDisplay"
                checked={commentListDisplay === 'window'}
                onChange={() => setCommentListDisplay('window')}
                className="mt-0.5"
              />
              <span>
                浮動ウィンドウ
                <span className="block text-nndd-subtext">
                  ビデオ上に重ねて表示。ドラッグで移動可能
                </span>
              </span>
            </label>
          </div>
        </Row>
      </Section>

      <Section title="再生">
        <Row label={`デフォルト音量: ${Math.round(volume * 100)}%`}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-64"
          />
        </Row>
        <Row label="デフォルト再生速度">
          <div className="flex gap-1">
            {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((r) => (
              <button
                key={r}
                onClick={() => setRate(r)}
                className={[
                  'text-xs px-2 py-1 rounded',
                  rate === r
                    ? 'bg-nndd-accent text-white'
                    : 'bg-nndd-border hover:bg-nndd-accent/70'
                ].join(' ')}
              >
                {r.toFixed(2)}x
              </button>
            ))}
          </div>
        </Row>
        <Row label="リピート再生">
          <input
            type="checkbox"
            checked={repeat}
            onChange={(e) => setRepeat(e.target.checked)}
          />
        </Row>
        <Row label="動画リンクをプレイヤーで開く">
          <input
            type="checkbox"
            checked={openVideoLinkInPlayer}
            onChange={(e) => setOpenVideoLinkInPlayer(e.target.checked)}
          />
          <p className="text-xs text-nndd-subtext mt-0.5">
            動画説明文の sm/nm/so 等のリンクをNNDD-REでストリーミング再生
          </p>
        </Row>
        <Row label="コントロールUIサイズ">
          <div className="flex gap-1">
            {([
              { value: 'small', label: '小'},
              { value: 'normal', label: '標準'},
              { value: 'large', label: '大'},
            ] as const).map(({ value, label}) => (
              <button
                key={value}
                onClick={() => setControlUiSize(value)}
                
                className={[
                  'text-xs px-3 py-1 rounded',
                  controlUiSize === value
                    ? 'bg-nndd-accent text-white'
                    : 'bg-nndd-border hover:bg-nndd-accent/70'
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-nndd-subtext mt-0.5">
            シークバー・ボタン等のコントロールバー全体のサイズ
          </p>
        </Row>
      </Section>
    </div>
  );
}

function Section({
  title,
  children
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="mb-5">
      <div className="text-sm font-bold mb-2 border-b border-nndd-border pb-1">
        {title}
      </div>
      <div className="pl-3">{children}</div>
    </div>
  );
}

function Row({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="w-56 text-xs text-nndd-subtext shrink-0">{label}</div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
