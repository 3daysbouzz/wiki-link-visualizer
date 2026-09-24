# wiki-link-visualizer

Wikipedia記事間のリンクを3Dグラフで可視化するWebアプリ。個人開発のプロトタイプ。

## このツールの目的

**Wikipediaを読み歩く行為(wiki散歩)を、3D空間の移動として体験できるようにする。**

判断に迷ったら、これを基準にすること。

- 大量のノードを見せることは目的ではない。ノードを増やすより
  「次にどれをクリックするか」を判断しやすくする方を優先する
- クリック前にその記事が何かを判断できることが体験の質を決める
- 3Dの価値は「空間を移動している感覚」にある。3D特有の読みにくさ
  (線の交差、奥行きの誤認)はUI側で補償する前提で設計する

## 絶対に守ること

**`react-force-graph-3d` / `3d-force-graph` / `three-forcegraph` /
`three-render-objects` を依存に追加しない。**

これらは内部依存のバージョン解決が壊れており、「データは取れるのに画面が真っ暗」
という再現済みの不具合を起こす。`package.json` の `overrides` による固定も、
下位依存が `^1.29` のような緩い指定で最新版を引くため効かない。
経緯は `SPEC.md` 9章と `README.md` にある。

**3D描画は `three` 本体のみを直接使う。** 実装は `src/components/Graph3D.jsx`
に集約されている。力学レイアウト・ラベル・カメラ・クリック判定はすべて自前実装。

**依存パッケージを増やすときは、先に理由を提示して確認を取る。**
現在の依存は `react` / `react-dom` / `three` と、デバッグパネル用の `leva`(ユーザー指示で追加)。
この「依存を最小限に保つ」方針自体が上記の不具合への対応策になっている。

**レイアウト・抽選に `Math.random` を使わない。** 種付き乱数(`src/utils/prng.js`)を使う。
同じ (開始記事, 経路, 設定) で同じ配置になることが、UI 調整の比較の前提(SPEC 12章)。

**表示パラメータは `src/config/presets.ts` の VizConfig で持つ。** `current` プリセットは
回帰確認用なので削除しない。URL クエリ(`?preset=&nodeLimit=…`)で上書きできる。
**力学レイアウトの値(`repulsion` `springK` など)も VizConfig にある。**
既定値は `constants.js`、範囲は `presets.ts` の `RANGES`、この2つと `current` プリセットは
必ず揃える(テストで検査している)。詳細は SPEC 12.2。

## コマンド

```bash
npm install
npm run dev     # http://localhost:5173
npm run build
npm test        # tests/ を node:test で実行(依存なし)
```

## ファイル構成

```
src/
├── main.jsx
├── App.jsx                   状態管理。軌跡(trail)からグラフを組み立てる
├── App.css                   デザイントークン(:root の CSS 変数)とレイアウト
├── constants.js              チューニング可能な定数はすべてここ(px・秒・不透明度も)
├── api/
│   ├── wikipedia.js          リンク取得・関連スコア(morelike+相互リンク+冒頭リンク)・閲覧数(REST)・抽選・メタ情報・検索候補
│   └── summary.js            記事プレビュー(REST summary API)
└── components/
    ├── Graph3D.jsx           3D描画。ハイライト・ラベル・グリッド・パケット・遷移・カメラ追従
    │                          力学と見た目の値は VizConfig から受け取る(直書きしない)
    ├── TopBar.jsx            ロゴ・検索欄(候補付き)・統計値・リセット
    ├── Sidebar.jsx           右サイドバー(記事名・メタ・抜粋・隣接記事)
    ├── Breadcrumb.jsx        左下の履歴パンくず
    ├── ZoomControls.jsx      右下のズーム +/−
    └── DebugPanel.jsx        leva パネル(?debug=1)。layout / visual / ranking のフォルダに分ける
tests/                        node:test のユニットテスト(API のエラー処理・抽選・URL 読み取り)
```

`src/config/`(VizConfig・URL クエリ)と `src/utils/prng.js`(種付き乱数)は SPEC 12章。

`index.html` で Google Fonts(Space Grotesk / JetBrains Mono)を `<link>` で読む。
これは npm 依存ではないので上の「依存を増やさない」には抵触しない。

## 設計上の約束事

**数値のチューニングは `src/constants.js` だけで完結させる。**
マジックナンバーをコンポーネントに直接書かない。

**グラフは差分で足し引きせず、毎回 `trail`(訪問した記事の列)から組み立て直す。**
これにより「戻る」が trail を短く切るだけで済み、進む／戻るのどちらでも
同じ結果になることが保証される。この方式を崩さないこと。

**抽選結果は `expansions` に記憶する。** リンク選定は呼ぶたびに結果が変わる
重み付き抽選なので、記憶せずに再構築すると遡ったときに違う道が現れて経路が壊れる。

