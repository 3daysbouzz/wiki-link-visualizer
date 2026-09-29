# 英語版 Wikipedia への対応可否の調査報告

調査日: 2026-09-29 / 対象: `wiki-link-visualizer-public`(コミット `e04aac2` 時点)
**この調査ではコードを変更していない。** 追加したのはこのファイルだけ。

## 結論(先に)

**作り直しは不要。改修で足りる。**
言語に依存する処理は `src/api/` の2ファイルと UI の文言にまとまっていて、
グラフの組み立て・力学・ラベル・輪の演出などの中核は記事名を「ただの文字列」として扱っている。
使っている MediaWiki API の機能(`generator=links`・`morelike:`・`linksto:`・`opensearch`・REST の summary と pageviews)は
英語版でもそのまま動くことを実際に問い合わせて確かめた(下の「確認したこと」)。

ただし、関連記事の選び方の調整値(重み・件数・上限)は日本語版だけで測って決めたものなので、
英語版で同じ「散歩の質」になるかは**不明**。ここが作業量の読めない部分になる。

---

## 確認したこと(API を実際に問い合わせた結果)

コードは変えず、ターミナルから API を数回だけ呼んで確かめた。

| 項目 | 結果 |
|---|---|
| `morelike:Coffee`(en) | 動く。Coffee roasting / Coffee substitute / Caffeinated drink / White coffee / Espresso の順で返る |
| カテゴリ名の接頭辞 | en: `Category:` / ja: `Category:` / **de: `Kategorie:`**(言語によって違う) |
| REST summary(en)に `encodeURIComponent('Washington, D.C.')` | HTTP 200。空白を `%20` にした今の書き方で取れる |
| pageviews(`per-article/en.wikipedia/...`) | HTTP 200 |
| `generator=links` に `prop=pageprops&ppprop=disambiguation` を相乗り | 動く。曖昧さ回避ページが印付きで返る(提案 6-2 の根拠) |

リンク先の件数(`generator=links`、名前空間0。`MAX_CONTINUE = 3` は 1500 件までを取る設定):

| ja | 件数 | en | 件数 |
|---|---|---|---|
| 初音ミク | 383 | Hatsune Miku | 317 |
| コーヒー | 717 | Coffee | 509 |
| 富士山 | 983 | Mount Fuji | 632 |
| 流体力学 | 241 | Fluid dynamics | 638 |

4記事ずつの小さな標本なので、英語版の記事全般で打ち切り(1500件超)がどのくらい起きるかは**不明**。
なお ja で5件目以降を問い合わせた時点で HTTP 429 で断られた(ブラウザからの利用とは条件が違うので参考まで)。

---

## 1. 接続先ドメインがハードコードされている箇所

| ファイル:行 | 内容 |
|---|---|
| `src/api/wikipedia.js:51` | `API_ENDPOINT = 'https://ja.wikipedia.org/w/api.php'`(action API。リンク・morelike・メタ情報・検索候補がすべてこれを通る) |
| `src/api/wikipedia.js:52-53` | `PAGEVIEWS_ENDPOINT = '.../per-article/ja.wikipedia/all-access/user'`(閲覧数。ドメインではなくパスの中に `ja.wikipedia` がある) |
| `src/api/summary.js:13` | `SUMMARY_ENDPOINT = 'https://ja.wikipedia.org/api/rest_v1/page/summary/'`(サイドバーの概要) |
| `index.html:2` | `<html lang="ja">`(接続先ではないが、言語の固定) |
| `src/api/wikipedia.js:2` | コメント「MediaWiki API (ja.wikipedia.org) クライアント」(動作には無関係) |

関連して、テストにも1箇所ある。

| ファイル:行 | 内容 |
|---|---|
| `tests/wikipedia.test.js:645` | 偽の fetch が URL を `'/per-article/ja.wikipedia/all-access/user/'` で分解している。接続先を変えるとこのテストも直す必要がある |

