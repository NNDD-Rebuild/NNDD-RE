import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { getConfigStore } from '../config/ConfigStore';

/**
 * ロガー (元: src/org/mineap/nndd/LogManager.as)
 *
 * - コンソール出力
 * - ファイル出力 (`<userData>/log/nndd.log`)
 * - サイズが大きくなったら自動ローテート (設定 > logRotation で上限サイズ・保持世代数を変更可能)
 */

let logFilePath: string | null = null;
let initialized = false;
let currentLogLevel: 'standard' | 'verbose' = 'standard';

export function setLogLevel(level: 'standard' | 'verbose'): void {
  currentLogLevel = level;
}

export function getLogLevel(): 'standard' | 'verbose' {
  return currentLogLevel;
}

function ensureInit(): void {
  if (initialized) return;
  try {
    const dir = path.join(app.getPath('userData'), 'log');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    logFilePath = path.join(dir, 'nndd.log');
    initialized = true;
  } catch {
    // app が ready 前に呼ばれた場合などは諦めてコンソールのみ
  }
}

/** .{maxFiles-1} → .{maxFiles}, ..., .1 → .2, 本体 → .1 の順に世代をずらす */
function rotateLogFile(filePath: string, maxFiles: number): void {
  const oldest = `${filePath}.${maxFiles}`;
  if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
  for (let i = maxFiles - 1; i >= 1; i--) {
    const src = `${filePath}.${i}`;
    if (fs.existsSync(src)) fs.renameSync(src, `${filePath}.${i + 1}`);
  }
  fs.renameSync(filePath, `${filePath}.1`);
}

function writeToFile(level: string, tag: string, message: string): void {
  if (!initialized) ensureInit();
  if (!logFilePath) return;
  try {
    if (fs.existsSync(logFilePath)) {
      const stat = fs.statSync(logFilePath);
      const rotation = getConfigStore().get('logRotation') ?? { maxSizeMb: 1, maxFiles: 3 };
      if (stat.size > rotation.maxSizeMb * 1_000_000) {
        rotateLogFile(logFilePath, Math.max(1, rotation.maxFiles));
      }
    }
    const line = `${new Date().toISOString()} [${level}][${tag}] ${message}\n`;
    fs.appendFileSync(logFilePath, line, 'utf-8');
  } catch {
    // ファイル書き込み失敗は無視
  }
}

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
}

export class Logger {
  constructor(private readonly tag: string) {}

  info(...args: unknown[]): void {
    console.log(`[INFO][${this.tag}]`, ...args);
    writeToFile('INFO', this.tag, format(args));
  }
  warn(...args: unknown[]): void {
    console.warn(`[WARN][${this.tag}]`, ...args);
    writeToFile('WARN', this.tag, format(args));
  }
  error(...args: unknown[]): void {
    console.error(`[ERROR][${this.tag}]`, ...args);
    writeToFile('ERROR', this.tag, format(args));
  }
  verbose(...args: unknown[]): void {
    if (currentLogLevel === 'verbose') {
      console.log(`[VERBOSE][${this.tag}]`, ...args);
      writeToFile('VERBOSE', this.tag, format(args));
    }
  }
  debug(...args: unknown[]): void {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(`[DEBUG][${this.tag}]`, ...args);
      writeToFile('DEBUG', this.tag, format(args));
    }
  }
}

export function createLogger(tag: string): Logger {
  return new Logger(tag);
}

/**
 * ログファイルの読み出し (末尾 maxBytes バイトのみ)。
 */
export function readLogTail(maxBytes = 64 * 1024): string {
  ensureInit();
  if (!logFilePath || !fs.existsSync(logFilePath)) return '';
  try {
    const stat = fs.statSync(logFilePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(logFilePath, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf-8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

export function getLogFilePath(): string | null {
  ensureInit();
  return logFilePath;
}

export function clearLog(): void {
  ensureInit();
  if (logFilePath && fs.existsSync(logFilePath)) {
    fs.writeFileSync(logFilePath, '', 'utf-8');
  }
}
