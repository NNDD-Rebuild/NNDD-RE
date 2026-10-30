/**
 * ログ中の機微情報のマスク。
 * 開発者へのログ送信時だけ使う。ローカルのログファイルはデバッグ用に生のまま残す。
 * 冪等 (二重に掛けても結果が変わらない) になるよう、置換後は `***` に統一する。
 */

const MASK = '***';

/** `name=value` / `name: value` / `"name":"value"` 形式で値を伏せるキー */
const SECRET_KEYS = [
  'user_session',
  'user_session_secure',
  'nicosid',
  'audience_token',
  'csrfToken',
  'csrf_token',
  'access_token',
  'refresh_token',
  'token',
  'password',
  'secret',
  'authorization',
  'userId',
  'hashedUserId',
  'audienceToken',
  'deleteToken',
  'delete_token',
  'user_id',
  'email',
  'mail_tel',
  'Signature',
  'Policy',
  'Key-Pair-Id',
  'ht2_nicovideo',
  'sid'
];

const keyAlt = SECRET_KEYS.map((k) => k.replace(/[-_]/g, '[-_]')).join('|');

// name=value (Cookie / クエリ文字列)
const KV_EQ = new RegExp(`\\b(${keyAlt})=([^;&\\s"'<>]+)`, 'gi');
// "name":"value" / "name": 123 (JSON)
const KV_JSON = new RegExp(`("(?:${keyAlt})"\\s*:\\s*)("[^"]*"|[^,}\\s]+)`, 'gi');
// 文字列に埋め込まれたエスケープ済み JSON (\"name\":\"value\")
const KV_JSON_ESC = new RegExp(`(\\\\"(?:${keyAlt})\\\\"\\s*:\\s*)(?:\\\\"[^"\\\\]*\\\\"|[^,}\\s\\\\]+)`, 'gi');
// HTML の属性値に埋め込まれた JSON (&quot;name&quot;:&quot;value&quot;)
const KV_JSON_HTML = new RegExp(`(&quot;(?:${keyAlt})&quot;\\s*:\\s*)(?:&quot;.*?&quot;|[^,}\\s&]+)`, 'gi');
// Discord / Slack Webhook URL
const WEBHOOK = /(https?:\/\/(?:(?:discord(?:app)?\.com\/api\/webhooks)|(?:hooks\.slack\.com\/services))\/)[^\s"'<>]+/gi;
// メールアドレス
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// URL パス中のユーザーID (/user/123, /users/123)。マイリスト・フォロー系 URL に出る
const USER_PATH = /(\/users?\/)\d+/gi;
// 「user 12345」形式 (FollowFeedClient など)
const USER_WORD = /\b(user\s+)\d{3,}/gi;

// ユーザーアイコン URL (.../usericon/<上位桁>/<ユーザーID>.jpg)。ユーザーID が入る
const USER_ICON = /(usericon\/)\d+\/\d+/gi;

// --- ファイルパス ---
// ユーザー名・ライブラリのフォルダ名・ファイル名 (動画タイトル、accounts/<ユーザーID>.json など) に
// 個人情報が入るため、ディレクトリは丸ごと `<path>` にする。拡張子だけ残す。
// Windows のユーザー名には空白が入る (例: "Hiroto Nakashima") ので、途中のフォルダ名は空白を許す。
// 最後の要素は空白で打ち切る (後ろの文章まで飲み込まないため)。
const SEP = String.raw`(?:\\\\|\\|/)`;
const SEG_SP = String.raw`[^\\/:*?"<>|,;\r\n]+`;
const SEG_NS = String.raw`[^\\/:*?"<>|,;\s]+`;
const WIN_PATH = new RegExp(
  String.raw`[A-Za-z]:(?:${SEP}${SEG_SP}(?=${SEP}))*${SEP}${SEG_NS}`,
  'g'
);
// UNC (\\server\share\...)。JSON 内では \\ が重なるので 2〜4 個を許す
const UNC_PATH = new RegExp(
  String.raw`(?<![A-Za-z:\\])\\{2,4}${SEG_NS}(?:${SEP}${SEG_SP}(?=${SEP}))*${SEP}${SEG_NS}`,
  'g'
);
// POSIX は API ルート (/api/...) を巻き込まないよう、ホームなど既知のルートから始まるものだけ
const POSIX_PATH =
  /(?<![\w:/.~-])(?:\/(?:home|Users|root|tmp|var|mnt|media|opt|srv|Volumes|private)|~)(?:\/[^/"'<>|:*?,;\r\n]+(?=\/))*\/[^/\s"'<>|:*?,;]+/g;

// --- 生データを載せている行 (エントリ末尾まで丸ごと伏せる。複数行のエントリも対象) ---
const RAW_TAIL: RegExp[] = [
  /(\[\w+\] schedule: )[\s\S]*/, // LiveSession の schedule JSON (「executing schedule:」は巻き込まない)
  /(\bssngUpdated: )[\s\S]*/,
  /(\bws error message: )[\s\S]*/,
  /(\bunhandled ws message[^\n]*?: )[\s\S]*/,
  /(master playlist \(head\): )[\s\S]*/,
  /(LAN getVideoIdList body\(300\): )[\s\S]*/,
  /(legacy NNDDServer POST: )[\s\S]*/,
  /(timeshift \w+ failed: HTTP \d+ )[\s\S]*/,
  /(timeshift cancel ok: [^\n]*? -> )[\s\S]*/
];

// --- 文脈つきの ID・名前・URL (会員種別 premium= などは触らない) ---
const CONTEXT_RULES: [RegExp, string][] = [
  [/(migrated legacy session to account: )\d+/g, `$1${MASK}`],
  [/(account data [^:\n]+: )\S+( -> )\S+/g, `$1${MASK}$2${MASK}`],
  [/(follow user renew: )\d+/g, `$1${MASK}`],
  [/(\buserId\s*=\s*)\S+/g, `$1${MASK}`],
  [/(\bmylist )\d+( page=)/g, `$1${MASK}$2`],
  [/(fetchUserName failed for )\d+/g, `$1${MASK}`],
  [/(\/mylists?\/)\d+/g, `$1${MASK}`],
  // GitHub 連携
  [/(access token saved for: )\S+/g, `$1${MASK}`],
  [/(credentials saved for: )\S+/g, `$1${MASK}`],
  [/(gist (?:created|updated): )\S+/g, `$1${MASK}`],
  [/(auto upload succeeded: ).*/g, `$1${MASK}`],
  [/(no changes since last upload \().*(\))/g, `$1${MASK}$2`],
  // 外部から来る URL・入力
  [/(Webhook URL[^:\n]*: )\S+/g, `$1${MASK}`],
  [/(handling cmd URL: )\S+/g, `$1${MASK}`],
  [/(invalid live id(?: for record)?: )\S+/g, `$1${MASK}`]
];

// --- URL のクエリ: デバッグに要る値だけ残し、それ以外 (検索語・タグ・署名など) は伏せる ---
const QUERY_KEEP = new Set([
  'page', 'pagesize', 'sort', 'order', 'limit', 'size', 'offset', 'count', 'type', 'mode',
  '_frontendid', '_frontendversion', 'term', 'responsetype', 'sortkey', 'sortorder',
  'sensitivecontents', 'format', 'lang'
]);
const QUERY_PARAM = /([?&])([^=&\s"'<>#]+)=([^&\s"'<>#]*)/g;

// --- IP アドレス・ホスト名 (127.x / 0.0.0.0 / ::1 はデバッグに要るので残す) ---
const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d]|\.\d)/g;
const HEX = '[0-9a-f]{1,4}';
const IPV6 = new RegExp(
  `(?<![\\w:])(?:(?:${HEX}:){7}${HEX}|(?:${HEX}:){0,6}[0-9a-f]{0,4}::(?:${HEX}:){0,6}[0-9a-f]{0,4})(?![\\w:])`,
  'gi'
);
const TS_NET = /[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.ts\.net\b/g;
const MDNS = /[A-Za-z0-9-]+\.local\b/g;

function maskIpv4(m: string): string {
  const parts = m.split('.').map(Number);
  if (parts.some((n) => n > 255)) return m; // バージョン文字列など
  if (parts[0] === 127 || m === '0.0.0.0') return m;
  return MASK;
}

function maskIpv6(m: string): string {
  return m === '::1' || m === '::' ? m : MASK;
}

function maskPath(m: string): string {
  const ext = /\.[A-Za-z0-9]{1,5}$/.exec(m);
  return `<path>${ext ? ext[0] : ''}`;
}

/**
 * 1 エントリ (ログ 1 件。スタックトレースなど複数行を含む) を対象にする。
 * 「エントリ末尾まで伏せる」規則があるため、呼び出し側はエントリごとに掛けること。
 */
export function maskSensitive(text: string): string {
  let t = text;
  for (const re of RAW_TAIL) t = t.replace(re, `$1${MASK}`);
  for (const [re, rep] of CONTEXT_RULES) t = t.replace(re, rep);
  return t
    .replace(WIN_PATH, maskPath)
    .replace(UNC_PATH, maskPath)
    .replace(POSIX_PATH, maskPath)
    .replace(USER_ICON, `$1${MASK}/${MASK}`)
    .replace(USER_PATH, `$1${MASK}`)
    .replace(USER_WORD, `$1${MASK}`)
    .replace(WEBHOOK, `$1${MASK}`)
    .replace(KV_JSON, (_m, k: string) => `${k}"${MASK}"`)
    .replace(KV_JSON_ESC, (_m, k: string) => `${k}\\"${MASK}\\"`)
    .replace(KV_JSON_HTML, (_m, k: string) => `${k}&quot;${MASK}&quot;`)
    .replace(KV_EQ, (_m, k: string) => `${k}=${MASK}`)
    .replace(QUERY_PARAM, (m, sep: string, k: string, v: string) =>
      QUERY_KEEP.has(k.toLowerCase()) || v === MASK ? m : `${sep}${k}=${MASK}`
    )
    .replace(IPV4, maskIpv4)
    .replace(IPV6, maskIpv6)
    .replace(TS_NET, `${MASK}.ts.net`)
    .replace(MDNS, `${MASK}.local`)
    .replace(EMAIL, MASK);
}

/**
 * 送る人が選べる追加のマスク。ログ中の定型的な書式に対するもので、
 * 自由文に混ざったタイトルや名前までは拾えない (プレビューで確認してもらう)。
 */
export function maskOptional(
  text: string,
  opts: { maskVideoIds: boolean; maskChannels: boolean; maskNames: boolean }
): string {
  let t = text;
  if (opts.maskVideoIds) {
    t = t
      // ChannelWatcher: "new video detected: <名前> → sm123 <タイトル>"
      .replace(/(new video detected: .*? → \S+) .*/g, `$1 ${MASK}`)
      // LiveDownloader: "start <mode> lv123: <タイトル>"
      .replace(/(\bstart \S+ (?:lv|so|sm|nm|nl)\d+: ).*/g, `$1${MASK}`)
      .replace(/\b(sm|so|nm|lv|nl)\d+\b/g, `$1${MASK}`)
      .replace(/(\/watch\/)\d+/g, `$1${MASK}`)
      // サムネイル URL (.../thumbnails/<数字の動画ID>/<数字の動画ID>.<サフィックス>)
      .replace(/(thumbnails\/)\d+\/\d+(?:\.\d+)?/g, `$1${MASK}/${MASK}`)
      // サムネキャッシュのファイル名は URL の SHA-1 なので、動画ID と対応づけられる
      .replace(/(cached: )[0-9a-f]{40}/g, `$1${MASK}`);
  }
  if (opts.maskChannels) {
    t = t
      .replace(/(new video detected: ).*?( → )/g, `$1${MASK}$2`)
      .replace(/(channel watch failed: )(.*?)(?=\s(?:\w*Error\b|[{[])|$)/gm, `$1${MASK}`)
      .replace(/(\bchannel )\S+( page=\d+)/g, `$1${MASK}$2`)
      .replace(/(ch\.nicovideo\.jp\/)[^/\s?"'#]+/g, `$1${MASK}`)
      .replace(/\b(ch|co)\d{3,}\b/g, `$1${MASK}`)
      // チャンネル・コミュニティのアイコン URL
      .replace(/(\/(?:channel|community)-icon\/)[^\s"']+/g, `$1${MASK}`);
  }
  if (opts.maskNames) {
    t = t
      // 自動ダウンロード・予約の名前 (マイリスト名・シリーズ名・検索語などを含みうる)
      .replace(/(mylist renew: ).*?( fetched=)/g, `$1${MASK}$2`)
      .replace(/(series renew: ).*?( fetched=)/g, `$1${MASK}$2`)
      .replace(/(schedule done: ).*?( fetched=)/g, `$1${MASK}$2`)
      .replace(/(executing schedule: ).*( \([^()\n]*\))$/gm, `$1${MASK}$2`)
      .replace(/(schedule target (?:series|user) id missing: ).*/g, `$1${MASK}`)
      .replace(/(schedule target mylist not found: )\S+/g, `$1${MASK}`)
      .replace(/(renew failed: )\S+/g, `$1${MASK}`)
      // シリーズ名・シリーズID
      .replace(/(fetchSeriesTitleFromApi: title=).*/g, `$1${MASK}`)
      .replace(/(\bseriesId=)\d+/g, `$1${MASK}`)
      .replace(/(href regex, id=)\d+/g, `$1${MASK}`)
      .replace(/(\/series\/)\d+/g, `$1${MASK}`);
  }
  return t;
}