**接続先は上の3定数だけ。** 「Wikipedia で読む」のリンクは REST summary が返す `content_urls` をそのまま使っており(`summary.js:29-33`)、
記事 URL を組み立てている箇所は無い。`scripts/fetch-long-walks.mjs` も `wikipedia.js` を import しているだけで、独自の接続先は持たない。

## 2. リンク解析・記事タイトル処理の日本語版前提

### 日本語版前提になっている箇所

| ファイル:行 | 内容 | 英語版での影響 |
|---|---|---|
| `src/api/wikipedia.js:65-70` | 日付・年の除外の正規表現 `/^\d{1,4}年$/` `/^\d{1,2}月\d{1,2}日$/` `/^\d{1,2}月$/` `/^\d{1,4}年代$/` | 英語版では1つも当たらない。`2007` `August 31` `December` `1990s` のような記事が候補に残り、ノイズになる |
| `src/api/wikipedia.js:78` | `title.includes('一覧')` で一覧記事を除外 | 当たらない。`List of ...` が残る |
| `src/api/wikipedia.js:79` | `title.endsWith('(曖昧さ回避)')` で曖昧さ回避を除外 | 当たらない。`... (disambiguation)` が残る |
| `src/api/wikipedia.js:1009` | カテゴリ名から `/^Category:/` を取り除く | en・ja は `Category:` なので動く。**de(`Kategorie:`)など他言語では接頭辞が残る** |
| `src/constants.js:174` | ラベルを `LABEL_MAX_CHARS = 16` 文字で切る | 等幅フォントでは和文1文字が欧文約2文字分の幅なので、英語だと画面上の半分の長さで切れる(`Neon Genesis Evangelion` は23文字)。壊れはしないが見え方が変わる |
| `src/utils/labelSelect.js:35` | ラベルの書体の代替に `"Hiragino Sans", "Yu Gothic"` | 英語は JetBrains Mono で描けるので問題なし。他の文字体系(ハングル・アラビア文字など)では **不明** |

### 言語に依存しない(そのまま使える)ことを確かめた箇所

- **名前空間**: 数値の `0` で指定している(`gplnamespace: '0'` 237行、`l.ns === 0` 299行、`page.ns !== 0` 346行、`srnamespace: '0'` 374・1018行、`namespace: '0'` 1056行)。名前空間名の文字列には頼っていない
- **リダイレクト**: API の `redirects: '1'` と応答の `query.redirects`(from→to)で解決している(254-256・780行)。言語固有の処理は無い
- **URL エンコード**: action API は `URLSearchParams`、summary は `encodeURIComponent`、pageviews は空白を `_` にしてから `encodeURIComponent`(417行)。英語の空白・カンマ入りの記事名で summary が取れることを確かめた
- **並び順**: `rankCandidates` の同点処理はコードポイント順で、`localeCompare` を使っていない(554行)。言語に関係なく決定論的
- **共通ワード・輪の判定**(`src/utils/relation.js`): 記事名の一致だけを見ており、文字の種類に依存しない
- **種付き乱数**(`src/utils/prng.js`): 記事名の文字列から種を作るだけ

### 英語版で表に出やすくなる既存の弱点

- **経路の URL の区切りがカンマ**(`src/config/urlState.js:55-58` の読み取り、`:81` の書き出し)。
  `?path=A,B` を `split(',')` で分けるので、`Washington, D.C.` や `Paris, Texas` のようなカンマ入りの記事名を通った経路は、
  共有 URL から復元すると別の記事名に割れる。日本語の記事名は読点が全角(、)のことが多いので目立たなかったが、半角カンマ入りの記事名は日本語版にもあり、今も起こりうる
- **打ち切りの偏り**: `wikipedia.js:310-312` のコメントのとおり、`generator=links` はコードポイント順に返すため、打ち切ると後ろの文字が抜ける。
  日本語版では「漢字で始まる記事がまとめて抜ける」、英語版では「アルファベット後半で始まる記事が抜ける」形になる。冒頭リンクで補う仕組み(タスク04)は言語に依存しないのでそのまま効く

## 3. 画面上の日本語文言の数と場所

