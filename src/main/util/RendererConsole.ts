import type { WebContents } from 'electron';
import type { Logger } from './Logger';

type Level = 'debug' | 'info' | 'warning' | 'error';
const RANK: Record<Level, number> = { debug: 0, info: 1, warning: 2, error: 3 };

/**
 * レンダラーの console を main のログに転送する。
 * Electron 35 以降の `console-message` は details オブジェクトで受ける (位置引数は非推奨)。
 * debug (console.debug) は log.verbose に回し、設定が「標準」のときはファイルに出さない。
 *
 * @param label ログ行の接頭辞 (例: `renderer`)
 * @param minLevel これ未満の level は転送しない
 */
export function forwardRendererConsole(
  wc: WebContents,
  log: Logger,
  label: string,
  minLevel: Level = 'debug'
): void {
  wc.on('console-message', (details) => {
    const level = details.level as Level;
    if ((RANK[level] ?? 1) < RANK[minLevel]) return;
    const src = details.sourceId?.split('/').pop() ?? '';
    const tag = level === 'warning' ? 'warn' : level === 'debug' ? 'verbose' : level;
    const text = `[${label}:${tag}] ${details.message} (${src}:${details.lineNumber})`;
    if (level === 'error') log.error(text);
    else if (level === 'warning') log.warn(text);
    else if (level === 'debug') log.verbose(text);
    else log.info(text);
  });
}
