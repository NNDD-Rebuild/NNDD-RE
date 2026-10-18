/**
 * 同じキーの処理を直列に実行する。前の処理が終わる (成功・失敗どちらでも) まで次を始めない。
 * サーバー同期のように、同じ基準から並走すると二重送信や基準の上書きが起きる処理に使う。
 */
const tails = new Map<string, Promise<unknown>>();

export function runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return run;
}