コメント・`console` の出力・開発用の道具を除き、**利用者の画面に出る日本語は 7ファイル・49箇所**(同じ文言を `aria-label` と `title` の両方に書いているものを1つと数えると 41種類)。

| ファイル | 箇所 | 行 |
|---|---|---|
| `src/components/Sidebar.jsx` | 15 | 53, 65, 71, 72, 92, 96, 100, 107, 109, 110, 123, 130, 141, 142, 174 |
| `src/api/wikipedia.js`(エラー文言。`App` が画面に出す) | 11 | 115, 118, 121, 123, 140, 144, 158, 162, 185, 191, 729 |
| `src/App.jsx` | 8 | 78, 186, 392, 693, 845, 892, 931, 932 |
| `src/components/Breadcrumb.jsx` | 5 | 22, 26, 27, 33, 36 |
| `src/components/TopBar.jsx` | 5 | 143, 144, 164, 200, 201 |
| `src/components/ZoomControls.jsx` | 4 | 14, 15, 24, 25 |
| `src/components/Graph3D.jsx` | 1 | 313(WebGL 初期化失敗) |

このほか、**すでに英語の UI 文言**が約12箇所ある(`NODES` `EDGES` `DEPTH` `FETCHING` `ERROR` `WARN` `SELECTED NODE` `HOVER NODE` `+ MORE` `REST` `LOOP CLOSED // N NODES` `WIKIPEDIA で読む →` の英語部分)。
日英混在の文言(`WARN ノードが…` `WIKIPEDIA で読む →`)は、切り出すときに1本の文言として扱う必要がある。

### 対象外にしてよいもの(開発者向け)

| 種類 | 場所 | 量 |
|---|---|---|
| `console.info/warn` の文言 | `wikipedia.js`・`App.jsx`・`urlState.js` | 約20行 |
| デバッグパネル(`?debug=1` のときだけ出る)の説明 | `src/components/DebugPanel.jsx` 61-183行 | 約39箇所 |
| 測定の道具(`window.__viz.measure`)の表・エラー | `src/debug/measure.js`・`src/utils/screenMetrics.js:25`・`src/constants.js:629-630` | 約60箇所 |
| 測定用の経路(日本語の記事名そのもの) | `src/debug/benchRoutes.js`・`scripts/fetch-long-walks.mjs:22` | 約30箇所 |

これらは利用者に見えないので、多言語化の対象から外すことを勧める(CLAUDE.md の「コメントは日本語」とも揃う)。

### 切り出しに必要な作業量

- 文言は 49箇所と少なく、i18n ライブラリを入れる規模ではない。CLAUDE.md の「依存を増やさない」方針もあるので、
  **自前の小さな辞書(`{ ja: {...}, en: {...} }` と `t(key, params)`)で足りる**
- 手間がかかるのは `wikipedia.js` のエラー文言。今は API 層が日本語の文を `Error` に入れて投げ、`App` がそのまま画面に出している。
  言語を切り替えるには「API 層はエラーの種類(コード)とパラメータを投げ、UI 層で文にする」形に変える必要がある。
  `tests/wikipedia.test.js`(78, 79, 89, 99, 104, 111, 119, 124, 130-133行)が日本語の文言で照合しているので、テストも合わせて直す
- 数の書式は `toLocaleString('en-US')` に固定済み(`Sidebar.jsx:38`・`TopBar.jsx:28`)、日付は `YYYY-MM-DD`(`wikipedia.js:977`)なので、書式の多言語化は不要

## 4. 言語を切り替える方式の案と改修範囲

ここでの「言語」は **Wikipedia の言語(接続先)** と **画面の文言の言語** の2つがある。
両方を同じ値で切り替えるか、別々にするかは利用者の判断が要る(下の「不明な点・判断が要る点」)。以下は同じ値で切り替える前提。

### 案A: URL パラメータ(`?lang=en`)

