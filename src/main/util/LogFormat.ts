/** ログ引数の整形 (純粋関数。electron に依存しない) */

function formatOne(a: unknown): string {
  if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`;
  if (typeof a === 'object') {
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }
  return String(a);
}

/**
 * 第1引数に printf 形式 (%s %d %i %f %j %o %O %%) があれば、続く引数を順に埋める。
 * util.format は使わない (オブジェクトが inspect 形式になり、`"key":"value"` 前提のマスクが効かなくなる)。
 * 余った引数は末尾に空白区切りで付ける。引数が 1 つだけのときは置換しない (Node の util.format と同じ)。
 */
export function format(args: unknown[]): string {
  const [head, ...rest] = args;
  if (typeof head === 'string' && rest.length > 0 && /%[sdifjoO%]/.test(head)) {
    let i = 0;
    const filled = head.replace(/%([sdifjoO%])/g, (m, t: string) => {
      if (t === '%') return '%';
      if (i >= rest.length) return m;
      const v = rest[i];
      // %d %i %f は数値のときだけ。URL の %f0 のようなパーセントエンコードを誤って置換しない
      if (t === 'd' || t === 'i' || t === 'f') {
        if (typeof v !== 'number' && typeof v !== 'bigint') return m;
        i++;
        return t === 'i' ? String(parseInt(String(v), 10)) : String(v);
      }
      i++;
      return formatOne(v);
    });
    return [filled, ...rest.slice(i).map(formatOne)].join(' ');
  }
  return args.map(formatOne).join(' ');
}
