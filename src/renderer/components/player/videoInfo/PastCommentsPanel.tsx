import type { NNDDREComment, NgListItem } from '@shared/types';
import { CommentList } from '../CommentList';

interface Props {
  pastDateFrom: string;
  onPastDateFromChange: (v: string) => void;
  pastTimeFrom: string;
  onPastTimeFromChange: (v: string) => void;
  pastDate: string;
  onPastDateChange: (v: string) => void;
  pastTime: string;
  onPastTimeChange: (v: string) => void;
  onResetDate: () => void;
  /** ローカルコメントXMLパス (あればローカルフィルタ、無ければニコニコから取得) */
  localCommentXmlPath?: string;
  videoId?: string;
  pastLoading: boolean;
  pastFetchMaxCount: number;
  onPastFetchMaxCountChange: (v: number) => void;
  onFilterFromLocal: () => void;
  onFetchFromNico: () => void;
  pastError: string | null;
  pastProgressMsg: string | null;
  pastComments: NNDDREComment[];
  ngList: NgListItem[];
  onSeek: (timeSec: number) => void;
  currentTimeMs: number;
  onAddNg: (item: NgListItem) => Promise<void>;
  onRemoveNg: (item: NgListItem) => Promise<void>;
}

/**
 * 過去コメントタブの表示部分 (日時選択・取得ボタン・一覧)。
 * 状態と取得処理は親 (VideoInfoView) が持つ。タブを切り替えても取得結果を保持するため。
 */
export function PastCommentsPanel({
  pastDateFrom,
  onPastDateFromChange,
  pastTimeFrom,
  onPastTimeFromChange,
  pastDate,
  onPastDateChange,
  pastTime,
  onPastTimeChange,
  onResetDate,
  localCommentXmlPath,
  videoId,
  pastLoading,
  pastFetchMaxCount,
  onPastFetchMaxCountChange,
  onFilterFromLocal,
  onFetchFromNico,
  pastError,
  pastProgressMsg,
  pastComments,
  ngList,
  onSeek,
  currentTimeMs,
  onAddNg,
  onRemoveNg
}: Props): JSX.Element {
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 日時選択 + ボタン */}
      <div className="shrink-0 p-2 border-b border-nndd-border bg-nndd-panel">
        <div className="flex items-center gap-1 flex-wrap mb-1">
          <span className="text-xs text-nndd-subtext w-6">From</span>
          <input
            type="date"
            value={pastDateFrom}
            onChange={(e) => onPastDateFromChange(e.target.value)}
            className="text-xs bg-nndd-bg border border-nndd-border rounded px-1 py-0.5 text-nndd-text"
          />
          <input
            type="time"
            value={pastTimeFrom}
            onChange={(e) => onPastTimeFromChange(e.target.value)}
            className="text-xs bg-nndd-bg border border-nndd-border rounded px-1 py-0.5 text-nndd-text"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap mb-1">
          <span className="text-xs text-nndd-subtext w-6">To</span>
          <input
            type="date"
            value={pastDate}
            onChange={(e) => onPastDateChange(e.target.value)}
            className="text-xs bg-nndd-bg border border-nndd-border rounded px-1 py-0.5 text-nndd-text"
          />
          <input
            type="time"
            value={pastTime}
            onChange={(e) => onPastTimeChange(e.target.value)}
            className="text-xs bg-nndd-bg border border-nndd-border rounded px-1 py-0.5 text-nndd-text"
          />
          <button
            onClick={onResetDate}
            title="現在時刻にリセット"
            className="text-xs px-2 py-0.5 bg-nndd-border rounded hover:bg-nndd-accent/50 text-nndd-text"
          >
            リセット
          </button>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {localCommentXmlPath ? (
            <button
              onClick={onFilterFromLocal}
              disabled={pastLoading}
              title="ローカルXMLから指定日時以前のコメントを読み込みます"
              className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
            >
              {pastLoading ? '読込中…' : 'フィルタ'}
            </button>
          ) : videoId ? (
            <>
              <select
                value={pastFetchMaxCount}
                onChange={(e) => onPastFetchMaxCountChange(Number(e.target.value))}
                disabled={pastLoading}
                title="取得する過去コメントの最大件数"
                className="text-xs bg-nndd-bg border border-nndd-border rounded px-1 py-0.5 text-nndd-text disabled:opacity-50"
              >
                {[1000, 5000, 10000, 30000, 50000].map((n) => (
                  <option key={n} value={n}>{n.toLocaleString()}件まで</option>
                ))}
              </select>
              <button
                onClick={onFetchFromNico}
                disabled={pastLoading}
                title="ニコニコから直接、指定日時以前の過去コメントを取得します(時間がかかる場合があります)"
                className="text-xs px-2 py-0.5 bg-nndd-accent text-white rounded hover:opacity-80 disabled:opacity-50"
              >
                {pastLoading ? '取得中…' : '取得'}
              </button>
            </>
          ) : (
            <span className="text-xs text-nndd-subtext">
              過去コメントを取得できません
            </span>
          )}
          {pastError && (
            <span className="text-xs text-red-500 dark:text-red-400 truncate flex-1" title={pastError}>
              ⚠ {pastError}
            </span>
          )}
        </div>
        {pastLoading && pastProgressMsg && (
          <div className="text-xs text-nndd-subtext mt-0.5 truncate">{pastProgressMsg}</div>
        )}
      </div>

      {/* 過去コメント一覧 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {pastComments.length > 0 ? (
          <CommentList
            comments={pastComments}
            ngList={ngList}
            onSeek={onSeek}
            currentTimeMs={currentTimeMs}
            onAddNg={onAddNg}
            onRemoveNg={onRemoveNg}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-nndd-subtext text-sm">
            {pastLoading ? '読込中…' : '過去コメントなし'}
          </div>
        )}
      </div>
    </div>
  );
}
