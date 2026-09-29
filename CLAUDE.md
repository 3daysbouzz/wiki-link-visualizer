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
- 面白さの本質は wiki 自体にあり、このツールはそれを 3D の形で届ける。判断しやすい・操作しやすい・
  視認性が高い・ちゃんと動く、はすべて「面白さを詰める」ことと同じ(2026-09-26 利用者と合意)

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
├── utils/                    純粋関数(下の段落)。表示と測定が同じ関数を呼ぶ
├── debug/
│   ├── measure.js            画面上の見え方の測定(window.__viz.measure。SPEC 12.5)。呼ばれたときだけ読み込む
│   ├── benchRoutes.js        測る経路の一覧(行を足すだけで測れる)
│   └── walks.js              長い経路の歩き方と、輪の起きやすさの数え方(タスク11。tests/walks.test.js)
├── api/
│   ├── wikipedia.js          リンク取得・関連スコア(morelike+相互リンク+冒頭リンク)・閲覧数(REST)・抽選・メタ情報・検索候補
│   ├── requestQueue.js       全通信共通の同時リクエスト数の行列(上限3・優先度3段階・待機中の取り消し。SPEC 3.6e)
│   └── summary.js            記事プレビュー(REST summary API)
└── components/
    ├── Graph3D.jsx           3D描画。ハイライト・ラベル・グリッド・パケット・遷移・カメラ追従
    │                          力学と見た目の値は VizConfig から受け取る(直書きしない)
    ├── TopBar.jsx            ロゴ・検索欄(候補付き)・統計値・リセット
    ├── Sidebar.jsx           右サイドバー(記事名・メタ・抜粋・隣接記事)
    ├── Breadcrumb.jsx        左下の履歴パンくず
    ├── ZoomControls.jsx      右下のズーム +/−
    └── DebugPanel.jsx        leva パネル(?debug=1)。layout / visual / ranking / relation のフォルダに分ける
scripts/                      開発用の Node スクリプト。fetch-long-walks.mjs(長い経路の展開結果を一度だけ取って tests/fixtures に保存)・
                              count-long-walk-loops.mjs(保存した経路で輪の起きやすさを数える。docs/tasks/11-report-loops.md)
tests/                        node:test のユニットテスト(API のエラー処理・関連スコア・抽選・追加表示・全通信の同時リクエスト数の行列・閲覧数の行列・深さフェード・URL 読み取り・関連の強さ・切り出した計算の回帰・配置の回帰・画面上の見え方の測定・輪の演出)
```

`src/config/`(VizConfig・URL クエリ)と `src/utils/prng.js`(種付き乱数)は SPEC 12章。
`src/utils/depthFade.js`(ラベルの深さフェードの計算)は SPEC 6.3。
`src/utils/eggMotion.js`(輪の演出の時間割・光の明るさ・輪を並べ替える正多角形とカメラの距離・力学の状態の記録と復元。タスク10)は SPEC 6.11。
`src/utils/buildGraph.js`(trail からグラフを組み立てる)は SPEC 7章、
`src/utils/relation.js`(関連の強さを配置と動きで見せる計算・到着時の強調の対象。rev3・rev4)は SPEC 6.9・6.10、
同じファイルの輪の判定・輪の候補・輪の色(`detectLoop`・`loopCandidates`・`eggColorFor`。タスク10)は SPEC 6.11。
輪の候補は表示の合図と `measure()` の M10 が同じ `loopCandidates` を呼ぶ。
`src/utils/forceLayout.js`(力学の1ステップ・初期位置・全体を収める距離)・`labelSelect.js`(ラベルの間引きの判断)・
`screenProjection.js`(画面への投影・測定用の視点)・`nodeStyle.js`(階層と球の大きさ)は Graph3D.jsx から切り出したもので、
**表示(Graph3D)と画面上の見え方の測定(SPEC 12.5)が同じ関数を呼ぶ。** 測定側に計算を写さないこと
(表示を調整しても測定に反映されず、数字だけがずれていく)。`screenMetrics.js` は測定の小さな計算。
`cameraFit.js`(最初のカメラ距離の決め方。SPEC 4章)も表示と測定が同じ関数を呼ぶ。

`index.html` で Google Fonts(Space Grotesk / JetBrains Mono)を `<link>` で読む。
これは npm 依存ではないので上の「依存を増やさない」には抵触しない。

## 設計上の約束事

**数値のチューニングは `src/constants.js` だけで完結させる。**
マジックナンバーをコンポーネントに直接書かない。

**グラフは差分で足し引きせず、毎回 `trail`(訪問した記事の列)から組み立て直す**(`buildGraph`)。
これにより「戻る」が trail を短く切るだけで済み、進む／戻るのどちらでも
同じ結果になることが保証される。この方式を崩さないこと。

**抽選結果は `expansions` に記憶する。** リンク選定は呼ぶたびに結果が変わる
重み付き抽選なので、記憶せずに再構築すると遡ったときに違う道が現れて経路が壊れる。
追加表示(中心クリック / + MORE。SPEC 6.8)の分も `expansions` の末尾に追記する。
各リンクは `{ title, mutual, relScore }`。`relScore` は展開したときの重みで 0〜1 にならして保存する(SPEC 3.3)。
以前に展開した記事へもう一度進むときは取り直さず、記憶した結果を使う(追加分を消さないため)。

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
- 大きさの脈動 = 取得中(クリックした記事の関連記事を取りに行っている間、そのノードが脈打つ)
- 明るさの脈動 = 輪を閉じられる記事の合図(タスク10。今の中心の子のうち、2つ以上前に通った記事)。
  半透明にせず色を暗くして揺らす。どちらの脈動もほかの意味に使わない
  (中心同士の相互リンクの脈動はタスク07 で外した)

両方に同じ意味を持たせない。大きさは**画面上のピクセル**で指定する
(`Sprite` の `sizeAttenuation:false`。カメラ距離で見た目が変わらない)。

**例外: 輪を閉じたときの演出(イースターエッグ。SPEC 6.11)の中だけは色を使う。** 輪の長さで色が一方向に進む
(段階は4つ: 3 = 黄 → 4 = 黄緑 → 5 = 緑 → 6以上 = 青に近い色 + カメラワーク。7件以上も6件と同じ。`EGG_COLORS`。タスク11)。
常設の表示には使わない(2026-09-26 利用者と合意)。演出の時間割は `eggTimeline`(`src/utils/eggMotion.js`)が決め、テストで確かめる。
説明しない仕掛けなので、README には書かない(開発者向けの SPEC と CLAUDE.md だけに書く)。

**関連記事の順位は合計スコア**(morelike の順位 + 相互リンク + 冒頭リンクの加点。SPEC 3.3)。
重みは VizConfig の `wMorelike` / `wMutual` / `wLead`。`current` は加点なし(従来の順位)で、
`rev2` 以降は加点あり。スコア計算は純粋関数 `rankCandidates` に切り出してテストしている。
`rev3`(関連の強さを配置に出す。06 の基準値)・`rev4`(到着時の共通ワード強調・中心同士の距離の段階・最初のカメラ距離。SPEC 4章・6.9・6.10)を経て、
**既定のプリセットは `rev5`**(rev4 + 表示件数 `neighborLimit` 24 = 確定枠 10 + 抽選の枠 14。タスク09。SPEC 3.3)。
current・rev2・rev3・rev4 は比べるために残す(回帰テストで 08 完了時の配置とカメラ距離を検査している)。
`?preset=` の無い URL は rev5 で開く(SPEC 12.3)。

**薄くする仕組み(減光・深さフェード・間引き)と、その例外は SPEC 6.10 の表にまとめている。**
薄くする仕組みや強調を足すときは、この表に行か列を足すこと(機能ごとに足してきた結果、
重要なラベルでも角度しだいで読めなくなっていたため)。強調は「足す」より「読めることを保証する」方を選ぶ。

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
[wikipedia] 初音ミク: 1902ms / リンク先381件(1回取得) / 除外: 日付等7件 / morelike一致90件 / 相互リンク170件 / 冒頭リンク15件 / 確定枠のうちmorelike圏外0件 → プール150件から24件抽選
[Graph3D] scene updated: nodes=25, links=24
[pageviews] 25件を1175msで取得
```

