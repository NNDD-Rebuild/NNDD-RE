import { useState, useEffect } from 'react';
import { useConfig } from '@renderer/hooks/useConfig';
import { useAppStore } from '@renderer/store/useAppStore';

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
  const [librarySortCol, setLibrarySortCol] = useConfig<SortCol>('ui.librarySortCol', 'pubDate');
  const [librarySortDir, setLibrarySortDir] = useConfig<SortDir>('ui.librarySortDir', 'asc');
  const [libraryDisplayMode, setLibraryDisplayModeLocal] = useState<LibraryDisplayMode>('table');
  const setLibraryViewModeStore = useAppStore((s) => s.setLibraryViewMode);
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
