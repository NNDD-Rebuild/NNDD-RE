import { useEffect, useMemo, useRef, useState } from 'react';
import type { NNDDREVideo } from '@shared/types';
import { buildFolderTree } from '@renderer/components/library/folderTree';

/**
 * ライブラリ左ペインのフォルダツリー。
 * 動画のあるフォルダ + 実在するフォルダ (fsFolders) からツリーを組み、展開状態と動画数を管理する。
 */
export function useLibraryFolderTree(videos: NNDDREVideo[], fsFolders: string[]) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const v of videos) {
      const d = v.uri.replace(/[/\\][^/\\]+$/, '');
      set.add(d);
    }
    for (const d of fsFolders) {
      set.add(d);
    }
    return [...set].sort();
  }, [videos, fsFolders]);

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  // 初回ロード時のみ第一階層 (ツリーのルート) を展開状態にする
  const initialExpandDoneRef = useRef(false);
  useEffect(() => {
    if (initialExpandDoneRef.current || folderTree.length === 0) return;
    initialExpandDoneRef.current = true;
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      for (const n of folderTree) next.add(n.path);
      return next;
    });
  }, [folderTree]);

  const folderVideoCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of videos) {
      const d = v.uri.replace(/[/\\][^/\\]+$/, '');
      map.set(d, (map.get(d) ?? 0) + 1);
    }
    return map;
  }, [videos]);

  const toggleFolderExpand = (path: string): void => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  return { folderTree, folderVideoCounts, expandedFolders, toggleFolderExpand };
}
