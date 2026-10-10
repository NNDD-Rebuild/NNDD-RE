import { useState, useEffect } from 'react';
import { useConfig } from '@renderer/hooks/useConfig';
import { useAppStore } from '@renderer/store/useAppStore';
import { IpcChannel } from '@shared/types';
import type { BinaryStatuses } from './ExternalToolsSettings';
import {
  Btn,
  CheckRow,
  Hint,
  NumberCommitInput,
  PageTitle,
  RadioGroup,
  Row,
  Section,
  Select,
  SettingsPage
} from './common';

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
  const [rateLimitMbps, setRateLimitMbps] = useConfig<number>(
    'downloadRateLimitMbps',
    0
  );
  const [downloadLiveToSubfolder, setDownloadLiveToSubfolder] = useConfig<boolean>(
    'downloadLiveToSubfolder',
    false
  );
  const [downloadEasyComments, setDownloadEasyComments] = useConfig<boolean>(
    'downloadEasyComments',
    false
  );
  const [downloadAllComments, setDownloadAllComments] = useConfig<boolean>(
    'downloadAllComments',
    false
  );
  const [comment429RetryWaitSec, setComment429RetryWaitSec] = useConfig<number>(
    'comment429RetryWaitSec',
    185
  );
  const [skipCommentsOnAudioOnly, setSkipCommentsOnAudioOnly] = useConfig<boolean>(
    'skipCommentsOnAudioOnly',
    true
  );
  const [useNativeVideoDownloader, setUseNativeVideoDownloader] = useConfig<boolean>(
    'useNativeVideoDownloader',
    true
  );
  const [muxImplementation, setMuxImplementation] = useConfig<'ffmpeg' | 'mediabunny'>(
    'downloadMuxImplementation',
    'mediabunny'
  );
  const [librarySortCol, setLibrarySortCol] = useConfig<SortCol>('ui.librarySortCol', 'pubDate');
  const [librarySortDir, setLibrarySortDir] = useConfig<SortDir>('ui.librarySortDir', 'asc');
  const [libraryDisplayMode, setLibraryDisplayModeConfig] = useConfig<LibraryDisplayMode>('ui.libraryViewMode', 'table');
  const [binaryStatus, setBinaryStatus] = useState<BinaryStatuses | null>(null);
  const setLibraryViewModeStore = useAppStore((s) => s.setLibraryViewMode);
  const setPendingSettingsTab = useAppStore((s) => s.setPendingSettingsTab);
  const ytDlpMissing = binaryStatus !== null && !binaryStatus.ytDlp.found;
  const ffmpegMissing = binaryStatus !== null && !binaryStatus.ffmpeg.found;
  const setLibraryDisplayMode = (mode: LibraryDisplayMode): void => {
    setLibraryDisplayModeConfig(mode);
    setLibraryViewModeStore(mode);
  };

  useEffect(() => {
    window.nndd.invoke<BinaryStatuses>(IpcChannel.BINARY_STATUS).then(setBinaryStatus).catch(() => {});
  }, []);

  return (
    <SettingsPage>
      <PageTitle title="DLリスト・ライブラリ" />

      <Section title="ダウンロード">
        <Row label="同時ダウンロード数" hint="1-10、デフォルト 2">
          <NumberCommitInput min={1} max={10} className="w-20" value={maxConcurrent} onCommit={setMaxConcurrent} />
        </Row>
        <Row label="リトライ回数" hint="失敗時の自動リトライ">
          <NumberCommitInput min={0} max={10} className="w-20" value={retryCount} onCommit={setRetryCount} />
        </Row>
        <Row label="DL間クールダウン" hint="秒 (0=無効。コメント取得・動画DL完了後、次の動画開始まで待機)">
          <NumberCommitInput
            min={0}
            max={60}
            step={0.5}
            value={cooldownMs / 1000}
            onCommit={(v) => setCooldownMs(Math.round(v * 1000))}
          />
        </Row>
        <Row label="DL帯域制限" hint="Mbps (0=無制限。yt-dlp / ネイティブHLS どちらのDL方式にも適用)">
          <NumberCommitInput min={0} step={1} value={rateLimitMbps} onCommit={setRateLimitMbps} />
        </Row>
        <CheckRow
          checked={downloadAllComments}
          onChange={setDownloadAllComments}
          label="新規DL時に過去コメントを全件取得する"
          hint="オフにすると今コメのみ取得"
        />
        <CheckRow
          checked={downloadLiveToSubfolder}
          onChange={setDownloadLiveToSubfolder}
          label="生放送のタイムシフトを live フォルダにダウンロードする"
          hint="オフだと通常の動画と同じフォルダ。オンだと保存先の下に live フォルダを作って保存"
        />
        <CheckRow
          checked={downloadEasyComments}
          onChange={setDownloadEasyComments}
          label="全コメDL時に easy スレッド (増量コメント) を含める"
          hint="DL時間が大幅増加する場合あり"
        />
        <CheckRow
          checked={skipCommentsOnAudioOnly}
          onChange={setSkipCommentsOnAudioOnly}
          label="音声のみダウンロード時はコメントを取得しない"
        />
        <CheckRow
          checked={useNativeVideoDownloader}
          disabled={ytDlpMissing && useNativeVideoDownloader}
          onChange={setUseNativeVideoDownloader}
          label="ネイティブHLSダウンロードを優先する"
          hint="オフにすると常にyt-dlpを使用。失敗時は自動的にyt-dlpへフォールバック"
        />
        {ytDlpMissing && (
          <WarningBanner
            variant={useNativeVideoDownloader ? 'warning' : 'error'}
            message={
              useNativeVideoDownloader
                ? 'yt-dlpが見つかりません。通常はネイティブ実装で動作するためインストール必須ではありませんが、失敗時のフォールバックとして入れておくと安心です。'
                : 'yt-dlpが見つかりません。このままではダウンロードができません。'
            }
            onOpenTools={() => setPendingSettingsTab('tools')}
          />
        )}
        <Row
          label="mux実装"
          hint="ネイティブHLS DL時の映像/音声結合方式。mediabunny選択時は失敗してもyt-dlpへフォールバックしません"
        >
          <Select
            value={muxImplementation}
            onChange={(e) => setMuxImplementation(e.target.value as 'ffmpeg' | 'mediabunny')}
          >
            <option value="mediabunny">mediabunny (JS実装、ffmpeg不要・デフォルト)</option>
            <option value="ffmpeg" disabled={ffmpegMissing}>ffmpeg</option>
          </Select>
        </Row>
        {ffmpegMissing && muxImplementation === 'ffmpeg' && (
          <WarningBanner
            message="ffmpegが見つかりません。mediabunnyに切り替えるか、外部ツールからインストールしてください。"
            onOpenTools={() => setPendingSettingsTab('tools')}
          />
        )}
        <Row
          label="too many request待機時間"
          hint="秒 (0=リトライなし。コメント取得でtoo many request (429) 時の待機時間、最大5回リトライ)"
        >
          <NumberCommitInput min={0} max={300} step={10} value={comment429RetryWaitSec} onCommit={setComment429RetryWaitSec} />
        </Row>
      </Section>

      <Section title="ライブラリ表示形式">
        <RadioGroup
          name="libraryDisplayMode"
          value={libraryDisplayMode}
          onChange={setLibraryDisplayMode}
          options={[
            { value: 'table', label: '☰ リスト表示', hint: 'タイトル・時間・再生数を一覧表示' },
            { value: 'grid', label: '⊞ グリッド表示', hint: 'サムネイル大きく表示 (YouTube風)' }
          ]}
        />
        <Hint className="mt-2">
          ライブラリタブを再度開くと反映されます。ヘッダーバーの切り替えボタンから即時変更も可能です。
        </Hint>
      </Section>

      <Section title="ライブラリデフォルトソート">
        <Row label="ソートカラム">
          <Select value={librarySortCol} onChange={(e) => setLibrarySortCol(e.target.value as SortCol)}>
            <option value="pubDate">投稿日</option>
            <option value="creationDate">DL日</option>
            <option value="videoName">タイトル</option>
            <option value="time">時間</option>
            <option value="playCount">再生数</option>
          </Select>
        </Row>
        <Row label="並び順">
          <Select value={librarySortDir} onChange={(e) => setLibrarySortDir(e.target.value as SortDir)}>
            <option value="asc">昇順 ▲</option>
            <option value="desc">降順 ▼</option>
          </Select>
        </Row>
        <Hint className="mt-2">
          ライブラリを開いたときの初期ソート。リスト・グリッド両方に適用されます。
        </Hint>
      </Section>
    </SettingsPage>
  );
}

function WarningBanner({
  message,
  onOpenTools,
  variant = 'error'
}: {
  message: string;
  onOpenTools: () => void;
  variant?: 'error' | 'warning';
}): JSX.Element {
  const colorClass =
    variant === 'warning'
      ? 'bg-yellow-500/10 border-yellow-500/40 text-yellow-600 dark:text-yellow-400'
      : 'bg-red-500/10 border-red-500/40 text-red-500 dark:text-red-400';
  return (
    <div className={`flex items-center justify-between gap-3 mb-2 px-3 py-2 border rounded text-xs ${colorClass}`}>
      <span>{message}</span>
      <Btn onClick={onOpenTools} className="shrink-0">
        外部ツールタブを開く
      </Btn>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
