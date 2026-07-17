import { useState, useEffect } from 'react';
import { useConfig } from '@renderer/hooks/useConfig';
import { useAppStore } from '@renderer/store/useAppStore';
import { IpcChannel } from '@shared/types';
import type { BinaryStatuses } from './ExternalToolsSettings';

type LibraryDisplayMode = 'table' | 'grid';
type SortCol = 'videoName' | 'time' | 'playCount' | 'pubDate' | 'creationDate';
type SortDir = 'asc' | 'desc';

/**
 * 設定 > DLリスト・ライブラリ。
 * 元: NNDD.mxml の Canvas label="DLリスト・ライブラリ"
 */

export function LibrarySettings(): JSX.Element {
  const [maxConcurrent, setMaxConcurrent] = useConfig<number>(
    'maxConcurrentDownloads',
    2
  );
  const [retryCount, setRetryCount] = useConfig<number>(
    'downloadRetryCount',
    3
  );
  const [cooldownMs, setCooldownMs] = useConfig<number>(
    'downloadCooldownMs',
    0
  );
  const [downloadEasyComments, setDownloadEasyComments] = useConfig<boolean>(
    'downloadEasyComments',
    false
  );
  const [downloadAllComments, setDownloadAllComments] = useConfig<boolean>(
    'downloadAllComments',
    true
  );
  const [comment429RetryWaitSec, setComment429RetryWaitSec] = useConfig<number>(
    'comment429RetryWaitSec',
    60
  );
  const [skipCommentsOnAudioOnly, setSkipCommentsOnAudioOnly] = useConfig<boolean>(
    'skipCommentsOnAudioOnly',
    false
  );
  const [useNativeVideoDownloader, setUseNativeVideoDownloader] = useConfig<boolean>(
    'useNativeVideoDownloader',
    true
  );
  const [muxImplementation, setMuxImplementation] = useConfig<'ffmpeg' | 'mediabunny'>(
    'downloadMuxImplementation',
    'ffmpeg'
  );
  const [librarySortCol, setLibrarySortCol] = useConfig<SortCol>('ui.librarySortCol', 'pubDate');
  const [librarySortDir, setLibrarySortDir] = useConfig<SortDir>('ui.librarySortDir', 'asc');
  const [libraryDisplayMode, setLibraryDisplayModeLocal] = useState<LibraryDisplayMode>('table');
  const [binaryStatus, setBinaryStatus] = useState<BinaryStatuses | null>(null);
  const setLibraryViewModeStore = useAppStore((s) => s.setLibraryViewMode);
  const setPendingSettingsTab = useAppStore((s) => s.setPendingSettingsTab);
  const ytDlpMissing = binaryStatus !== null && !binaryStatus.ytDlp.found;
  const ffmpegMissing = binaryStatus !== null && !binaryStatus.ffmpeg.found;
  const setLibraryDisplayMode = (mode: LibraryDisplayMode): void => {
    setLibraryDisplayModeLocal(mode);
    setLibraryViewModeStore(mode);
    window.nndd.invoke(window.nndd.channels.CONFIG_SET, 'ui.libraryViewMode', mode).catch(() => {});
  };

  useEffect(() => {
    window.nndd
      .invoke<LibraryDisplayMode>(window.nndd.channels.CONFIG_GET, 'ui.libraryViewMode')
      .then((v) => { if (v === 'table' || v === 'grid') setLibraryDisplayModeLocal(v); })
      .catch(() => {/* ignore */});
  }, []);

  useEffect(() => {
    window.nndd.invoke<BinaryStatuses>(IpcChannel.BINARY_STATUS).then(setBinaryStatus).catch(() => {});
  }, []);

  return (
    <div className="p-4 max-w-3xl">
      <h2 className="text-base font-bold mb-3">DLリスト・ライブラリ</h2>

      <Section title="ダウンロード">
        <Row label="同時ダウンロード数">
          <input
            type="number"
            min={1}
            max={10}
            value={maxConcurrent}
            onChange={(e) =>
              setMaxConcurrent(Math.max(1, Math.min(10, Number(e.target.value))))
            }
            className="w-20 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          />
          <span className="text-xs text-nndd-subtext ml-2">
            (1-10、デフォルト 2)
          </span>
        </Row>
        <Row label="リトライ回数">
          <input
            type="number"
            min={0}
            max={10}
            value={retryCount}
            onChange={(e) =>
              setRetryCount(Math.max(0, Math.min(10, Number(e.target.value))))
            }
            className="w-20 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          />
          <span className="text-xs text-nndd-subtext ml-2">
            (失敗時の自動リトライ)
          </span>
        </Row>
        <Row label="DL間クールダウン">
          <input
            type="number"
            min={0}
            max={60}
            step={0.5}
            value={cooldownMs / 1000}
            onChange={(e) => setCooldownMs(Math.max(0, Math.round(Number(e.target.value) * 1000)))}
            className="w-24 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          />
          <span className="text-xs text-nndd-subtext ml-2">
            秒 (0=無効。コメント取得・動画DL完了後、次の動画開始まで待機)
          </span>
        </Row>
        <Row label="全コメント取得">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={downloadAllComments}
              onChange={(e) => setDownloadAllComments(e.target.checked)}
            />
            <span className="text-sm">新規DL時に過去コメントを全件取得する</span>
          </label>
          <span className="text-xs text-nndd-subtext ml-2">
            (オフにすると今コメのみ取得)
          </span>
        </Row>
        <Row label="easyコメント取得">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={downloadEasyComments}
              onChange={(e) => setDownloadEasyComments(e.target.checked)}
            />
            <span className="text-sm">全コメDL時に easy スレッド (増量コメント) を含める</span>
          </label>
          <span className="text-xs text-nndd-subtext ml-2">
            (DL時間が大幅増加する場合あり)
          </span>
        </Row>
        <Row label="音声のみDL時のコメント">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={skipCommentsOnAudioOnly}
              onChange={(e) => setSkipCommentsOnAudioOnly(e.target.checked)}
            />
            <span className="text-sm">音声のみダウンロード時はコメントを取得しない</span>
          </label>
        </Row>
        <Row label="動画DL方式">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useNativeVideoDownloader}
              disabled={ytDlpMissing && useNativeVideoDownloader}
              onChange={(e) => setUseNativeVideoDownloader(e.target.checked)}
            />
            <span className="text-sm">ネイティブHLSダウンロードを優先する</span>
          </label>
          <span className="text-xs text-nndd-subtext ml-2">
            (オフにすると常にyt-dlpを使用。失敗時は自動的にyt-dlpへフォールバック)
          </span>
        </Row>
        {ytDlpMissing && (
          <WarningBanner
            message={
              useNativeVideoDownloader
                ? 'yt-dlpが見つかりません。フォールバックが使えないため、外部ツールからインストールしてください。'
                : 'yt-dlpが見つかりません。このままではダウンロードができません。'
            }
            onOpenTools={() => setPendingSettingsTab('tools')}
          />
        )}
        <Row label="mux実装">
          <select
            value={muxImplementation}
            onChange={(e) => setMuxImplementation(e.target.value as 'ffmpeg' | 'mediabunny')}
            className="bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          >
            <option value="ffmpeg" disabled={ffmpegMissing}>ffmpeg (デフォルト)</option>
            <option value="mediabunny">mediabunny (JS実装、ffmpeg不要・実験的機能)</option>
          </select>
          <span className="text-xs text-nndd-subtext ml-2">
            (ネイティブHLS DL時の映像/音声結合方式。mediabunny選択時は失敗してもyt-dlpへフォールバックしません)
          </span>
        </Row>
        {ffmpegMissing && muxImplementation === 'ffmpeg' && (
          <WarningBanner
            message="ffmpegが見つかりません。mediabunnyに切り替えるか、外部ツールからインストールしてください。"
            onOpenTools={() => setPendingSettingsTab('tools')}
          />
        )}
        <Row label="429待機時間">
          <input
            type="number"
            min={0}
            max={300}
            step={10}
            value={comment429RetryWaitSec}
            onChange={(e) => setComment429RetryWaitSec(Math.max(0, Math.min(300, Number(e.target.value))))}
            className="w-24 bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          />
          <span className="text-xs text-nndd-subtext ml-2">
            秒 (0=リトライなし。コメント取得429時の待機時間、最大5回リトライ)
          </span>
        </Row>
      </Section>

      <Section title="ライブラリ表示形式">
        <div className="flex gap-4 text-sm">
          {(
            [
              { value: 'table', label: '☰ リスト表示', desc: 'タイトル・時間・再生数を一覧表示' },
              { value: 'grid',  label: '⊞ グリッド表示', desc: 'サムネイル大きく表示 (YouTube風)' }
            ] as { value: LibraryDisplayMode; label: string; desc: string }[]
          ).map(({ value, label, desc }) => (
            <label key={value} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="libraryDisplayMode"
                value={value}
                checked={libraryDisplayMode === value}
                onChange={() => setLibraryDisplayMode(value)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{label}</span>
                <br />
                <span className="text-xs text-nndd-subtext">{desc}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-nndd-subtext mt-2">
          ライブラリタブを再度開くと反映されます。ヘッダーバーの切り替えボタンから即時変更も可能です。
        </p>
      </Section>

      <Section title="ライブラリデフォルトソート">
        <Row label="ソートカラム">
          <select
            value={librarySortCol}
            onChange={(e) => setLibrarySortCol(e.target.value as SortCol)}
            className="bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          >
            <option value="pubDate">投稿日</option>
            <option value="creationDate">DL日</option>
            <option value="videoName">タイトル</option>
            <option value="time">時間</option>
            <option value="playCount">再生数</option>
          </select>
        </Row>
        <Row label="並び順">
          <select
            value={librarySortDir}
            onChange={(e) => setLibrarySortDir(e.target.value as SortDir)}
            className="bg-nndd-bg border border-nndd-border px-2 py-1 text-sm"
          >
            <option value="asc">昇順 ▲</option>
            <option value="desc">降順 ▼</option>
          </select>
        </Row>
        <p className="text-xs text-nndd-subtext mt-2">
          ライブラリを開いたときの初期ソート。リスト・グリッド両方に適用されます。
        </p>
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

function WarningBanner({
  message,
  onOpenTools
}: {
  message: string;
  onOpenTools: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 mb-2 px-3 py-2 bg-red-500/10 border border-red-500/40 rounded text-xs text-red-500 dark:text-red-400">
      <span>{message}</span>
      <button
        onClick={onOpenTools}
        className="shrink-0 px-2 py-1 text-xs bg-nndd-border rounded hover:bg-nndd-accent hover:text-white"
      >
        外部ツールタブを開く
      </button>
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
    <div className="flex items-center mb-2">
      <div className="w-44 text-xs text-nndd-subtext shrink-0">{label}</div>
      <div className="flex-1 flex items-center">{children}</div>
    </div>
  );
}

function Btn(props: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      {...props}
      className={[
        'text-xs px-3 py-1 bg-nndd-border hover:bg-nndd-accent rounded disabled:opacity-50',
        props.className ?? ''
      ].join(' ')}
    />
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
