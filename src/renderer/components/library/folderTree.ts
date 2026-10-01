export interface FolderNode {
  path: string;
  name: string;
  children: FolderNode[];
}

/**
 * フルパスのフラットな一覧をprefix関係から親子ツリーに組み立てる。
 * DB/ファイル一覧はフラットなまま(パス文字列)保持し、表示時にのみツリー化する。
 */
export function buildFolderTree(paths: string[]): FolderNode[] {
  const sorted = [...paths].sort((a, b) => a.length - b.length);
  const nodeByPath = new Map<string, FolderNode>();
  const roots: FolderNode[] = [];
  for (const p of sorted) {
    const node: FolderNode = { path: p, name: p.split(/[/\\]/).pop() || p, children: [] };
    nodeByPath.set(p, node);
    let parent: FolderNode | undefined;
    let bestLen = -1;
    for (const [candPath, candNode] of nodeByPath) {
      if (candPath === p) continue;
      if ((p.startsWith(candPath + '/') || p.startsWith(candPath + '\\')) && candPath.length > bestLen) {
        parent = candNode;
        bestLen = candPath.length;
      }
    }
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortChildren = (nodes: FolderNode[]): void => {
    nodes.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    for (const n of nodes) sortChildren(n.children);
  };
  sortChildren(roots);
  return roots;
}