`[wikipedia]` の行はチューニングの判断材料になる。「上限打ち切り」が出た記事では、
候補に入らなかった冒頭リンクを1回の問い合わせで補い「冒頭リンクN件(うち候補外から追加M件)」と出る
(SPEC 3.3)。打ち切りが頻発して冒頭以外の取りこぼしも気になるなら `MAX_CONTINUE`、
「morelike一致」が10件を切る警告が頻発するなら `RELATED_LIMIT` や並べ替えの方針(SPEC 3.3)を見直す。
`[pageviews]` に「失敗N件」が出続けるなら `VIEWS_CONCURRENCY` を下げる(叩きすぎで拒否されている)。
「冒頭リンク0件(取得失敗)」が続くなら parse の失敗なので、順位は冒頭の加点なしで出ている。
重みの調整は `?debug=1` の `console.table`(プール上位20件の m・mutual・lead・score)を見て行う。

見せ方を変える改善の前後は `?debug=1` の `await window.__viz.measure()` で、rev2・rev3・rev4 を同じ条件の
画面上の数字(M1〜M10)で比べる。表示件数の違う rev5 と比べるときは `allowDifferentRanking: true` を付ける(SPEC 12.5)。値を試すときは `measure({ overrides: { rev4: {...} } })`
(開発用の道具。使い方は SPEC 12.5 の「開発用: 値を試す」)。中心同士の距離の段階は `measure({ routes: 'tiers', presets: ['rev4'] })`。
候補の比較は `variants`、Wikipedia の変化に左右されない比較は保存した展開結果(`data`)で行う(SPEC 12.5)。基準値は `docs/tasks/06-report-baseline.md`、項目と決まりは SPEC 12.5。
`[measure] …閲覧数を取れなかった記事が…` の警告が出た回は、数字が再現しないことがあるので測り直す。

輪を閉じたときの演出(SPEC 6.11)は、`?debug=1` の `window.__viz.egg(n)`(n = 3〜9。6 以上はカメラワーク)で輪がなくても試せる。
実際に輪を閉じると Console に `[egg] 輪を閉じた: 長さ N / 顔ぶれ` が出る(試用でどのくらいの長さの輪ができているかを知るため)。

## 説明のしかた

エラーメッセージの意味や、なぜその修正が必要かを一言添えて説明すること。
ターミナルのコマンドは、丸ごとコピーできる形で示す。
