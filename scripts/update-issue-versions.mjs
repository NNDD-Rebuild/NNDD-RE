// bug_report.yml の「NNDD-REのバージョン」dropdown を、GitHub のリリース一覧から作り直す。
// 使い方: gh release list --json tagName,isDraft --limit 30 | node scripts/update-issue-versions.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const MAX_STABLE = 8
const MAX_DEV = 10
const FILE = '.github/ISSUE_TEMPLATE/bug_report.yml'

const releases = JSON.parse(readFileSync(0, 'utf8'))
const all = releases.filter((r) => !r.isDraft).map((r) => r.tagName.replace(/^[vV]/, ''))
if (all.length === 0) throw new Error('リリースが取得できませんでした')
// 1.2.3-beta.1 のように "-" を含むものを開発版とする。安定版を先に並べる
const stable = all.filter((v) => !v.includes('-')).slice(0, MAX_STABLE)
const dev = all.filter((v) => v.includes('-')).slice(0, MAX_DEV)
const options = [
  ...stable.map((v) => `${v} (安定版)`),
  ...dev.map((v) => `${v} (開発版)`),
  'それより古い / 不明'
]
  .map((v) => `        - "${v}"`)
  .join('\n')

const block = `  - type: dropdown
    id: version
    attributes:
      label: NNDD-REのバージョン
      description: 設定 > バージョン情報 で確認できます。一覧にない場合は「それより古い / 不明」を選び、補足に書いてください。
      options:
${options}
    validations:
      required: true
`

const src = readFileSync(FILE, 'utf8')
// id が version で始まる要素 (version-stable / version-dev が残っていても全部) を、次の別 id の要素の手前まで差し替える
const re = /  - type: \w+\n    id: version[\w-]*\n[\s\S]*?(?=  - type: \w+\n    id: (?!version))/
if (!re.test(src)) throw new Error('version の要素が見つかりません')
const next = src.replace(re, block)
if (next !== src) writeFileSync(FILE, next)
console.log(next === src ? '変更なし' : `更新: 安定版 ${stable.join(', ')} / 開発版 ${dev.join(', ')}`)
