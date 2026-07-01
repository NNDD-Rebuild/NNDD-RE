import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NNDDREComment, WatchPageInfo, DomandStreamCandidate } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { buildLocalUrl } from '@shared/constants';
import { VideoPlayer } from './components/player/VideoPlayer';
import { VideoController } from './components/player/VideoController';
import { VideoInfoView } from './components/player/VideoInfoView';
import type { CommentRenderConfig } from './components/player/CommentRenderer';
import { ensureCommandResolved } from './util/commentCommands';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useConfig } from './hooks/useConfig';

interface StreamProgress {
  videoId: string;
  progress: number;
  phase: 'preparing' | 'downloading' | 'ready' | 'failed';
  localPath?: string;
  speed?: string;
  eta?: string;
  message?: string;
}

interface InitParams {
  videoId?: string;
  localPath?: string;
  /** LANライブラリのHTTPストリーミングURL */
  streamUrl?: string;
  folderPlaylist?: string[];
  searchPlaylist?: string[];
  localFiles?: {
    commentXml?: string;
    ownerCommentXml?: string;
    thumbInfoXml?: string;
    thumbImage?: string;
    ichibaHtml?: string;
  };
  /** 音声のみ再生モード */
  audioOnly?: boolean;
  /** 自動再生による遷移か */
  autoNext?: boolean;
}

/** 視聴履歴記録: 再生開始から 10 秒経過した時点で 1 度だけ書き込む */
const HISTORY_RECORD_THRESHOLD_SEC = 10;

/**
 * 動画プレイヤーウィンドウのルートコンポーネント。
 *
 * メインプロセスから IPC `nndd:player:init` で起動情報 (videoId or localPath) を受け取り、
 * ストリーミング or ローカル再生を行う。
 *
 * 元: VideoPlayer.mxml の全体レイアウト相当。
 */