- 既存の `?preset=` `?start=` `?path=` と同じしくみに乗る(`src/config/urlState.js`)。共有した URL を開くと同じ言語・同じ経路で復元できる
- 改修範囲
  - `urlState.js`: `lang` の読み書き(不明な値は `ja` に戻す)
  - `wikipedia.js`・`summary.js`: 3つの接続先を言語から組み立てる
  - `App.jsx`: 言語を API に渡す。言語ごとにキャッシュを分ける(`wikipedia.js` の `linkCache`・`viewsCache`・`metaCache` はモジュール単位で記事名だけをキーにしており、`Tokyo` のように両方の版に同じ名前がある記事で取り違える)
  - `index.html` の `lang` 属性を実行時に書き換える
- 規模: 小〜中。切替 UI を作らないので画面の配置には触れない

### 案B: 画面上の切替 UI(TopBar に `JA / EN`)

- 案A を土台に、ボタンで `?lang=` を書き換える形にするのが素直
- 改修範囲(案A に加えて)
  - `TopBar.jsx`・`App.css`: 切替ボタン。スマホ横画面(`short-landscape`)の TopBar は検索欄と統計値で詰まっているので、置き場所の検討が要る
  - 切り替えたときの扱い: 記事名は言語をまたいで対応しない(`コーヒー` と `Coffee` は別の記事名)ので、**経路をリセットして空の状態に戻す**のが最も単純。
    今の記事の対応する記事へ移る(言語間リンク `prop=langlinks`)ことも API 上は可能だが、経路全体は移せないので中心1件だけになる
- 規模: 中

### 案C: 言語ごとに別のビルド・別の URL(`/wiki-link-visualizer/en/`)

- Vite の環境変数(`VITE_WIKI_LANG`)で接続先と文言を切り替え、2回ビルドして GitHub Pages に並べる
- コードの改修は最小だが、`vite.config.js` の `base`(固定の `/wiki-link-visualizer/`)と `.github` のデプロイ手順を言語ごとに増やす必要がある。実行中の切り替えはできない
- 規模: 小〜中(デプロイ周りの作業が中心)

### 補足: ブラウザの言語による初期値

`navigator.language` が `ja` 以外なら `en` で開く、を案A・B に足せる。ただし `?lang=` の無い既存の共有 URL の意味が変わる(日本語の記事名を英語版で探して「見つかりません」になる)ので、
**`?start=` が付いている URL では使わない**などの条件が要る。

### 推奨

**案A → 案B の順。** 案A だけで英語版の動作確認と調整値の検証(タスク12)ができ、URL で共有もできる。切替 UI はその後で足せば、案A の作業はそのまま生きる。

## 5. 作り直しが必要か、改修で足りるか

**改修で足りる。** 根拠:

1. **接続先は3つの定数だけ**(1章)。しかも API の呼び出し方そのものは言語に依存しない
2. **使っている API の機能はすべて英語版で動く**ことを確かめた(冒頭の「確認したこと」)。`morelike:`・`linksto:` は検索エンジン(CirrusSearch)の機能で、日本語版だけの仕組みではない
3. **中核の処理は記事名を不透明な文字列として扱っている**(2章)。`buildGraph`・`relation.js`・`forceLayout.js`・`labelSelect.js`・`Graph3D.jsx` の力学とラベルの配置は、文字の種類を見ていない。ラベルの幅も `measureText` で実測している(`labelSelect.js:47`)
4. **日本語固有の処理は `isExcludedTitle` の6行とカテゴリ名の接頭辞1行に局在している**(`wikipedia.js:65-82, 1009`)
5. **UI 文言は 49箇所**で、辞書に切り出せる量(3章)

一方で、次の2点は改修の「量」ではなく「結果」が読めない。

- **関連記事の選び方の調整値は日本語版で決めたもの**。重み(`wMorelike` `wMutual` `wLead`)・`RELATED_LIMIT = 500`・`POOL_SIZE = 150`・`MAX_CONTINUE = 3`、表示件数(`rev5` の24件)は、日本語の記事で測った結果(`docs/tasks/06-report-baseline.md` ほか)で決めている。
  英語版の記事でも同じ手応えになるかは**不明**。4記事の標本ではリンク数は同じ桁だった
