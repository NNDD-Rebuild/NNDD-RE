import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { LiveListItem, NgListItem, NNDDREComment } from '@shared/types';
import { CommentList } from '../player/CommentList';
import { formatElapsed } from './liveFormat';

/**
 * 生放送プレイヤーのサイドパネル (境界のリサイズつまみ + 番組情報 / コメントリスト / お知らせ のタブ)。
 * 全画面中は隠すだけで unmount しない。
 */
export function LiveSidePanel({
  isFullscreen,
  width,
  onDividerMouseDown,
  showSideComments,
  listItems,
  ngList,
  onSeek,
  positionMs,
  onAddNg,
  onRemoveNg,
  programInfo,
  ncvLinked
}: {
  isFullscreen: boolean;
  width: number;
  onDividerMouseDown: (e: React.MouseEvent) => void;
  /** コメントリスト・お知らせのタブを出すか (浮動ウィンドウ表示中は出さない) */
  showSideComments: boolean;
  /** コメントリストの全行 (コメント + お知らせ) */
  listItems: LiveListItem[];
  ngList: NgListItem[];
  /** コメントリストからのシーク (タイムシフト・追っかけ再生のみ。それ以外は undefined) */
  onSeek: ((sec: number) => void) | undefined;
  positionMs: number;
  onAddNg: (item: NgListItem) => Promise<void>;
  onRemoveNg: (item: NgListItem) => Promise<void>;
  /** 「番組情報」タブの中身 */
  programInfo: ReactNode;
  /** NCV にコメント表示を任せているか (true になった時点で「番組情報」タブを開く) */
  ncvLinked: boolean;
}): JSX.Element {
  const [sideTab, setSideTab] = useState<'info' | 'comments' | 'notices'>(ncvLinked ? 'info' : 'comments');
  useEffect(() => {
    if (ncvLinked) setSideTab('info');
  }, [ncvLinked]);
  const listComments = useMemo<NNDDREComment[]>(
    () => listItems.flatMap((i) => (i.comment ? [i.comment] : [])),
    [listItems]
  );
  const listNotices = useMemo(() => listItems.filter((i) => i.notice), [listItems]);

  return (
    <div className={isFullscreen ? 'hidden' : 'contents'}>
      <div
        className="w-1 shrink-0 bg-nndd-border hover:bg-nndd-accent/70 active:bg-nndd-accent cursor-col-resize transition-colors"
        onMouseDown={onDividerMouseDown}
        style={{ userSelect: 'none' }}
        title="ドラッグでサイズ変更"
      />
      <aside className="shrink-0 bg-nndd-bg overflow-hidden flex flex-col" style={{ width }}>
        <div className="flex shrink-0 border-b border-nndd-border overflow-x-auto">
          <TabButton label="番組情報" active={sideTab === 'info'} onClick={() => setSideTab('info')} />
          {showSideComments && (
            <TabButton
              label={`コメントリスト${listComments.length > 0 ? ` (${listComments.length.toLocaleString()})` : ''}`}
              active={sideTab === 'comments'}
              onClick={() => setSideTab('comments')}
            />
          )}
          {showSideComments && (
            <TabButton
              label={`お知らせ${listNotices.length > 0 ? ` (${listNotices.length.toLocaleString()})` : ''}`}
              active={sideTab === 'notices'}
              onClick={() => setSideTab('notices')}
            />
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {sideTab === 'comments' && showSideComments ? (
            <CommentList
              comments={listComments}
              ngList={ngList}
              onSeek={onSeek}
              currentTimeMs={positionMs}
              onAddNg={onAddNg}
              onRemoveNg={onRemoveNg}
            />
          ) : sideTab === 'notices' && showSideComments ? (
            <div className="h-full overflow-auto text-xs">
              {listNotices.length === 0 ? (
                <div className="flex items-center justify-center h-full text-nndd-subtext text-sm">お知らせなし</div>
              ) : (
                listNotices.map((n) => (
                  <div key={n.key} className="flex gap-2 px-2 py-1 border-b border-nndd-border/30">
                    <span className="shrink-0 font-mono text-nndd-subtext">{formatElapsed(n.vposMs)}</span>
                    <span className="break-all">{n.notice!.text}</span>
                  </div>
                ))
              )}
            </div>
          ) : (
            programInfo
          )}
        </div>
      </aside>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={[
        'shrink-0 text-xs py-1.5 px-3 border-b-2 transition-colors whitespace-nowrap',
        active
          ? 'border-nndd-accent text-nndd-text font-bold'
          : 'border-transparent text-nndd-subtext hover:text-nndd-text'
      ].join(' ')}
    >
      {label}
    </button>
  );
}
