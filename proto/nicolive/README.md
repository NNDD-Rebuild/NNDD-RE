# nicolive protobuf 定義

ニコニコ生放送のコメントサーバー (NDGR) の protobuf 定義。

- 取得元: https://github.com/n-air-app/nicolive-comment-protobuf (MIT License, LICENSE 参照)
- 取得コミット: 2e852e08df016888aefa602ec6c5be6a558eb3d9 (2026-09-02)

更新時は取得元の `proto/` 配下をここへ上書きコピーし、`npm run gen:proto` で
`src/main/nicovideo/live/gen/` の TypeScript を再生成する。