- **測定の道具と回帰テストの基準値が日本語の経路だけ**(`src/debug/benchRoutes.js`・`tests/fixtures/*.json`)。英語版の見え方を数字で比べるには、英語の経路を足して測り直す必要がある

## 6. 他言語にも拡張しやすくするための提案

### 6-1. 言語ごとの差分を1か所の「サイト定義」に集める

`src/config/sites.js`(仮)に、言語コードから決まる値をまとめる。

```js
// 例(案)。値は言語コードから組み立てられるものが多い
{
  lang: 'en',
  api: 'https://en.wikipedia.org/w/api.php',
  rest: 'https://en.wikipedia.org/api/rest_v1',
  pageviewsProject: 'en.wikipedia',
  exclude: { titlePatterns: [/^\d{1,4}$/, /^\d{1,4}s$/, /^(January|...) \d{1,2}$/], listPrefix: 'List of' },
  labelMaxChars: 24,  // 欧文は和文の約2倍の文字数が同じ幅
  dir: 'ltr',
}
```

接続先は `https://${lang}.wikipedia.org` の形で組み立てられるので、新しい言語を足すときに書くのは除外の規則と数値の差分だけになる。

### 6-2. 言語に依存しない手がかりを優先する

- **曖昧さ回避は `pageprops` の `disambiguation` で判定する。** `generator=links` の同じリクエストに `prop=...|pageprops&ppprop=disambiguation` を足すだけで取れる(確認済み)。
  追加のリクエストが要らず、どの言語でも同じコードで済む。`(曖昧さ回避)` の文字列判定はいらなくなる
- **カテゴリ名の接頭辞は名前空間番号(14)で判断して、最初の `:` までを落とす。** `Category:` の文字列に頼らないので `Kategorie:` にも対応する
- **日付・年・一覧は言語共通の手がかりが API に無い**ので、サイト定義に言語ごとの規則を持つ(6-1)。Wikidata の「分類」で判定する方法もあるが、リクエストが増えるので勧めない

### 6-3. API クライアントを言語ごとの実体にする

`wikipedia.js` のキャッシュ(`linkCache`・`viewsCache`・`metaCache`)と閲覧数の行列はモジュール単位で1つしかない。
`createWikiClient(site)` のように言語ごとに実体を作れば、キャッシュの取り違えが構造的に起きなくなる。
キーに `${lang}:` を付けるだけでも済むが、閲覧数の行列(`viewsQueues`)まで考えると実体を分ける方が単純。

### 6-4. エラーは「コード + パラメータ」で投げ、文にするのは UI 層

`throw new Error('記事が見つかりませんでした: …')` を `throw new WikiError('notFound', { title })` のようにし、
`App` が辞書で文にする。テストはコードで照合する(文言を変えてもテストが壊れない)。

### 6-5. 経路の URL の区切りを `|` にする

`|` は MediaWiki の記事名に使えない文字なので、区切りに使っても記事名と衝突しない。
既存の共有 URL のために、`|` を含まない `path` は従来どおりカンマで分ける、という読み方にすれば後方互換を保てる。

### 6-6. 文字の向き・書体

アラビア語・ヘブライ語など右から左に書く言語まで見るなら、`<html dir>` とラベルの Canvas 描画(`labelSelect.js`)の対応が要る。
英語だけなら不要。書体の代替(`labelSelect.js:35`・`App.css:18-19`)に言語別の書体を足すかは、対象言語を決めてから判断する。

### 6-7. 測定の経路を言語ごとに持つ

`benchRoutes.js` の経路に `lang` を持たせ、`measure()` が言語ごとに測れるようにする。
調整値をサイト定義で言語ごとに上書きできるようにしておけば、英語版だけ値を変える判断もできる。

---

## 改修タスク一覧(見積もり)

見積もりの基準: **小** = 1〜2ファイル・数十行程度で、判断を伴わない。**中** = 複数ファイルにまたがり、テストの追加・書き換えを伴う。**大** = 実測と判断を伴い、作業量が結果しだいで変わる。

