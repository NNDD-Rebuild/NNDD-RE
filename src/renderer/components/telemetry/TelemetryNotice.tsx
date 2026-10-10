import { Hint } from '../settings/common';

/** 匿名統計で送る内容の説明。同意ダイアログと情報タブで共通に使う */
export function TelemetryNotice(): JSX.Element {
  return (
    <div className="space-y-2 text-xs text-nndd-subtext">
      <div>
        <div className="font-semibold text-nndd-text">送る内容</div>
        <ul className="list-disc pl-5">
          <li>アプリのバージョン、OS の種類とバージョン、言語</li>
          <li>使った機能の種類と回数 (開いたタブ、動画の再生・ダウンロード、生放送の視聴など)</li>
          <li>設定の値 (オン/オフ、選択肢、数値だけ。GitHub 同期を設定しているかどうかを含みます)</li>
          <li>端末ごとに作る匿名のランダムID (個人とは結びつきません)</li>
          <li>1 時間ごとに送る、おおよその起動時間</li>
        </ul>
      </div>
      <div>
        <div className="font-semibold text-nndd-text">送らない内容</div>
        <ul className="list-disc pl-5">
          <li>ニコニコのアカウント情報、Cookie、各種トークン</li>
          <li>動画ID・タイトル・検索語・コメントの中身</li>
          <li>ファイルのパス、URL、ホスト名など</li>
        </ul>
      </div>
      <Hint>
        使った機能は操作のたびには送らず、10 分ごとか次の起動時にまとめて送ります。送り先は作者が運営する Aptabase で、機能の改善の参考にだけ使います。
        同意しなくてもアプリの機能は変わりません。同意はいつでも 設定 &gt; 情報 で外せます。
      </Hint>
    </div>
  );
}
