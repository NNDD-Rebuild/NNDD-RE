import { useEffect, useRef, useState } from 'react';
import type { NNDDREComment, WatchPageInfo, DomandStreamCandidate, NicowariContent } from '@shared/types';
import { IpcChannel } from '@shared/types';
import { buildLocalUrl, isLocalMediaUrl } from '@shared/constants';
import { VideoPlayer, type VideoPlayerHandle } from './components/player/VideoPlayer';
import { VideoController } from './components/player/VideoController';
import { VideoInfoView } from './components/player/VideoInfoView';
import { HistoryBlockedDialog } from './components/player/HistoryBlockedDialog';
import { NicowariBanner } from './components/player/NicowariBanner';
import { ensureCommandResolved } from './util/commentCommands';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useConfig } from './hooks/useConfig';
import { toUserFriendlyErrorMessage } from '@shared/utils/errorMessage';
import {
  pickDefaultQualityId,
  readLocalComments,
  type InitParams,
  type PlayInfo,
  type PreloadEntry,
  type StreamUrlResult
} from './hooks/player/playerUtils';
import { usePlaylist } from './hooks/player/usePlaylist';
import { useSidebarResize } from './hooks/player/useSidebarResize';
import { useCommentRenderSettings } from './hooks/player/useCommentRenderSettings';
import { useNiconicoEmbed } from './hooks/player/useNiconicoEmbed';
import { useHistoryBlockedPrompt } from './hooks/player/useHistoryBlockedPrompt';
import { useWatchHistory } from './hooks/player/useWatchHistory';
import { useDiscordPresence } from './hooks/player/useDiscordPresence';
import { useJumpCommand, useNicowari } from './hooks/player/useOwnerCommentCommands';
import { usePlaybackTicker } from './hooks/player/usePlaybackTicker';
import { useCommentWindow } from './hooks/player/useCommentWindow';
import { useFullscreenControls } from './hooks/player/useFullscreenControls';

interface StreamProgress {
  videoId: string;
  progress: number;
  phase: 'preparing' | 'downloading' | 'ready' | 'failed';
  localPath?: string;
  speed?: string;
  eta?: string;
  message?: string;
}

/** 連続再生中に再生できない動画を自動スキップする上限 */
const MAX_CONSECUTIVE_SKIPS = 10;