| No | タスク | 主なファイル | 規模 |
|---|---|---|---|
| 1 | 接続先3つを言語コードから組み立てる(サイト定義の導入。6-1) | `wikipedia.js`・`summary.js`・新規 `config/sites.js` | 小 |
| 2 | `?lang=` の読み書きと、不明な値の既定(ja)への戻し | `urlState.js`・`tests/urlState.test.js` | 小 |
| 3 | キャッシュと閲覧数の行列を言語ごとに分ける(6-3) | `wikipedia.js`・`App.jsx`(`previewCache`・`metaCache`) | 中 |
| 4 | 曖昧さ回避を `pageprops` で判定する(6-2) | `wikipedia.js`・`tests/wikipedia.test.js` | 小 |
| 5 | 日付・年・一覧の除外規則を言語別にし、英語の規則を書く | `wikipedia.js`・`config/sites.js`・テスト | 小 |
| 6 | カテゴリ名の接頭辞を名前空間で落とす(6-2) | `wikipedia.js:1009` | 小 |
| 7 | 経路の URL の区切りを `|` にする(後方互換つき。6-5) | `urlState.js`・テスト | 小 |
| 8 | UI 文言の辞書化(`t()` の自前実装、49箇所の置き換え、英語訳) | 7ファイル + 新規 `i18n/` | 中 |
| 9 | API のエラーをコード化し、UI 層で文にする(6-4) | `wikipedia.js`・`App.jsx`・`tests/wikipedia.test.js` | 中 |
| 10 | `<html lang>` を実行時に切り替える | `main.jsx` か `App.jsx` | 小 |
| 11 | ラベルの文字数上限を言語別にする(または画面上の幅で切る) | `constants.js`・`labelSelect.js`・`config/sites.js` | 小 |
| 12 | 英語版での調整値の検証(英語の測定経路を足し、`measure()` で日本語版の基準値と比べ、必要なら英語版だけ値を変える) | `benchRoutes.js`・`presets.ts`・`docs/tasks/` の報告 | 大 |
| 13 | 画面上の切替 UI(`JA / EN`)と、切り替え時の経路のリセット(案B) | `TopBar.jsx`・`App.jsx`・`App.css` | 中 |
| 14 | SPEC.md・README.md・CLAUDE.md の更新(3章・12章の URL クエリ・6章の文言) | ドキュメント | 中 |
| 15 | (任意)開発者向けの `console` 出力・デバッグパネル・測定の道具の英語化 | `wikipedia.js`・`DebugPanel.jsx`・`measure.js` | 中(対象外を推奨) |

**英語版を URL で開いて使えるところまで**(案A): 1〜7・9〜11 と 14 の一部。
**切替 UI まで**(案B): これに 8・13 を足す。
**散歩の質を日本語版と揃える**: 12。ここだけは作業量が結果しだい。

---

## 不明な点・判断が要る点

- **英語版での関連記事の選び方の手応え**: 調整値が英語版でも妥当かは不明(タスク12で測るまで分からない)
- **英語版の記事で打ち切り(1500件超)がどのくらい起きるか**: 4記事の標本では起きなかったが、一般的な頻度は不明
- **英語の記事名での morelike の順位の質**: 1記事(Coffee)で上位5件がもっともらしいことだけ確認した。全般的な質は不明
- **英語版での `linksto:` による被リンク数・`opensearch` の候補**: 呼び方は日本語版と同じだが、英語版で実際に呼んでは確かめていない。動かない理由は見当たらないが、確認はしていない
- **ハングル・アラビア文字など他の文字体系でのラベルの描画**: 未確認
- **画面の文言の言語と Wikipedia の言語を同じにするか別にするか**: 利用者の判断が要る(例: 日本語の画面で英語版を歩く、を許すか)
- **言語を切り替えたときに経路をどうするか**(リセットか、言語間リンクで中心だけ移すか): 利用者の判断が要る
- **公開サイト(GitHub Pages)の URL を言語で分けるか**(案C): 利用者の判断が要る
