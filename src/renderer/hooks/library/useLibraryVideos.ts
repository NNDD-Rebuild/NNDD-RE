import { useEffect, useRef, useState } from 'react';
import type { NNDDREVideo } from '@shared/types';
import { useAppStore } from '@renderer/store/useAppStore';

/**
 * ライブラリタブの動画一覧 + フォルダ一覧の読み込み。
 * 初回マウント時・ライブラリタブに戻ったとき・DL 完了時に reload する。
 * effect はこの順で宣言する (元の LibraryView 内と同じ順序): 初回ロード → タブ復帰 → DL 完了の購読。
 */
export function useLibraryVideos() {
  const [videos, setVideos] = useState<NNDDREVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [fsFolders, setFsFolders] = useState<string[]>([]);

  // 再読み込みは表示中の一覧を残したまま裏で差し替える (「読み込み中…」表示にすると
  // 一覧がアンマウントされスクロール位置が失われるため、それは初回ロード時だけ)。
  // 連続で呼ばれた場合は最後に投げた要求の結果だけを反映する。
  const reloadSeqRef = useRef(0);
  const reload = (): void => {
    const seq = ++reloadSeqRef.current;
    Promise.all([
      window.nndd.invoke<NNDDREVideo[]>(window.nndd.channels.LIBRARY_LIST),
      window.nndd.invoke<string[]>(window.nndd.channels.LIBRARY_FOLDER_LIST)
    ])
      .then(([rows, dirs]) => {
        if (seq !== reloadSeqRef.current) return;
        const fixed = rows.map((v) => ({
          ...v,
          modificationDate: new Date(v.modificationDate),
          creationDate: new Date(v.creationDate),
          lastPlayDate: v.lastPlayDate ? new Date(v.lastPlayDate) : null,
          pubDate: v.pubDate ? new Date(v.pubDate) : null
        }));
        setVideos(fixed);
        setFsFolders(dirs);
        setLoading(false);
      })
      .catch(() => {
        if (seq === reloadSeqRef.current) setLoading(false);
      });
  };

  useEffect(reload, []);

  // タブ切替ではアンマウントせず状態 (選択フォルダ・検索語・スクロール位置等) を保持する。
  // 非表示中にプレイヤー側で再生回数・お気に入り等が変わっている可能性があるため、
  // ライブラリタブに戻ったときは裏で最新の一覧を取り直す。
  const activeTab = useAppStore((s) => s.activeTab);
  const wasActiveRef = useRef(activeTab === 'library');
  useEffect(() => {
    const isActive = activeTab === 'library';
    if (isActive && !wasActiveRef.current) reload();
    wasActiveRef.current = isActive;
  }, [activeTab]);

  useEffect(() => {
    const off = window.nndd.on(
      window.nndd.channels.DOWNLOAD_PROGRESS_EVENT,
      (...args: unknown[]) => {
        const item = args[0] as { status?: string } | null;
        if (item?.status === 'success') reload();
      }
    );
    return off;
  }, []);

  return { videos, setVideos, loading, fsFolders, reload };
}