export default function PlayerApp(): JSX.Element {
  const [src, setSrc] = useState('');
  const [isHls, setIsHls] = useState(false);
  const [niconicoMode, setNiconicoMode] = useState(false);
  const [watch, setWatch] = useState<WatchPageInfo | null>(null);
  const watchRef = useRef<WatchPageInfo | null>(null);
  const [comments, setComments] = useState<NNDDREComment[]>([]);
  const [pastComments, setPastComments] = useState<NNDDREComment[]>([]);
  const [showPastComments, setShowPastComments] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(true);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const setVideoWithRef = (el: HTMLVideoElement | null): void => {
    videoElementRef.current = el;
    setVideo(el);
  };
  const [isLocal, setIsLocal] = useState(false);
  const [localCommentXmlPath, setLocalCommentXmlPath] = useState<string | undefined>(undefined);
  const [localIchibaHtmlPath, setLocalIchibaHtmlPath] = useState<string | undefined>(undefined);
  const [streamProgress, setStreamProgress] = useState<StreamProgress | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [commentWindowOpen, setCommentWindowOpen] = useState(false);
  const [autoNextSeries, setAutoNextSeries] = useState(false);
  const autoNextSeriesRef = useRef(false);
  const seriesItemsRef = useRef<import('@shared/types').MyListItem[]>([]);
  const [seriesItems, setSeriesItems] = useState<import('@shared/types').MyListItem[]>([]);
  const seriesPageRef = useRef(1);
  const seriesTotalPagesRef = useRef(1);
  const seriesIdRef = useRef('');
  const [autoNextFolder, setAutoNextFolder] = useState(false);
  const autoNextFolderRef = useRef(false);
  const [folderVideos, setFolderVideos] = useState<string[]>([]);
  const folderVideosRef = useRef<string[]>([]);
  const currentLocalPathRef = useRef<string>('');
  const isLocalRef = useRef(false);
  const [searchPlaylist, setSearchPlaylist] = useState<string[]>([]);
  const searchPlaylistRef = useRef<string[]>([]);
  const [audioOnly, setAudioOnly] = useState(false);
  const audioOnlyRef = useRef(false);
  const [availableQualities, setAvailableQualities] = useState<DomandStreamCandidate[]>([]);
  const [selectedQualityId, setSelectedQualityId] = useState<string | null>(null);
  const consecutiveSkipRef = useRef(0);
  const MAX_CONSECUTIVE_SKIPS = 10;
  const preloadRef = useRef<{
    videoId: string;
    watchInfo?: WatchPageInfo;
    stream?: {
      contentUrl: string | null;
      isDMS: boolean;
      isHls?: boolean;
      ffplay?: boolean;
      niconico?: boolean;
      error?: string;
    };
  } | null>(null);

  // ── サイドバー幅リサイズ ──────────────────────────────────
  const SIDEBAR_MIN = 180;
  const SIDEBAR_MAX = 700;
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isSidebarDragging, setIsSidebarDragging] = useState(false);
  const sidebarDragging = useRef(false);
  const sidebarDragStartX = useRef(0);
  const sidebarDragStartW = useRef(320);

  useEffect(() => { isHlsRef.current = isHls; }, [isHls]);
  useEffect(() => { srcRef.current = src; }, [src]);
  useEffect(() => { isLocalRef.current = isLocal; }, [isLocal]);
  useEffect(() => { searchPlaylistRef.current = searchPlaylist; }, [searchPlaylist]);
  useEffect(() => { watchRef.current = watch; }, [watch]);

  // テーマ適用
  useEffect(() => {
    window.nndd.invoke<'dark' | 'light'>(window.nndd.channels.CONFIG_GET, 'ui.theme')
      .then((v) => { if (v === 'light') document.documentElement.classList.add('light'); })
      .catch(() => {});
  }, []);

  // autoNextFolder: マウント時に設定から復元
  useEffect(() => {
    window.nndd.invoke<boolean>(window.nndd.channels.CONFIG_GET, 'player.autoNextFolder')
      .then((v) => {
        if (v != null) {
          autoNextFolderRef.current = v;
          setAutoNextFolder(v);
        }
      })
      .catch(() => {});
  }, []);

  // 保存済み幅のロード
  useEffect(() => {
    window.nndd
      .invoke<number>(window.nndd.channels.CONFIG_GET, 'player.sidebarWidth')
      .then((w) => { if (w && w > 0) setSidebarWidth(w); })
      .catch(() => {});
  }, []);

  const onSidebarDividerMouseDown = useCallback((e: React.MouseEvent): void => {
    sidebarDragging.current = true;
    setIsSidebarDragging(true);
    sidebarDragStartX.current = e.clientX;
    sidebarDragStartW.current = sidebarWidth;
    e.preventDefault();
  }, [sidebarWidth]);

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!sidebarDragging.current) return;
      const dx = sidebarDragStartX.current - e.clientX; // 左ドラッグ → 幅増加
      const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, sidebarDragStartW.current + dx));
      setSidebarWidth(w);
    };
    const onUp = (e: MouseEvent): void => {
      if (!sidebarDragging.current) return;
      sidebarDragging.current = false;
      setIsSidebarDragging(false);
      const dx = sidebarDragStartX.current - e.clientX;
      const w = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, sidebarDragStartW.current + dx));
      window.nndd
        .invoke(window.nndd.channels.CONFIG_SET, 'player.sidebarWidth', w)
        .catch(() => {});
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const containerRef = useRef<HTMLDivElement>(null);
  const webviewWrapperRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<number | null>(null);
  const historyRecordedRef = useRef(false);
  /** nndd-stream:// → nndd-re-local:// 切替時に再生位置を復元するためのRef */
  const pendingSeekRef = useRef(0);
  /** イベントリスナー内でstaleにならないようvideo stateをrefでも持つ */
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const isHlsRef = useRef(false);
  const srcRef = useRef('');
  const playInfoRef = useRef<{
    videoId: string;
    title: string;
    thumbnailUrl: string;
    isLocal: boolean;
  } | null>(null);
  const [commentOpacity] = useConfig<number>('player.commentOpacity', 1);
  const [commentSizeScale] = useConfig<number>('player.commentSizeScale', 1);
  const [commentShowSec] = useConfig<number>('player.commentShowSeconds', 3);
  const [commentFontFamily] = useConfig<string>(
    'player.commentFontFamily',
    '"MS PGothic", "MSPGothic", "Yu Gothic UI", "Meiryo", sans-serif'
  );
  const [commentBold] = useConfig<boolean>('player.commentBold', false);
  const [commentDropShadow] = useConfig<boolean>(
    'player.commentDropShadow',
    true
  );
  const [commentOutlineIntensity] = useConfig<'light' | 'normal'>(
    'player.commentOutlineIntensity',
    'light'
  );
  const [commentAntiAlias] = useConfig<boolean>(
    'player.commentAntiAlias',
    true
  );
  const [commentKeepCA] = useConfig<boolean>(
    'player.commentKeepCA',
    true
  );
  const [commentListDisplay] = useConfig<'tab' | 'window'>(
    'player.commentListDisplay',
    'tab'
  );
  /** 過去コメント時の同時描画制限 (0=無制限) */
  const [pastCommentMaxCount] = useConfig<number>('player.pastCommentMaxCount', 0);
  const [commentWindowAutoOpen] = useConfig<boolean>(
    'player.commentWindowAutoOpen',
    false
  );
  const [controlUiSize] = useConfig<'small' | 'normal' | 'large'>('player.controlUiSize', 'small');
  const controlZoom = controlUiSize === 'large' ? 1.5 : controlUiSize === 'normal' ? 1.3 : 1;

  /** 過去コメント同時表示制限付きコメント配列をメモ化 (不要な rebuildEngine を防ぐ) */
  const renderedComments = useMemo<NNDDREComment[]>(() => {
    if (!showComments) return [];
    const base = showPastComments
      ? limitSimultaneousComments(pastComments, pastCommentMaxCount)
      : comments;
    // owner コマンドコメント (@ジャンプ 等) は画面に流さない
    return base.filter((c) => !/^[＠@]ジャンプ/.test(c.text ?? ''));
  }, [showComments, showPastComments, pastComments, pastCommentMaxCount, comments]);

  const commentConfig = useMemo<Partial<CommentRenderConfig>>(
    () => ({
      opacity: commentOpacity,
      sizeScale: commentSizeScale,
      showSecNaka: commentShowSec,
      showSecFixed: commentShowSec,
      fontFamily: commentFontFamily,
      bold: commentBold,
      dropShadow: commentDropShadow,
      outlineIntensity: commentOutlineIntensity,
      antiAlias: commentAntiAlias,
      keepCA: commentKeepCA
    }),
    [
      commentOpacity,
      commentSizeScale,
      commentShowSec,
      commentFontFamily,
      commentBold,
      commentDropShadow,
      commentOutlineIntensity,
      commentAntiAlias,
      commentKeepCA
    ]
  );

  useEffect(() => {
    if (!niconicoMode) {
      window.nndd.send(IpcChannel.PLAYER_NICONICO_DESTROY);
      return;
    }
    const el = webviewWrapperRef.current;
    if (!el) return;

    window.nndd.send(IpcChannel.PLAYER_NICONICO_INIT, {
      videoId: playInfoRef.current?.videoId ?? ''
    });

    const sendBounds = (): void => {
      const rect = el.getBoundingClientRect();
      window.nndd.send(IpcChannel.PLAYER_NICONICO_RESIZE, {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
    };
    sendBounds();
    const ro = new ResizeObserver(sendBounds);
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.nndd.send(IpcChannel.PLAYER_NICONICO_DESTROY);
    };
  }, [niconicoMode]);

  /**
   * 初期化イベント (PlayerManager から送られる) を受信
   */
  useEffect(() => {
    const off = window.electron.ipcRenderer.on(
      'nndd:player:init',
      async (_e, params: InitParams) => {
        try {
          setLoading(true);
          setError(null);
          const isAudioOnly = !!params.audioOnly;
          audioOnlyRef.current = isAudioOnly;
          setAudioOnly(isAudioOnly);
          if (params.searchPlaylist && params.searchPlaylist.length > 0) {
            searchPlaylistRef.current = params.searchPlaylist;
            setSearchPlaylist(params.searchPlaylist);
          } else {
            searchPlaylistRef.current = [];
            setSearchPlaylist([]);
          }
          if (params.localPath) {
            await initLocal(params.localPath, params.localFiles, params.folderPlaylist);
          } else if (params.videoId) {
            await initStreaming(params.videoId, isAudioOnly);
          } else if (params.streamUrl) {
            initStreamUrl(params.streamUrl);
          } else {
            setError('再生対象が指定されていません');
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const isAutoPlay = params.autoNext &&
            (autoNextSeriesRef.current || searchPlaylistRef.current.length > 0 || autoNextFolderRef.current);
          if (isAutoPlay && consecutiveSkipRef.current < MAX_CONSECUTIVE_SKIPS) {
            consecutiveSkipRef.current++;
            console.warn(
              `[AutoPlay] スキップ (${consecutiveSkipRef.current}/${MAX_CONSECUTIVE_SKIPS}):`,
              params.videoId, msg
            );
            if (!advanceToNextVideo()) {
              setError(msg);
            }
          } else if (isAutoPlay && consecutiveSkipRef.current >= MAX_CONSECUTIVE_SKIPS) {
            consecutiveSkipRef.current = 0;
            setError(`連続スキップ上限に達しました (${MAX_CONSECUTIVE_SKIPS}件)。${msg}`);
          } else {
            setError(msg);
          }
        } finally {
          setLoading(false);
        }
      }
    );
    return off;
  }, []);

  const handleVideoError = async (code: number): Promise<void> => {
    // code 4 = MEDIA_ERR_SRC_NOT_SUPPORTED: キャッシュファイルが破損 or 非対応コーデック
    if (code === 4 && srcRef.current.startsWith('nndd-re-local://')) {
      const vid = playInfoRef.current?.videoId;
      if (!vid) return;
      setSrc('');
      setIsHls(false);
      await window.nndd.invoke(window.nndd.channels.VIDEO_DELETE_CACHE, vid);
      try {
        await initStreaming(vid, audioOnlyRef.current);
      } catch (e) {
        const isAutoPlay = autoNextSeriesRef.current || searchPlaylistRef.current.length > 0 || autoNextFolderRef.current;
        const msg = e instanceof Error ? e.message : String(e);
        if (isAutoPlay && consecutiveSkipRef.current < MAX_CONSECUTIVE_SKIPS) {
          consecutiveSkipRef.current++;
          console.warn(`[AutoPlay] スキップ (${consecutiveSkipRef.current}/${MAX_CONSECUTIVE_SKIPS}):`, vid, msg);
          if (!advanceToNextVideo()) {
            setError(msg);
          }
        } else {
          setError(msg);
        }
      }
    }
  };

  const initStreaming = async (videoId: string, isAudioOnly?: boolean): Promise<void> => {
    const cached = preloadRef.current?.videoId === videoId ? preloadRef.current : null;
    preloadRef.current = null;

    setIsLocal(false);
    setWatch(null);
    watchRef.current = null;
    playInfoRef.current = { videoId, title: videoId, thumbnailUrl: '', isLocal: false };
    setLocalCommentXmlPath(undefined);
    setPastComments([]);
    setShowPastComments(false);
    folderVideosRef.current = [];
    setFolderVideos([]);
    setAvailableQualities([]);
    setSelectedQualityId(null);
    // 1. WatchPageInfo を取得（プリロードキャッシュ優先）
    const w = cached?.watchInfo
      ?? await window.nndd.invoke<WatchPageInfo>(window.nndd.channels.VIDEO_GET_WATCH_INFO, videoId);
    setWatch(w);
    if (w.channel !== null && !w.isDownloadable) {
      throw new Error(`チャンネル限定動画です。「${w.channel.name}」への加入が必要です。`);
    }
    historyRecordedRef.current = false;
    playInfoRef.current = {
      videoId,
      title: w?.title ?? videoId,
      thumbnailUrl: w?.thumbnail?.url ?? '',
      isLocal: false
    };

    // 画質リストをセット (DMS のみ)
    const available = w.domandVideos
      .filter(v => v.isAvailable)
      .sort((a, b) => b.qualityLevel - a.qualityLevel);
    setAvailableQualities(available);
    const defaultQualityId = available[0]?.id ?? null;
    setSelectedQualityId(defaultQualityId);

    // 2. コメント取得（音声のみモードではスキップ）
    if (isAudioOnly) {
      setComments([]);
    } else try {
      const cs = await window.nndd.invoke<NNDDREComment[]>(
        window.nndd.channels.VIDEO_GET_COMMENTS,
        videoId,
        w
      );
      setComments(cs.map(ensureCommandResolved));
    } catch (e) {
      console.warn('comment fetch failed:', e);
    }

    // 3. ストリーミング URL を取得（プリロードキャッシュ優先）
    const stream = cached?.stream
      ?? await window.nndd.invoke<{
        contentUrl: string | null;
        isDMS: boolean;
        ffplay?: boolean;
        isHls?: boolean;
        niconico?: boolean;
        error?: string;
      }>(window.nndd.channels.VIDEO_GET_STREAM_URL, videoId, w, isAudioOnly, defaultQualityId);

    if (stream.error) {
      throw new Error(stream.error);
    }

    consecutiveSkipRef.current = 0;
    pendingSeekRef.current = 0;
    if (stream.niconico) {
      setNiconicoMode(true);
      setSrc('');
      setIsHls(false);
    } else {
      setNiconicoMode(false);
      setSrc(stream.contentUrl ?? '');
      setIsHls(stream.isHls ?? false);
    }
  };

  const handleQualityChange = async (qualityId: string): Promise<void> => {
    const currentSec = videoElementRef.current?.currentTime ?? 0;
    pendingSeekRef.current = currentSec;
    setSelectedQualityId(qualityId);
    const vid = watchRef.current?.videoId ?? playInfoRef.current?.videoId;
    const w = watchRef.current;
    if (!vid || !w) return;
    const stream = await window.nndd.invoke<{
      contentUrl: string | null;
      isDMS: boolean;
      isHls?: boolean;
      error?: string;
    }>(window.nndd.channels.VIDEO_GET_STREAM_URL, vid, w, audioOnlyRef.current, qualityId);
    if (!stream.error && stream.contentUrl) {
      setSrc(stream.contentUrl);
      setIsHls(stream.isHls ?? false);
    }
  };

  const initStreamUrl = (url: string): void => {
    setIsLocal(false);
    setLocalCommentXmlPath(undefined);
    setPastComments([]);
    setShowPastComments(false);
    consecutiveSkipRef.current = 0;
    setSrc(url);
    setIsHls(false);
    historyRecordedRef.current = false;
    const m = url.match(/\/((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)\/?$/);
    playInfoRef.current = {
      videoId: m ? m[1] : '',
      title: m ? m[1] : 'LANライブラリ',
      thumbnailUrl: '',
      isLocal: false
    };
  };

  const initLocal = async (
    localPath: string,
    files?: InitParams['localFiles'],
    folderPlaylist?: string[]
  ): Promise<void> => {
    setIsLocal(true);
    setWatch(null);
    setPastComments([]);
    setShowPastComments(false);
    setLocalCommentXmlPath(files?.commentXml);
    setLocalIchibaHtmlPath(files?.ichibaHtml);
    currentLocalPathRef.current = localPath;
    // ライブラリからソート済みリストが渡された場合はそれを優先、なければファイルシステムから取得
    if (folderPlaylist && folderPlaylist.length > 0) {
      folderVideosRef.current = folderPlaylist;
      setFolderVideos(folderPlaylist);
    } else {
      const dir = localPath.replace(/[/\\][^/\\]+$/, '');
      window.nndd.invoke<string[]>(window.nndd.channels.LIBRARY_FOLDER_VIDEOS, dir)
        .then((vids) => { folderVideosRef.current = vids; setFolderVideos(vids); })
        .catch(() => { folderVideosRef.current = []; setFolderVideos([]); });
    }
    // IPC不要: URL はレンダラー側で直接構築
    consecutiveSkipRef.current = 0;
    setSrc(buildLocalUrl(localPath));
    setIsHls(false);
    historyRecordedRef.current = false;
    // ローカルの場合 videoId はファイル名から推測 (例: [sm12345]タイトル.mp4)
    const m = localPath.match(/\[((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)\]/);
    const guessId = m ? m[1] : localPath;
    const titleGuess =
      localPath
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.[^.]+$/, '') ?? localPath;
    playInfoRef.current = {
      videoId: guessId,
      title: titleGuess,
      thumbnailUrl: files?.thumbImage ?? '',
      isLocal: true
    };

    // コメントXML と ThumbInfo XML を並列ロード (setSrc 後なので再生を塞がない)
    const loadComments = async (): Promise<void> => {
      if (!files?.commentXml) return;
      const cs = await window.nndd.invoke<NNDDREComment[]>(
        window.nndd.channels.COMMENT_READ_LOCAL,
        files.commentXml
      );
      // ownerコメントXML (fork='1') を読んでマージ。@ジャンプ等で全件必要なのでサンプリングしない
      let ownerCs: NNDDREComment[] = [];
      if (files?.ownerCommentXml) {
        ownerCs = await window.nndd
          .invoke<NNDDREComment[]>(window.nndd.channels.COMMENT_READ_LOCAL, files.ownerCommentXml)
          .catch(() => []);
      }
      if (files?.nowCommentJson) {
        const nos = await window.nndd.invoke<number[]>(
          window.nndd.channels.COMMENT_NOW_IDS_READ,
          files.nowCommentJson
        );
        const noSet = new Set(nos);
        setComments([...cs.filter((c) => noSet.has(c.no)), ...ownerCs].map(ensureCommandResolved));
      } else {
        const MAX_COMMENTS = 1000;
        const sorted = [...cs].sort((a, b) => a.vposMs - b.vposMs);
        const sampled = sorted.length <= MAX_COMMENTS
          ? sorted
          : Array.from(
              { length: MAX_COMMENTS },
              (_, i) => sorted[Math.floor(i * sorted.length / MAX_COMMENTS)]
            );
        setComments([...sampled, ...ownerCs].map(ensureCommandResolved));
      }
    };

    const loadThumbInfo = async (): Promise<void> => {
      if (!files?.thumbInfoXml) return;
      const w = await window.nndd.invoke<WatchPageInfo | null>(
        window.nndd.channels.THUMB_INFO_XML_READ,
        files.thumbInfoXml
      );
      if (!w) return;
      setWatch(w);
      if (w.owner?.id) {
        window.nndd
          .invoke<string | null>(IpcChannel.USER_ICON_FETCH, w.owner.id)
          .then((iconUrl) => {
            if (iconUrl) {
              setWatch((prev) =>
                prev && prev.owner
                  ? { ...prev, owner: { ...prev.owner!, iconUrl } }
                  : prev
              );
            }
          })
          .catch(() => {});
      }
    };

    await Promise.all([
      loadComments().catch((e) => console.warn('local comment read failed:', e)),
      loadThumbInfo().catch((e) => console.warn('local info.txt read failed:', e)),
    ]);

    // ローカルXMLにはシリーズ情報がないため、ニコニコIDが特定できる場合はAPIから非同期補完
    if (m) {
      window.nndd
        .invoke<WatchPageInfo | null>(window.nndd.channels.VIDEO_GET_WATCH_INFO, guessId)
        .then((online) => {
          if (online?.series) {
            setWatch((prev) => {
              if (prev) return { ...prev, series: online.series };
              return online;
            });
          }
        })
        .catch(() => {});
    }
  };

  const getNextVideoId = (): string | null => {
    if (isLocalRef.current) return null;
    const currentId = watchRef.current?.videoId ?? playInfoRef.current?.videoId;
    if (autoNextSeriesRef.current) {
      const items = seriesItemsRef.current;
      const idx = items.findIndex((i) => i.videoId === currentId);
      if (idx >= 0 && idx < items.length - 1) return items[idx + 1].videoId;
    }
    const pl = searchPlaylistRef.current;
    if (pl.length > 0) {
      const idx = pl.indexOf(currentId ?? '');
      if (idx >= 0 && idx < pl.length - 1) return pl[idx + 1];
    }
    return null;
  };

  const advanceToNextVideo = (): boolean => {
    const isAudio = audioOnlyRef.current || undefined;

    if (autoNextSeriesRef.current) {
      const items = seriesItemsRef.current;
      const currentId = watchRef.current?.videoId ?? playInfoRef.current?.videoId;
      const idx = items.findIndex((i) => i.videoId === currentId);
      if (idx >= 0 && idx < items.length - 1) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          videoId: items[idx + 1].videoId, autoNext: true, audioOnly: isAudio,
        });
        return true;
      }
      if (idx === items.length - 1 && seriesPageRef.current < seriesTotalPagesRef.current) {
        const nextPage = seriesPageRef.current + 1;
        window.nndd.invoke<{ items: { videoId: string }[]; page: number; totalPages: number }>(
          IpcChannel.SERIES_FETCH, seriesIdRef.current, undefined, nextPage
        ).then((r) => {
          seriesItemsRef.current = r.items as import('@shared/types').MyListItem[];
          seriesPageRef.current = r.page;
          seriesTotalPagesRef.current = r.totalPages;
          if (r.items.length > 0) {
            window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
              videoId: r.items[0].videoId, autoNext: true, audioOnly: isAudio,
            });
          }
        }).catch(() => {});
        return true;
      }
    }

    if (autoNextFolderRef.current && isLocalRef.current) {
      const vids = folderVideosRef.current;
      const idx = vids.indexOf(currentLocalPathRef.current);
      if (idx >= 0 && idx < vids.length - 1) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          localPath: vids[idx + 1], folderPlaylist: vids, autoNext: true, audioOnly: isAudio,
        });
        return true;
      }
    }

    const pl = searchPlaylistRef.current;
    if (pl.length > 0) {
      const currentId = watchRef.current?.videoId ?? playInfoRef.current?.videoId;
      const idx = pl.indexOf(currentId ?? '');
      if (idx >= 0 && idx < pl.length - 1) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          videoId: pl[idx + 1], searchPlaylist: pl, autoNext: true, audioOnly: isAudio,
        });
        return true;
      }
    }

    return false;
  };

  const getActivePlaylist = (): { type: 'search'; list: string[]; idx: number } | { type: 'folder'; list: string[]; idx: number } | { type: 'series'; list: import('@shared/types').MyListItem[]; idx: number } | null => {
    const currentId = watchRef.current?.videoId ?? playInfoRef.current?.videoId;

    const pl = searchPlaylistRef.current;
    if (pl.length > 0 && currentId) {
      const idx = pl.indexOf(currentId);
      if (idx >= 0) return { type: 'search', list: pl, idx };
    }

    const vids = folderVideosRef.current;
    if (vids.length > 0 && isLocalRef.current) {
      const idx = vids.indexOf(currentLocalPathRef.current);
      if (idx >= 0) return { type: 'folder', list: vids, idx };
    }

    const items = seriesItemsRef.current;
    if (items.length > 0 && currentId) {
      const idx = items.findIndex((i) => i.videoId === currentId);
      if (idx >= 0) return { type: 'series', list: items, idx };
    }

    return null;
  };

  const skipToNext = (): void => {
    const isAudio = audioOnlyRef.current || undefined;
    const active = getActivePlaylist();
    if (!active) return;

    if (active.type === 'search') {
      if (active.idx < active.list.length - 1) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          videoId: active.list[active.idx + 1], searchPlaylist: active.list, audioOnly: isAudio,
        });
      }
      return;
    }

    if (active.type === 'folder') {
      if (active.idx < active.list.length - 1) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          localPath: active.list[active.idx + 1], folderPlaylist: active.list, audioOnly: isAudio,
        });
      }
      return;
    }

    if (active.type === 'series') {
      if (active.idx < active.list.length - 1) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          videoId: active.list[active.idx + 1].videoId, audioOnly: isAudio,
        });
        return;
      }
      if (seriesPageRef.current < seriesTotalPagesRef.current) {
        const nextPage = seriesPageRef.current + 1;
        window.nndd.invoke<{ items: { videoId: string }[]; page: number; totalPages: number }>(
          IpcChannel.SERIES_FETCH, seriesIdRef.current, undefined, nextPage
        ).then((r) => {
          seriesItemsRef.current = r.items as import('@shared/types').MyListItem[];
          setSeriesItems(r.items as import('@shared/types').MyListItem[]);
          seriesPageRef.current = r.page;
          seriesTotalPagesRef.current = r.totalPages;
          if (r.items.length > 0) {
            window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
              videoId: r.items[0].videoId, audioOnly: isAudio,
            });
          }
        }).catch(() => {});
      }
    }
  };

  const skipToPrev = (): void => {
    const isAudio = audioOnlyRef.current || undefined;
    const active = getActivePlaylist();
    if (!active) return;

    if (active.type === 'search') {
      if (active.idx > 0) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          videoId: active.list[active.idx - 1], searchPlaylist: active.list, audioOnly: isAudio,
        });
      }
      return;
    }

    if (active.type === 'folder') {
      if (active.idx > 0) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          localPath: active.list[active.idx - 1], folderPlaylist: active.list, audioOnly: isAudio,
        });
      }
      return;
    }

    if (active.type === 'series') {
      if (active.idx > 0) {
        window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
          videoId: active.list[active.idx - 1].videoId, audioOnly: isAudio,
        });
        return;
      }
      if (seriesPageRef.current > 1) {
        const prevPage = seriesPageRef.current - 1;
        window.nndd.invoke<{ items: { videoId: string }[]; page: number; totalPages: number }>(
          IpcChannel.SERIES_FETCH, seriesIdRef.current, undefined, prevPage
        ).then((r) => {
          seriesItemsRef.current = r.items as import('@shared/types').MyListItem[];
          setSeriesItems(r.items as import('@shared/types').MyListItem[]);
          seriesPageRef.current = r.page;
          seriesTotalPagesRef.current = r.totalPages;
          if (r.items.length > 0) {
            window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, {
              videoId: r.items[r.items.length - 1].videoId, audioOnly: isAudio,
            });
          }
        }).catch(() => {});
      }
    }
  };

  const toggleFullscreen = useCallback((): void => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  // 再生開始から HISTORY_RECORD_THRESHOLD_SEC 秒経過したら履歴に記録 (1回のみ)
  useEffect(() => {
    if (!video) return;
    const onTime = (): void => {
      if (historyRecordedRef.current) return;
      if (video.currentTime < HISTORY_RECORD_THRESHOLD_SEC) return;
      const info = playInfoRef.current;
      if (!info) return;
      historyRecordedRef.current = true;
      window.nndd
        .invoke(window.nndd.channels.HISTORY_ADD, info)
        .catch((e) => console.warn('history add failed', e));
    };
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, [video]);

  // owner コメントの @ジャンプ / ＠ジャンプ: 指定 vpos に達したら別動画へジャンプ
  // 半角・全角 @ 両対応。fork は 'owner' (ストリーミング) / '1' (ローカルXML) の両方を見る
  useEffect(() => {
    if (!video) return;
    const jumpComments = comments.filter(
      (c) =>
        (c.fork === 'owner' || c.fork === '1') &&
        /[＠@]ジャンプ/.test((c.mail ?? '') + ' ' + (c.text ?? ''))
    );
    if (jumpComments.length === 0) return;
    const triggered = new Set<number>();
    const onTime = (): void => {
      if (isLocalRef.current && autoNextFolderRef.current) return;
      const nowMs = video.currentTime * 1000;
      for (const c of jumpComments) {
        if (!triggered.has(c.no) && nowMs >= c.vposMs) {
          triggered.add(c.no);
          // text から @ジャンプ 部分を除去して動画ID抽出
          const rawText = (c.text ?? '').replace(/[＠@]ジャンプ\s*/g, '').trim();
          const m = rawText.match(/((?:sm|nm|so|ax|sd|ca|cd|cw|zb|ze|yo)\d+)/);
          const targetId = m ? m[1] : rawText;
          if (targetId) {
            window.nndd.invoke(IpcChannel.VIDEO_OPEN_PLAYER, { videoId: targetId, autoNext: true });
          }
        }
      }
    };
    video.addEventListener('timeupdate', onTime);
    return () => video.removeEventListener('timeupdate', onTime);
  }, [video, comments]);

  // ── コメントウィンドウ連携 ──────────────────────────────
  // comments 変更時にプッシュ (ウィンドウが開いていれば main が転送)
  useEffect(() => {
    window.nndd.send(IpcChannel.COMMENT_WINDOW_PUSH, comments);
  }, [comments]);

  // 250ms ごとに再生位置をプッシュ + 残り5秒で次の動画をプリロード
  useEffect(() => {
    const id = window.setInterval(() => {
      const v = videoElementRef.current;
      const t = v?.currentTime ?? 0;
      window.nndd.send(IpcChannel.COMMENT_WINDOW_TIME, t);

      if (v && !isLocalRef.current && preloadRef.current === null && v.duration > 0) {
        const remaining = v.duration - t;
        if (remaining > 0 && remaining <= 5) {
          const nextId = getNextVideoId();
          if (nextId) {
            preloadRef.current = { videoId: nextId };
            (async () => {
              try {
                const watchInfo = await window.nndd.invoke<WatchPageInfo>(
                  window.nndd.channels.VIDEO_GET_WATCH_INFO, nextId
                );
                const avail = watchInfo.domandVideos
                  .filter((q) => q.isAvailable)
                  .sort((a, b) => b.qualityLevel - a.qualityLevel);
                const qualityId = avail[0]?.id ?? null;
                const stream = await window.nndd.invoke<{
                  contentUrl: string | null;
                  isDMS: boolean;
                  isHls?: boolean;
                  ffplay?: boolean;
                  niconico?: boolean;
                  error?: string;
                }>(window.nndd.channels.VIDEO_GET_STREAM_URL, nextId, watchInfo, audioOnlyRef.current, qualityId);
                if (!stream.error) {
                  preloadRef.current = { videoId: nextId, watchInfo, stream };
                } else {
                  preloadRef.current = null;
                }
              } catch {
                preloadRef.current = null;
              }
            })();
          }
        }
      }
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  // コメントウィンドウからのシーク要求を受信
  useEffect(() => {
    const off = window.nndd.on(
      IpcChannel.PLAYER_SEEK,
      (timeSec: number) => {
        const v = videoElementRef.current;
        if (v) v.currentTime = timeSec;
      }
    );
    return off;
  }, []);

  // コメントウィンドウからの過去コメント配列を受信
  useEffect(() => {
    const off = window.nndd.on(
      IpcChannel.PLAYER_PAST_COMMENTS,
      (cs: NNDDREComment[] | null) => {
        if (cs === null || cs.length === 0) {
          setPastComments([]);
          setShowPastComments(false);
        } else {
          setPastComments(cs);
          setShowPastComments(true);
        }
      }
    );
    return off;
  }, []);

  const commentsRef = useRef<NNDDREComment[]>([]);
  useEffect(() => { commentsRef.current = comments; }, [comments]);

  const localCommentXmlPathRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    localCommentXmlPathRef.current = localCommentXmlPath;
  }, [localCommentXmlPath]);

  const localIchibaHtmlPathRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    localIchibaHtmlPathRef.current = localIchibaHtmlPath;
  }, [localIchibaHtmlPath]);

  const openCommentWindow = useCallback((): void => {
    const info = playInfoRef.current;
    window.nndd
      .invoke(IpcChannel.COMMENT_WINDOW_OPEN, {
        videoId: info?.videoId ?? '',
        title: info?.title ?? '',
        comments: commentsRef.current,
        localCommentXmlPath: localCommentXmlPathRef.current,
        ichibaHtmlPath: localIchibaHtmlPathRef.current
      })
      .then(() => setCommentWindowOpen(true))
      .catch(() => {});
  }, []); // commentsRef は ref なので deps 不要

  // 動画が変わったとき (loading 完了 + src セット) に自動オープン
  const autoOpenDoneRef = useRef(false);
  useEffect(() => {
    if (loading || !src) {
      autoOpenDoneRef.current = false; // リセット: 次の動画でまた発火可能に
      return;
    }
    if (autoOpenDoneRef.current) return;
    autoOpenDoneRef.current = true;
    if (commentListDisplay === 'window' && !audioOnly) {
      openCommentWindow();
    }
  }, [loading, src, commentListDisplay, commentWindowAutoOpen, openCommentWindow, audioOnly]);


  // フルスクリーン状態追跡 (DOM fullscreen + BrowserWindow fullscreen + niconico)
  useEffect(() => {
    const onFsChange = (): void => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    // BrowserWindow レベルのフルスクリーン (OS ボタン)
    const offWin = window.electron.ipcRenderer.on(
      'nndd:player:window:fullscreen',
      (_e, full: boolean) => setIsFullscreen(full)
    );
    // niconicoプレイヤー内フルスクリーン
    const offNico = window.electron.ipcRenderer.on(
      'nndd:player:niconico:fullscreen',
      (_e, full: boolean) => setIsFullscreen(full)
    );
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      offWin();
      offNico();
    };
  }, []);

  const showControlsTemporarily = useCallback((): void => {
    setShowControls(true);
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      setShowControls(false);
    }, 2500);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = (): void => showControlsTemporarily();
    const onLeave = (): void => {
      if (isFullscreen) setShowControls(false);
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', onLeave);
    // 初期はコントロール表示
    showControlsTemporarily();
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, [isFullscreen, showControlsTemporarily]);

  const currentVideoId = watch?.videoId ?? playInfoRef.current?.videoId;
  const canSkipNext = useMemo(() => {
    if (searchPlaylist.length > 0 && currentVideoId) {
      const idx = searchPlaylist.indexOf(currentVideoId);
      return idx >= 0 && idx < searchPlaylist.length - 1;
    }
    if (folderVideos.length > 0 && isLocal) {
      const idx = folderVideos.indexOf(currentLocalPathRef.current);
      return idx >= 0 && idx < folderVideos.length - 1;
    }
    if (seriesItems.length > 0 && currentVideoId) {
      const idx = seriesItems.findIndex((i) => i.videoId === currentVideoId);
      if (idx >= 0 && idx < seriesItems.length - 1) return true;
      return seriesPageRef.current < seriesTotalPagesRef.current;
    }
    return undefined;
  }, [searchPlaylist, folderVideos, seriesItems, currentVideoId, isLocal]);

  const canSkipPrev = useMemo(() => {
    if (searchPlaylist.length > 0 && currentVideoId) {
      const idx = searchPlaylist.indexOf(currentVideoId);
      return idx > 0;
    }
    if (folderVideos.length > 0 && isLocal) {
      const idx = folderVideos.indexOf(currentLocalPathRef.current);
      return idx > 0;
    }
    if (seriesItems.length > 0 && currentVideoId) {
      const idx = seriesItems.findIndex((i) => i.videoId === currentVideoId);
      if (idx > 0) return true;
      return seriesPageRef.current > 1;
    }
    return undefined;
  }, [searchPlaylist, folderVideos, seriesItems, currentVideoId, isLocal]);

  useKeyboardShortcuts({
    togglePlay: () => {
      if (!video) return;
      if (video.paused) video.play();
      else video.pause();
    },
    toggleMute: () => {
      if (!video) return;
      video.muted = !video.muted;
    },
    toggleFullscreen,
    toggleComments: () => setShowComments((v) => !v),
    seek: (delta) => {
      if (!video) return;
      video.currentTime = Math.max(
        0,
        Math.min(video.duration || 0, video.currentTime + delta)
      );
    },
    volumeUp: () => {
      if (!video) return;
      video.volume = Math.min(1, video.volume + 0.05);
    },
    volumeDown: () => {
      if (!video) return;
      video.volume = Math.max(0, video.volume - 0.05);
    },
    skipNext: skipToNext,
    skipPrev: skipToPrev,
  });

  const progressPct = streamProgress
    ? Math.floor(streamProgress.progress * 100)
    : null;
  const loadingLabel = (() => {
    if (!loading && !streamProgress) return error;
    if (streamProgress?.phase === 'downloading') {
      return `ダウンロード中 ${progressPct}% ${streamProgress.speed ?? ''} ${streamProgress.eta ? `ETA ${streamProgress.eta}` : ''}`;
    }
    if (streamProgress?.phase === 'preparing') return '準備中…';
    if (streamProgress?.phase === 'failed')
      return `失敗: ${streamProgress.message ?? ''}`;
    return loading ? '読み込み中…' : null;
  })();

  if (audioOnly) {
    return (
      <div className="flex flex-col h-full bg-nndd-bg text-nndd-text select-none">
        {src && (
          <VideoPlayer
            src={src}
            isHls={isHls}
            comments={[]}
            videoRefCallback={setVideoWithRef}
            videoId={watch?.videoId ?? playInfoRef.current?.videoId}
            className="w-0 h-0"
            audioOnly
            onVideoError={(code) => { handleVideoError(code).catch(console.error); }}
            onEnded={() => { consecutiveSkipRef.current = 0; advanceToNextVideo(); }}
          />
        )}
        <div className="flex-1 flex items-center px-3 gap-3 min-w-0">
          <div className="truncate text-sm font-semibold flex-1">
            ♪ {watch?.title ?? playInfoRef.current?.title ?? ''}
          </div>
        </div>
        <VideoController
          video={video}
          showComments={false}
          onToggleComments={() => {}}
          hideCommentToggle
          canSkipPrev={canSkipPrev}
          canSkipNext={canSkipNext}
          onSkipPrev={skipToPrev}
          onSkipNext={skipToNext}
          availableQualities={availableQualities}
          currentQualityId={selectedQualityId ?? undefined}
          onQualityChange={(id) => { handleQualityChange(id).catch(console.error); }}
          audioOnly={audioOnly}
        />
        {(loading || error) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white text-xs">
            {error ?? '読み込み中...'}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full bg-black text-nndd-text">
      {/* ドラッグ中のカーソルちらつき防止オーバーレイ */}
      {isSidebarDragging && (
        <div className="fixed inset-0 z-50 cursor-col-resize" />
      )}
      <div ref={containerRef} className="flex-1 flex flex-col min-h-0 relative group">
        {niconicoMode ? (
          <div ref={webviewWrapperRef} className="flex-1 min-h-0" />
        ) : (
          <>
            <div className="flex-1 relative min-h-0">
              {src ? (
                <VideoPlayer
                  src={src}
                  isHls={isHls}
                  comments={renderedComments}
                  commentConfig={commentConfig}
                  videoRefCallback={setVideoWithRef}
                  pendingSeekRef={pendingSeekRef}
                  loading={loading && !src}
                  videoId={watch?.videoId ?? playInfoRef.current?.videoId}
                  className="w-full h-full"
                  onVideoError={(code) => { handleVideoError(code).catch(console.error); }}
                  audioOnly={audioOnly}
                  onEnded={() => { consecutiveSkipRef.current = 0; advanceToNextVideo(); }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-nndd-subtext">
                  {loadingLabel ?? (error ?? '再生待機中')}
                </div>
              )}
            </div>
            <div
              className={[
                'transition-opacity duration-200',
                isFullscreen
                  ? 'absolute left-0 right-0 bottom-0 z-10'
                  : 'static',
                showControls
                  ? 'opacity-100 pointer-events-auto'
                  : 'opacity-0 pointer-events-none'
              ].join(' ')}
            >
              {(commentListDisplay === 'window' || (isLocal && folderVideos.length > 1)) && (
                <div className="flex items-center justify-end gap-2 px-2 py-0.5 bg-black/80" style={{ zoom: controlZoom }}>
                  {isLocal && folderVideos.length > 1 && (
                    <label className="flex items-center gap-1 text-xs text-nndd-subtext cursor-pointer select-none hover:text-nndd-text">
                      <input
                        type="checkbox"
                        checked={autoNextFolder}
                        onChange={(e) => {
                          autoNextFolderRef.current = e.target.checked;
                          setAutoNextFolder(e.target.checked);
                          window.nndd.invoke(window.nndd.channels.CONFIG_SET, 'player.autoNextFolder', e.target.checked).catch(() => {});
                        }}
                        className="cursor-pointer"
                      />
                      フォルダ連続再生
                    </label>
                  )}
                  {commentListDisplay === 'window' && (
                    <button
                      onClick={openCommentWindow}
                      className="text-xs px-2 py-0.5 rounded border border-nndd-border text-nndd-subtext hover:text-nndd-text"
                    >
                      💬 コメント一覧
                    </button>
                  )}
                </div>
              )}
              <VideoController
                video={video}
                showComments={showComments}
                onToggleComments={() => setShowComments((v) => !v)}
                onToggleFullscreen={toggleFullscreen}
                canSkipPrev={canSkipPrev}
                canSkipNext={canSkipNext}
                onSkipPrev={skipToPrev}
                onSkipNext={skipToNext}
                availableQualities={availableQualities}
                currentQualityId={selectedQualityId ?? undefined}
                onQualityChange={(id) => { handleQualityChange(id).catch(console.error); }}
                audioOnly={audioOnly}
              />
            </div>
          </>
        )}
      </div>
      {!isFullscreen && (
        <>
          {/* ドラッグハンドル (境界線) */}
          <div
            className="w-1 shrink-0 bg-nndd-border hover:bg-nndd-accent/70 active:bg-nndd-accent cursor-col-resize transition-colors"
            onMouseDown={onSidebarDividerMouseDown}
            style={{ userSelect: 'none' }}
            title="ドラッグでサイズ変更"
          />
          <aside
            className="shrink-0 bg-nndd-bg overflow-hidden flex flex-col"
            style={{ width: sidebarWidth }}
          >
            <VideoInfoView
              watch={watch}
              comments={comments}
              video={video}
              videoId={playInfoRef.current?.videoId}
              isLocal={isLocal}
              localCommentXmlPath={localCommentXmlPath}
              ichibaHtmlPath={localIchibaHtmlPath}
              showCommentTab={commentListDisplay === 'tab'}
              onCommentsUpdated={(cs) => setComments(cs.map(ensureCommandResolved))}
              onPastCommentsLoaded={(cs) => setPastComments(cs)}
              onPastCommentTabActive={(active) => setShowPastComments(active)}
              autoNextSeries={autoNextSeries}
              onAutoNextChange={(v) => { autoNextSeriesRef.current = v; setAutoNextSeries(v); }}
              onSeriesPageLoaded={(items, page, totalPages, sid) => {
                seriesItemsRef.current = items;
                setSeriesItems(items);
                seriesPageRef.current = page;
                seriesTotalPagesRef.current = totalPages;
                seriesIdRef.current = sid;
              }}
            />
          </aside>
        </>
      )}
    </div>
  );
}

/**
 * 任意の 3 秒ウィンドウ内に同時表示されるコメントを maxCount 件に制限する。
 * スライディングウィンドウ (O(n)) で処理するため 10 万件でも高速。
 * maxCount=0 の場合は全件返す。
 */
function limitSimultaneousComments(comments: NNDDREComment[], maxCount: number): NNDDREComment[] {
  if (maxCount <= 0 || comments.length === 0) return comments;
  const SHOW_MS = 3000; // NiconiComments デフォルト表示時間に合わせる
  // vposMs 昇順ソート (既にソート済みの場合はほぼコスト 0)
  const sorted = [...comments].sort((a, b) => a.vposMs - b.vposMs);
  const result: NNDDREComment[] = [];
  let winStart = 0; // result 内のウィンドウ先頭インデックス

  for (const c of sorted) {
    // ウィンドウ先頭を進める (表示期限切れコメントを除外)
    while (winStart < result.length && result[winStart].vposMs < c.vposMs - SHOW_MS) {
      winStart++;
    }
    const concurrent = result.length - winStart;
    if (concurrent < maxCount) {
      result.push(c);
    }
  }
  return result;
}