/**
 * 動画プレイヤーウィンドウのルートコンポーネント。
 *
 * メインプロセスから IPC `nndd:player:init` で起動情報 (videoId or localPath) を受け取り、
 * ストリーミング or ローカル再生を行う。
 * 責務ごとの処理は hooks/player/ 配下のフックに分けている。
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
  /** ローカル再生中の動画に付いているユーザーニコ割SWF */
  const [nicowariFiles, setNicowariFiles] = useState<string[]>([]);
  /** 表示中のユーザーニコ割 */
  const [activeNicowari, setActiveNicowari] = useState<NicowariContent | null>(null);
  /** ニコ割の「停止」指定で本編を一時停止したか (終了時に再開するため) */
  const pausedByNicowariRef = useRef(false);
  const [pastComments, setPastComments] = useState<NNDDREComment[]>([]);
  const [showPastComments, setShowPastComments] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(true);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  /** イベントリスナー内でstaleにならないようvideo stateをrefでも持つ */
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const setVideoWithRef = (el: HTMLVideoElement | null): void => {
    videoElementRef.current = el;
    setVideo(el);
  };
  const videoPlayerRef = useRef<VideoPlayerHandle>(null);
  const [docPipActive, setDocPipActive] = useState(false);
  const [isLocal, setIsLocal] = useState(false);
  const isLocalRef = useRef(false);
  const [localCommentXmlPath, setLocalCommentXmlPath] = useState<string | undefined>(undefined);
  const [localIchibaHtmlPath, setLocalIchibaHtmlPath] = useState<string | undefined>(undefined);
  // 進捗イベントの受信は未接続 (現状は常に null)
  const [streamProgress] = useState<StreamProgress | null>(null);
  const [audioOnly, setAudioOnly] = useState(false);
  const audioOnlyRef = useRef(false);
  const [availableQualities, setAvailableQualities] = useState<DomandStreamCandidate[]>([]);
  const [selectedQualityId, setSelectedQualityId] = useState<string | null>(null);
  const consecutiveSkipRef = useRef(0);
  const preloadRef = useRef<PreloadEntry | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const webviewWrapperRef = useRef<HTMLDivElement>(null);
  /** レジューム位置クリア (終了間際判定) を1回だけ発行するためのフラグ */
  const resumeFinishedRef = useRef(false);
  /** src切替後に再生位置を復元するためのRef (nndd-stream→nndd-re-local自動切替時、および画質変更時に使用) */
  const pendingSeekRef = useRef(0);
  const srcRef = useRef('');
  const playInfoRef = useRef<PlayInfo | null>(null);

  const currentVideoId = watch?.videoId ?? playInfoRef.current?.videoId;

  useEffect(() => { srcRef.current = src; }, [src]);
  useEffect(() => { isLocalRef.current = isLocal; }, [isLocal]);
  useEffect(() => { watchRef.current = watch; }, [watch]);

  const {
    autoNextSeries,
    autoNextRelated,
    autoNextFolder,
    autoNextFolderRef,
    folderVideos,
    currentLocalPathRef,
    canSkipNext,
    canSkipPrev,
    updateSearchPlaylist,
    updateFolderVideos,
    isAutoPlayActive,
    getNextVideoId,
    advanceToNextVideo,
    skipToNext,
    skipToPrev,
    onAutoNextFolderChange,
    onAutoNextSeriesChange,
    onSeriesPageLoaded,
    onAutoNextRelatedChange,
    onRelatedLoaded
  } = usePlaylist({
    watchVideoId: watch?.videoId,
    currentVideoId,
    isLocal,
    isLocalRef,
    watchRef,
    playInfoRef,
    audioOnlyRef
  });

  // テーマ適用
  useEffect(() => {
    window.nndd.invoke<'dark' | 'light'>(window.nndd.channels.CONFIG_GET, 'ui.theme')
      .then((v) => { if (v === 'light') document.documentElement.classList.add('light'); })
      .catch(() => {});
  }, []);

  const { sidebarWidth, isSidebarDragging, handleTabsOverflow, onSidebarDividerMouseDown } =
    useSidebarResize();

  const [defaultQuality] = useConfig<'highest' | number>('player.defaultQuality', 'highest');
  const [controlsAlwaysVisible] = useConfig<boolean>('player.controlsAlwaysVisible', true);
  const defaultQualityRef = useRef(defaultQuality);
  defaultQualityRef.current = defaultQuality;
  const { renderedComments, commentConfig } = useCommentRenderSettings({
    comments,
    pastComments,
    showComments,
    showPastComments
  });
  const [commentListDisplay] = useConfig<'tab' | 'window'>(
    'player.commentListDisplay',
    'tab'
  );
  /** ブラウザ版は別ウィンドウを開けないため、window設定でも常にタブ表示にフォールバックする */
  const isWebPlayer = (globalThis as { __NNDD_WEB__?: boolean }).__NNDD_WEB__ === true;
  /** スマホ (タッチデバイス) のブラウザ版: 操作バーは常時表示せず一定時間で消す */
  const isMobileTouch = isWebPlayer && typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const [commentWindowAutoOpen] = useConfig<boolean>(
    'player.commentWindowAutoOpen',
    false
  );
  const [controlUiSize] = useConfig<'small' | 'normal' | 'large'>('player.controlUiSize', 'small');
  const controlZoom = controlUiSize === 'large' ? 1.5 : controlUiSize === 'normal' ? 1.3 : 1;

  useNiconicoEmbed(niconicoMode, webviewWrapperRef, playInfoRef);

  const { showHistoryBlockedDialog, askHistoryBlocked, handleHistoryBlockedChoice } =
    useHistoryBlockedPrompt();

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
          setNicowariFiles([]);
          setActiveNicowari(null);
          pausedByNicowariRef.current = false;
          const isAudioOnly = !!params.audioOnly;
          audioOnlyRef.current = isAudioOnly;
          setAudioOnly(isAudioOnly);
          if (params.searchPlaylist && params.searchPlaylist.length > 0) {
            updateSearchPlaylist(params.searchPlaylist);
          } else {
            updateSearchPlaylist([]);
          }
          if (params.localPath) {
            await initLocal(params.localPath, params.localFiles, params.folderPlaylist, params.resumeSec);
          } else if (params.videoId) {
            await initStreaming(params.videoId, isAudioOnly, params.resumeSec);
          } else if (params.streamUrl) {
            initStreamUrl(params.streamUrl);
          } else {
            setError('再生対象が指定されていません');
          }
        } catch (e) {
          const rawMsg = e instanceof Error ? e.message : String(e);
          if (rawMsg.includes('HISTORY_BLOCKED:')) {
            const reopening = await handleHistoryBlocked(params);
            if (!reopening) {
              setError('視聴履歴非表示中はこの動画を再生できません（年齢制限・限定公開の可能性があります）。');
            }
            return;
          }
          const msg = toUserFriendlyErrorMessage(e);
          const isAutoPlay = params.autoNext && isAutoPlayActive();
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
    if (code === 4 && isLocalMediaUrl(srcRef.current)) {
      const vid = playInfoRef.current?.videoId;
      if (!vid) return;
      setSrc('');
      setIsHls(false);
      await window.nndd.invoke(window.nndd.channels.VIDEO_DELETE_CACHE, vid);
      try {
        await initStreaming(vid, audioOnlyRef.current);
      } catch (e) {
        const isAutoPlay = isAutoPlayActive();
        const msg = toUserFriendlyErrorMessage(e);
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

  /**
   * hideWatchHistory設定下でゲスト扱いのため再生に失敗した場合 (HISTORY_BLOCKED マーカー) に、
   * 設定 sensitiveVideoHistoryPolicy に従って対応する。
   * ウィンドウは開き直さず、同一ウィンドウ内で forceAllowHistory:true として
   * WatchInfo/ストリームURLを再取得する (main側 HlsSessionInterceptor が
   * watchInfo.guestFetched を見てCookie扱いを動的に切り替えるため、再生成不要)。
   * 戻り値 true: 再試行済み (成功/失敗いずれもこの中でハンドリング済み)。false: 拒否/対象外。
   */
  const handleHistoryBlocked = async (params: InitParams): Promise<boolean> => {
    const policy = await window.nndd.invoke<'ask' | 'allow' | 'deny'>(
      window.nndd.channels.CONFIG_GET,
      'sensitiveVideoHistoryPolicy'
    ).catch(() => 'ask' as const);

    if (policy === 'deny') return false;
    const allow = policy === 'allow' ? true : await askHistoryBlocked();
    if (!allow) return false;

    if (params.videoId) {
      try {
        await initStreaming(params.videoId, !!params.audioOnly, params.resumeSec, true);
      } catch (e) {
        setError(toUserFriendlyErrorMessage(e));
      }
    }
    return true;
  };

  const initStreaming = async (
    videoId: string,
    isAudioOnly?: boolean,
    resumeSec?: number,
    forceAllowHistory?: boolean
  ): Promise<void> => {
    const cached = preloadRef.current?.videoId === videoId ? preloadRef.current : null;
    preloadRef.current = null;

    setIsLocal(false);
    setWatch(null);
    watchRef.current = null;
    playInfoRef.current = { videoId, title: videoId, thumbnailUrl: '', isLocal: false };
    setLocalCommentXmlPath(undefined);
    setPastComments([]);
    setShowPastComments(false);
    updateFolderVideos([]);
    setAvailableQualities([]);
    setSelectedQualityId(null);
    // 1. WatchPageInfo を取得（プリロードキャッシュ優先）
    const w = cached?.watchInfo
      ?? await window.nndd.invoke<WatchPageInfo>(window.nndd.channels.VIDEO_GET_WATCH_INFO, videoId, forceAllowHistory);
    setWatch(w);
    if (w.channel !== null && !w.isDownloadable) {
      throw new Error(`チャンネル限定動画です。「${w.channel.name}」への加入が必要です。`);
    }
    resumeFinishedRef.current = false;
    playInfoRef.current = {
      videoId,
      title: w?.title ?? videoId,
      thumbnailUrl: w?.thumbnail?.url ?? '',
      discordThumbnailUrl: w?.thumbnail?.remoteUrl ?? '',
      isLocal: false
    };

    // 画質リストをセット (DMS のみ)
    const available = w.domandVideos
      .filter(v => v.isAvailable)
      .sort((a, b) => b.qualityLevel - a.qualityLevel);
    setAvailableQualities(available);
    const defaultQualityId = pickDefaultQualityId(available, defaultQualityRef.current);
    setSelectedQualityId(defaultQualityId);

    // 2. コメント取得をバックグラウンドで開始（ストリームURL取得と並列実行）
    const commentsPromise = isAudioOnly
      ? Promise.resolve<NNDDREComment[]>([])
      : window.nndd.invoke<NNDDREComment[]>(
          window.nndd.channels.VIDEO_GET_COMMENTS, videoId, w
        ).catch((e: unknown) => {
          console.warn('comment fetch failed:', e);
          return [] as NNDDREComment[];
        });

    // 3. ストリーミング URL を取得（プリロードキャッシュ優先、コメントと並列）
    const stream = cached?.stream
      ?? await window.nndd.invoke<StreamUrlResult>(
        window.nndd.channels.VIDEO_GET_STREAM_URL, videoId, w, isAudioOnly, defaultQualityId
      );

    if (stream.error) {
      throw new Error(stream.error);
    }

    consecutiveSkipRef.current = 0;
    pendingSeekRef.current = resumeSec && resumeSec > 0 ? resumeSec : 0;
    if (stream.niconico) {
      setNiconicoMode(true);
      setSrc('');
      setIsHls(false);
    } else {
      setNiconicoMode(false);
      setSrc(stream.contentUrl ?? '');
      setIsHls(stream.isHls ?? false);
    }

    // コメントが届き次第セット（動画再生開始後に非同期でポップイン）
    commentsPromise.then(cs => setComments(cs.map(ensureCommandResolved)));
  };

  const handleQualityChange = async (qualityId: string): Promise<void> => {
    const currentSec = videoElementRef.current?.currentTime ?? 0;
    pendingSeekRef.current = currentSec;
    setSelectedQualityId(qualityId);
    const vid = watchRef.current?.videoId ?? playInfoRef.current?.videoId;
    const w = watchRef.current;
    if (!vid || !w) return;
    const stream = await window.nndd.invoke<StreamUrlResult>(
      window.nndd.channels.VIDEO_GET_STREAM_URL, vid, w, audioOnlyRef.current, qualityId
    );
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
    resumeFinishedRef.current = false;
    pendingSeekRef.current = 0;
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
    folderPlaylist?: string[],
    resumeSec?: number
  ): Promise<void> => {
    setIsLocal(true);
    setWatch(null);
    setPastComments([]);
    setShowPastComments(false);
    setLocalCommentXmlPath(files?.commentXml);
    setLocalIchibaHtmlPath(files?.ichibaHtml);
    setNicowariFiles(files?.nicowari ?? []);
    currentLocalPathRef.current = localPath;
    // ライブラリからソート済みリストが渡された場合はそれを優先、なければファイルシステムから取得
    if (folderPlaylist && folderPlaylist.length > 0) {
      updateFolderVideos(folderPlaylist);
    } else {
      const dir = localPath.replace(/[/\\][^/\\]+$/, '');
      window.nndd.invoke<string[]>(window.nndd.channels.LIBRARY_FOLDER_VIDEOS, dir)
        .then((vids) => { updateFolderVideos(vids); })
        .catch(() => { updateFolderVideos([]); });
    }
    consecutiveSkipRef.current = 0;
    pendingSeekRef.current = resumeSec && resumeSec > 0 ? resumeSec : 0;
    // 動画はループバック HTTP 経由で配信する (custom protocol はシークで壊れる)。
    // ポートとトークンは main プロセスにしかないため IPC で URL を組み立てる。
    const mediaUrl = await window.nndd
      .invoke<string>(window.nndd.channels.VIDEO_BUILD_LOCAL_URL, localPath)
      .catch(() => buildLocalUrl(localPath));
    setSrc(mediaUrl);
    setIsHls(false);
    resumeFinishedRef.current = false;
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
      const cs = await readLocalComments(files);
      if (cs) setComments(cs);
    };

    const loadThumbInfo = async (): Promise<void> => {
      if (!files?.thumbInfoXml) return;
      const w = await window.nndd.invoke<WatchPageInfo | null>(
        window.nndd.channels.THUMB_INFO_XML_READ,
        files.thumbInfoXml
      );
      if (!w) return;
      setWatch(w);
      if (playInfoRef.current && w.thumbnail?.remoteUrl) {
        playInfoRef.current.discordThumbnailUrl = w.thumbnail.remoteUrl;
      }
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

  useWatchHistory({ currentVideoId, watch, video, playInfoRef });
  useDiscordPresence({ video, src, playInfoRef });
  useJumpCommand({ video, comments, isLocalRef, autoNextFolderRef });
  const endNicowari = useNicowari({
    video,
    comments,
    nicowariFiles,
    setActiveNicowari,
    pausedByNicowariRef,
    videoElementRef
  });

  usePlaybackTicker({
    videoElementRef,
    audioOnlyRef,
    isLocalRef,
    playInfoRef,
    resumeFinishedRef,
    preloadRef,
    defaultQualityRef,
    getNextVideoId
  });
  const openCommentWindow = useCommentWindow({
    comments,
    localCommentXmlPath,
    localIchibaHtmlPath,
    playInfoRef,
    videoElementRef,
    setPastComments,
    setShowPastComments,
    loading,
    src,
    audioOnly,
    commentListDisplay,
    commentWindowAutoOpen,
    isWebPlayer
  });

  const { isFullscreen, showControls, toggleFullscreen, handleVideoTap } =
    useFullscreenControls({ containerRef, video });

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
            pendingSeekRef={pendingSeekRef}
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
          isLocal={isLocal}
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
      <div
        ref={containerRef}
        className={[
          'flex-1 flex flex-col min-h-0 relative group',
          isFullscreen && !showControls ? 'cursor-none' : ''
        ].join(' ')}
      >
        {niconicoMode ? (
          <div ref={webviewWrapperRef} className="flex-1 min-h-0" />
        ) : (
          <>
            {/* ユーザーニコ割: 動画に重ねず上部に帯を確保し、その分動画エリアの高さを縮める */}
            {src && activeNicowari && (
              <NicowariBanner content={activeNicowari} video={video} onEnd={endNicowari} />
            )}
            <div
              className="flex-1 relative min-h-0"
              onDoubleClick={toggleFullscreen}
            >
              {src ? (
                <VideoPlayer
                  src={src}
                  isHls={isHls}
                  comments={renderedComments}
                  commentConfig={commentConfig}
                  ref={videoPlayerRef}
                  videoRefCallback={setVideoWithRef}
                  onPipChange={setDocPipActive}
                  pendingSeekRef={pendingSeekRef}
                  loading={loading && !src}
                  videoId={watch?.videoId ?? playInfoRef.current?.videoId}
                  className="w-full h-full"
                  onVideoError={(code) => { handleVideoError(code).catch(console.error); }}
                  audioOnly={audioOnly}
                  onEnded={() => { consecutiveSkipRef.current = 0; advanceToNextVideo(); }}
                  onVideoClick={isMobileTouch ? handleVideoTap : undefined}
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
                showControls || (!isFullscreen && controlsAlwaysVisible && !isMobileTouch)
                  ? 'opacity-100 pointer-events-auto'
                  : 'opacity-0 pointer-events-none'
              ].join(' ')}
            >
              {((commentListDisplay === 'window' && !isWebPlayer) || (isLocal && folderVideos.length > 1)) && (
                <div className="flex items-center justify-end gap-2 px-2 py-0.5 bg-black/80" style={{ zoom: controlZoom }}>
                  {isLocal && folderVideos.length > 1 && (
                    <label className="flex items-center gap-1 text-xs text-nndd-subtext cursor-pointer select-none hover:text-nndd-text">
                      <input
                        type="checkbox"
                        checked={autoNextFolder}
                        onChange={(e) => onAutoNextFolderChange(e.target.checked)}
                        className="cursor-pointer"
                      />
                      フォルダ連続再生
                    </label>
                  )}
                  {commentListDisplay === 'window' && !isWebPlayer && (
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
                isLocal={isLocal}
                docPipActive={docPipActive}
                onToggleDocPip={() => { videoPlayerRef.current?.togglePip().catch(console.error); }}
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
      {/* フルスクリーン時は display:none で隠すだけにし、VideoInfoView を
          unmount しない (過去コメント取得結果などの内部 state を保持するため) */}
      <div className={isFullscreen ? 'hidden' : 'contents'}>
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
            showCommentTab={commentListDisplay === 'tab' || isWebPlayer}
            onCommentsUpdated={(cs) => setComments(cs.map(ensureCommandResolved))}
            onPastCommentsLoaded={(cs) => setPastComments(cs)}
            onPastCommentTabActive={(active) => setShowPastComments(active)}
            autoNextSeries={autoNextSeries}
            onAutoNextChange={onAutoNextSeriesChange}
            onSeriesPageLoaded={onSeriesPageLoaded}
            autoNextRelated={autoNextRelated}
            onAutoNextRelatedChange={onAutoNextRelatedChange}
            onRelatedLoaded={onRelatedLoaded}
            onTabsOverflow={handleTabsOverflow}
          />
        </aside>
      </div>
      {showHistoryBlockedDialog && (
        <HistoryBlockedDialog onChoice={(allow, remember) => { handleHistoryBlockedChoice(allow, remember).catch(console.error); }} />
      )}
    </div>
  );
}