**色は使わない。白の「大きさ・塗り/中空・線種・不透明度」に別々の意味を割り当てる。**
(2026-09-19 の UI 指示書「Wireframe Terminal」に従う。黒背景に白の階調のみ、
アクセントカラー・角丸・グラデーション・絵文字は禁止)

- 大きさ = 現在地からの距離(起点 14px > 一次 6〜9px > 二次 4px)。
  **一次ノードの中だけ**閲覧数で幅を持たせる。必ず対数で割り当てる
  (閲覧数は記事間で1万倍以上違う)
- 塗り/中空 = 未訪問は白塗り、訪問済み(軌跡上の起点以外)は白い輪郭だけ
- 線種 = 起点につながる線は実線、それ以外は破線
- 不透明度 = 奥のもの(二次ノード・破線)ほど薄い
- 現在地 = 最大の球 + 呼吸する外周リング

両方に同じ意味を持たせない。大きさは**画面上のピクセル**で指定する
(`Sprite` の `sizeAttenuation:false`。カメラ距離で見た目が変わらない)。

**関連記事の順位は合計スコア**(morelike の順位 + 相互リンク + 冒頭リンクの加点。SPEC 3.3)。
重みは VizConfig の `wMorelike` / `wMutual` / `wLead`。`current` は加点なし(従来の順位)で、
既定のプリセットは加点ありの `rev2`。スコア計算は純粋関数 `rankCandidates` に切り出してテストしている。

**関連記事の順位付けに閲覧数を使わない。** MediaWiki API の `prop=pageviews` は
1リクエストで新たに5件しか閲覧数を返さないため、数百件の候補を閲覧数で並べる
ことはできない(`MAX_CONTINUE` を増やしても解決しない)。順位は morelike 検索、
閲覧数は表示する分だけ REST API で取る、という分担を崩さないこと。経緯は `SPEC.md` 3.1。

**Wikipedia への fetch に独自ヘッダを付けない。** 事前確認(preflight)が発生し、
REST API 側が CORS ヘッダを返さず失敗する。

**Wikipedia への fetch は `fetchWithTimeout`(wikipedia.js)を通す。** 素の `fetch` は
応答が返らないと永久に待つ。エラーの文言は SPEC 3.6d の表に合わせる。

**`target="_blank"` のリンクには `rel="noopener noreferrer"` を付け、`innerHTML` /
`dangerouslySetInnerHTML` に文字列を流し込まない。** 外部データ由来の URL は https のみ href にする。

**UI の見た目の値は `App.css` の `:root` の CSS 変数と `constants.js` にだけ書く。**
半径 px・周期秒・不透明度・ブレークポイントをコンポーネントに直接書かない。
ボタン・リンクは実要素(`<button>` `<a>`)で作り、アイコンだけのボタンには `aria-label` を付ける。

**コードのコメントは日本語で書く。** 「なぜそうしたか」を書く。
特に、一見遠回りに見える実装(半透明ではなく色を暗くする、など)には
理由を必ず残す。既存コードのコメントのトーンに合わせること。

## 詳細仕様

API仕様・UI仕様・定数の意味は `SPEC.md` にある。
データ取得やUIの挙動を変更するときは必ず読むこと。
**実装を変えたら `SPEC.md` も更新する。**

## デバッグ

**画面がおかしいときは、まずブラウザのConsoleを見ること。**
過去の不具合は画面上は無言で真っ暗になる一方、Consoleには明確なエラーが
出ていた。切り分けの最短ルート。

正常時は以下が出る。

```
[Graph3D] Three.js r169 / WebGL context: OK
[wikipedia] 初音ミク: 1902ms / リンク先381件(1回取得) / 除外: 日付等7件 / morelike一致90件 / 相互リンク170件 / 冒頭リンク15件 / 確定枠のうちmorelike圏外0件 → プール150件から40件抽選
[Graph3D] scene updated: nodes=41, links=40
[pageviews] 41件を1175msで取得
```

`[wikipedia]` の行はチューニングの判断材料になる。「上限打ち切り」が出るなら
`MAX_CONTINUE`、「morelike一致」が10件を切る警告が頻発するなら `RELATED_LIMIT` や
並べ替えの方針(SPEC 3.3)を見直す。`[pageviews]` に「失敗N件」が出続けるなら
`VIEWS_CONCURRENCY` を下げる(叩きすぎで拒否されている)。
「冒頭リンク0件(取得失敗)」が続くなら parse の失敗なので、順位は冒頭の加点なしで出ている。
重みの調整は `?debug=1` の `console.table`(プール上位20件の m・mutual・lead・score)を見て行う。

## 説明のしかた

エラーメッセージの意味や、なぜその修正が必要かを一言添えて説明すること。
ターミナルのコマンドは、丸ごとコピーできる形で示す。
