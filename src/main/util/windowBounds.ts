import { screen, type BrowserWindow, type Rectangle } from 'electron';

/** タイトルバーを掴める最低限の見えている幅・高さ (px) */
const MIN_VISIBLE = 80;

/**
 * 保存しておいたウィンドウ位置が、今の画面構成で画面内に見えるか。
 * モニターの取り外し・解像度変更・リモートデスクトップ接続などで位置が画面外になっていると、
 * タスクバーにはあるのに画面に出てこないウィンドウになるため、復元前に確認する。
 */
export function isBoundsVisible(b: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    const visibleW = Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x);
    // タイトルバー側 (上端) が作業領域内にあることも要求する
    const topInside = b.y >= wa.y - 8 && b.y <= wa.y + wa.height - MIN_VISIBLE;
    return visibleW >= MIN_VISIBLE && topInside;
  });
}

/** 保存済み位置が画面外なら undefined を返す (呼び出し側で初期位置にフォールバックする) */
export function visibleBoundsOrUndefined<T extends { x: number; y: number; width: number; height: number }>(
  saved: T | undefined
): T | undefined {
  return saved && isBoundsVisible(saved) ? saved : undefined;
}

/**
 * 最小化・非表示のウィンドウを元に戻して前面に出す。
 * 最小化中のウィンドウに対する focus() / show() は何もしない (Electron の仕様) ため、先に restore() する。
 * 位置が画面外になっていたら、現在の画面の作業領域の中央へ戻す。
 */
export function revealWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isMaximized() && !win.isFullScreen()) {
    const b = win.getBounds();
    if (!isBoundsVisible(b)) {
      const wa: Rectangle = screen.getPrimaryDisplay().workArea;
      const width = Math.min(b.width, wa.width);
      const height = Math.min(b.height, wa.height);
      win.setBounds({
        x: wa.x + Math.round((wa.width - width) / 2),
        y: wa.y + Math.round((wa.height - height) / 2),
        width,
        height
      });
    }
  }
  win.show();
  win.focus();
}
