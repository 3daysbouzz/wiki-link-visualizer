# Wikipedia API 利用状況の調査報告

- 調査日: 2026-09-29
- 対象: `wiki-link-visualizer-public`(コミット e04aac2 時点の作業ツリー)
- 方法: コードを読んだだけ。実際の通信は計測していない。コードは変更していない
- 対象外: 同じ階層にある別コピー `wiki-link-visualizer/`・`wlv-weight-study/`(こちらも `src/api/wikipedia.js` を持つが、今回は読んでいない)

---

## 1. Wikipedia API を呼んでいる箇所

通信は2つのファイルにまとまっている。`fetch` を直接呼ぶのは `fetchWithTimeout`([wikipedia.js:94](../src/api/wikipedia.js:94))だけで、ほかのファイルはすべてこの2ファイルの関数を経由する。

### 1-1. MediaWiki Action API(`https://ja.wikipedia.org/w/api.php`)

どの呼び出しにも共通で `format=json`・`formatversion=2`・`origin=*` が付く(`apiGet`、[wikipedia.js:126](../src/api/wikipedia.js:126))。opensearch だけは `apiGet` を通らず、`formatversion` なしで組み立てている。

| # | 関数(ファイル:行) | 用途 | 主なパラメータ |
|---|---|---|---|
| A1 | `fetchCenterArticle`([wikipedia.js:176](../src/api/wikipedia.js:176)) | 記事名の正規化・リダイレクト解決・存在確認 | `action=query` `titles=<記事名>` `redirects=1` |
| A2 | `fetchLinks`([wikipedia.js:221](../src/api/wikipedia.js:221)) | リンク先の列挙と相互リンクの判定 | `action=query` `titles=<記事名>` `generator=links` `gplnamespace=0` `gpllimit=max`(500件) `prop=info\|links` `pltitles=<記事名>` `pllimit=max` `redirects=1` と continue の値 |
| A3 | `fetchLeadLinks`([wikipedia.js:288](../src/api/wikipedia.js:288)) | 冒頭節のリンク先 | `action=parse` `page=<記事名>` `prop=links` `section=0` `redirects=1` |
| A4 | `fetchLeadExtras`([wikipedia.js:325](../src/api/wikipedia.js:325)) | 打ち切りで漏れた冒頭リンクを補う | `action=query` `titles=<最大50件を\|区切り>` `redirects=1` `prop=info\|links` `pltitles=<記事名>` `pllimit=max` |
| A5 | `fetchRelatedRanks`([wikipedia.js:369](../src/api/wikipedia.js:369)) | 内容の近さの順位(CirrusSearch) | `action=query` `list=search` `srsearch=morelike:<記事名>` `srnamespace=0` `srlimit=500` `srprop=`(空) |
| A6 | `fetchArticleMeta` の1本目([wikipedia.js:997](../src/api/wikipedia.js:997)) | サイドバー: 主カテゴリ・更新日 | `action=query` `titles=<記事名>` `prop=categories\|info` `clshow=!hidden` `cllimit=5` `redirects=1` |
| A7 | `fetchArticleMeta` の2本目([wikipedia.js:1014](../src/api/wikipedia.js:1014)) | サイドバー: 被リンク数(検索の件数) | `action=query` `list=search` `srsearch=linksto:"<記事名>"` `srnamespace=0` `srlimit=1` `srprop=`(空) `srinfo=totalhits` |
| A8 | `fetchSuggestions`([wikipedia.js:1049](../src/api/wikipedia.js:1049)) | 検索欄の候補 | `action=opensearch` `search=<入力>` `limit=8` `namespace=0` `format=json` `origin=*` |

### 1-2. REST API

| # | 関数(ファイル:行) | エンドポイント | パラメータ |
|---|---|---|---|
| R1 | `fetchOnePageviews`([wikipedia.js:415](../src/api/wikipedia.js:415)) | `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/ja.wikipedia/all-access/user/<記事名>/daily/<開始>/<終了>` | 期間は昨日までの3日間(`PAGEVIEW_DAYS=3`)。**1記事につき1リクエスト** |
| R2 | `fetchSummary`([summary.js:19](../src/api/summary.js:19)) | `https://ja.wikipedia.org/api/rest_v1/page/summary/<記事名>` | なし |

### 1-3. 呼び出し元

| 呼び出し元 | 呼ぶ関数 |
|---|---|
| 検索 `handleSearch`([App.jsx:307](../src/App.jsx:307)) | `fetchLinkedArticles`(A1〜A5) → 閲覧数 R1 |
| ノードクリック `handleNodeClick`([App.jsx:441](../src/App.jsx:441))、サイドバーの隣接記事リストも同じ処理 | `fetchLinkedArticles`(A1〜A5) → R1 |
| 追加表示 `handleMore`([App.jsx:382](../src/App.jsx:382)) | R1 のみ |
| 軌跡を遡る `jumpTo`([App.jsx:355](../src/App.jsx:355))・Backspace | R1(先読み)のみ |
| URL からの経路復元([App.jsx:678](../src/App.jsx:678)) | `expandRoute` → `fetchLinkedArticles` を経路の数だけ → R1 |
| サイドバー表示([App.jsx:731](../src/App.jsx:731)) | R2 + A6 + A7 |
| 検索欄([TopBar.jsx:58](../src/components/TopBar.jsx:58)) | A8 |
| `?debug=1` の `window.__viz.measure()`([measure.js:194](../src/debug/measure.js:194)) | `expandRoute`・R1(手動で呼んだときだけ) |
| `scripts/fetch-long-walks.mjs`(開発者が Node で手動実行) | `fetchLinkedArticles`(公開サイトの利用者は呼ばない) |

---

## 2. ブラウザから直接か、中継サーバー経由か

**利用者のブラウザから Wikipedia / Wikimedia へ直接**呼んでいる。

- 送り先は `ja.wikipedia.org` と `wikimedia.org` の絶対 URL で、中継先の URL はコード中に無い
- `vite.config.js` にプロキシ設定は無い
- 公開は GitHub Pages(`.github/workflows/deploy.yml`)で、静的ファイルの配信だけ。サーバー側の処理は無い
- CORS は `origin=*`(Action API)で通している([wikipedia.js:27-30](../src/api/wikipedia.js:27) のコメント)

そのため、Wikipedia 側から見ると通信元は利用者一人ひとりの IP になる。

---

## 3. 1回の操作で飛ぶリクエスト数

前提: 既定のプリセット rev5(`neighborLimit=24`、`moreBatch=8`)。件数はコードから数えたもので、実測ではない。

### 3-1. 検索して記事を初めて表示する(`assumeCanonical=false`)

```
[直列] A1 中心記事の解決 ……………………………… 1
   ↓ 完了を待つ
[並列] A2 リンク先 ……………………………… 1〜3(下記)
       A5 morelike ……………………………… 1
       A3 冒頭リンク …………………………… 1
   ↓ 全部を待つ
[条件付き・並列] A4 冒頭リンクの補完 …… 0〜2
   ↓
[並列 最大8本] R1 閲覧数(中心+表示ノード) … 最大25
   ↓ 全部終わってから
[並列 最大8本・低優先] R1 追加表示の先読み …… 最大8
```

同時に、サイドバーが現在地を表示するので **R2 + A6 + A7 = 3件**(待ち時間なし、3本並列)。

- **A2 の回数:** リンク先500件ごとに1回、`MAX_CONTINUE=3` で打ち切る(最大1500件)。プログラム上の上限は `requests < MAX_CONTINUE * 4` の12回だが、コメントによれば `plcontinue` 側の続きは実際には起きない。A2 の中の続きは**直列**
- **A4:** A2 が上限で打ち切られ(リンク先が1500件超)、かつ冒頭リンクに候補外のものがあるときだけ。50件ずつ、最大100件なので最大2件、**並列**
- **合計の目安:** Action API 4〜8件 + 閲覧数 最大33件 + サイドバー 3件 = **おおむね40件前後、最大で約44件**

### 3-2. 隣接記事へ移動する(未取得の記事。`assumeCanonical=true`)

- A1・A2・A5・A3 の**4件を同時に**投げる(A1 を待たない) → 条件付きで A4 0〜2件
- R1: 新しい中心と表示ノードのうち、閲覧数が未取得のもの(最大25件)+ 先読み最大8件
- サイドバー: 新しい現在地が未取得なら 3件
- **合計の目安:** 最大で約40件。既に閲覧数を取った記事と重なるほど減る

### 3-3. 取得済みの記事に戻る・進む・追加表示

| 操作 | Action API | 閲覧数 R1 |
|---|---|---|
| 以前に展開した記事へ再び進む([App.jsx:474](../src/App.jsx:474)) | 0(記憶した結果を使う) | 未取得分のみ |
| 軌跡を遡る・Backspace | 0 | 先読み最大8件(キャッシュ済みなら0) |
| 追加表示(中心クリック・+ MORE) | 0(候補は手元にある) | 追加分(通常は先読み済み)+ 次の先読み最大8件 |

### 3-4. その他の操作

- **ノードにカーソルを乗せる:** 300ms 止まると R2 + A6 + A7 の **3件を並列**。300ms 以内に離れれば取りに行かない([App.jsx:756](../src/App.jsx:756) の `clearTimeout`)
- **検索欄に入力する:** 入力が 200ms 止まるたびに A8 を **1件**
- **URL から経路を復元する:** 開始記事と `path` の各記事を**1記事ずつ直列に**展開する(各 4〜8件)。そのあと、表示される全ノードの閲覧数(R1)をまとめて取る

### 3-5. 並列度の制御

- 閲覧数 R1 だけはアプリ全体で1つの行列を持ち、**同時8本まで**(`VIEWS_CONCURRENCY=8`)。表示分(high)を先読み(low)より先に処理する
- **Action API・R2 には同時実行数の制御が無い。** 1操作の中での並列は最大4本程度だが、サイドバーの3本とも重なりうる

---

## 4. キャッシュ、エラー処理、リトライ

### 4-1. キャッシュ

すべて**メモリ上だけ**(`Map`)。ページを再読み込みすると消える。`localStorage` 等への保存は無い。件数・期限の上限も無い。

| キャッシュ | 場所 | キー | 失敗したとき |
|---|---|---|---|
| `linkCache`(A1〜A5 の結果) | [wikipedia.js:652](../src/api/wikipedia.js:652) | 入力した記事名と解決後の記事名の両方 | 保存しない(次に同じ記事を開くと取り直す) |
| `expansions`(展開結果) | App の ref | 記事名 | ― |
| `viewsCache`(閲覧数) | [wikipedia.js:392](../src/api/wikipedia.js:392) | 記事名 | 保存しない(次に表示するたびに取り直す) |
| `viewsPending`(取得中の閲覧数) | [wikipedia.js:437](../src/api/wikipedia.js:437) | 記事名 | 同じ記事の二重取得を防ぐ |
| `metaCache`(A6・A7) | [wikipedia.js:972](../src/api/wikipedia.js:972) と App の ref の2か所 | 記事名 | 失敗した項目は null のまま**保存する**(取り直さない) |
| `previewCache`(R2) | App の ref([App.jsx:163](../src/App.jsx:163)) | 記事名 | null を**保存する**(取り直さない) |
| 検索候補(A8) | なし | ― | 同じ文字列を打ち直すと再取得する |

同じ記事の再取得について:

- 展開(A1〜A5)は、成功していれば同じタブの中で再取得しない
- 「検索」で最初からやり直すと App 側の `viewsOf` は空になるが、モジュール側の `viewsCache` と `linkCache` は残るので、閲覧数と展開結果は再取得しない
- **`fetchLinkedArticles` は同じ記事の取得中の呼び出しをまとめない。** 画面側は `loading` 中の操作を弾いているので、通常の操作では重ならないはず(4-3 を参照)

### 4-2. エラー処理

- 全リクエストに **15秒のタイムアウト**(`FETCH_TIMEOUT_MS`、AbortController)
- A1〜A5 は HTTP エラー・JSON でない応答・API の `error` を例外にし、429・5xx・403 は状況別の日本語メッセージにする(`describeHttpError`)
- 補助情報(A3 冒頭リンク・A4 補完)は失敗しても加点なしで続ける(`optional`)
- R1・R2・A6・A7・A8 は失敗を握りつぶして「情報なし」として続ける
- 閲覧数の 404 は 0 件として扱う

### 4-3. リトライ

- **アプリにはリトライ処理が無い**(自動再試行もバックオフも無い)
- 429 のときは「しばらく待ってから再試行してください」と表示するだけ。利用者がすぐ同じノードを押し直すと、待たずにそのまま再送される
- 閲覧数は失敗をキャッシュしないので、次に同じノードが表示されたときに実質的に再送される(間隔の制御は無い)
- `Retry-After` ヘッダは読んでいない
- リトライとバックオフ(20秒→60秒→120秒、1記事ごとに3秒の間隔)があるのは `scripts/fetch-long-walks.mjs` だけ(開発者用)

---

## 5. リクエストヘッダ

- **アプリ(ブラウザ)は独自ヘッダを付けていない。** `Api-User-Agent` も無い。`fetch(url, { signal })` だけで、ヘッダ指定は無い([wikipedia.js:98](../src/api/wikipedia.js:98))
- 意図的にそうしている。[wikipedia.js:55-58](../src/api/wikipedia.js:55) と SPEC.md 269行目に「独自ヘッダを付けるとプリフライトが起き、REST API が CORS ヘッダを返さず失敗する」とある
  - この主張が今も正しいか、**REST API(R1・R2)と Action API(A1〜A8)のどちらにも当てはまるのか**は、コードからは**不明**(今回は検証していない)。コメントの根拠は REST API 側の話として書かれている
- ブラウザが自動で付ける `User-Agent`・`Referer`(GitHub Pages の URL)はそのまま送られる(ブラウザの標準動作。コード上の指定は無い)
- `scripts/fetch-long-walks.mjs` だけは Node から `User-Agent: wiki-link-visualizer-dev/0.1 (...; https://github.com/...)` を付けている
- `maxlag` パラメータは使っていない

---

## 6. リクエストが際限なく増える経路

### 6-1. URL の `path` の長さに上限が無い(最も大きい)

`?start=...&path=a,b,c,...` の `path` は件数の上限なしで読み込まれ([urlState.js:55](../src/config/urlState.js:55))、ページを開いただけで**自動的に**全記事を展開する([App.jsx:688](../src/App.jsx:688))。

- 1記事あたり Action API 4〜8件。直列なので1本ずつだが、止める手段は無い(ページを閉じる以外)
- 展開後、表示される全ノードの閲覧数を R1 で取る。経路が100記事なら、ノード数は最大で数千になりうる(同時8本で次々に送る)
- さらに URL で `neighborLimit` を最大150まで上げられる([presets.ts:402](../src/config/presets.ts:402))ので、1記事あたりのノード数、つまり閲覧数リクエストが約6倍になる
- 長い URL を SNS 等で共有されると、**開いた人全員**のブラウザがこれを実行する

### 6-2. URL で件数の設定を上げられる

`neighborLimit`(最大150)・`moreBatch`(最大40)・`moreMax`(最大150)は URL から誰でも上書きできる(`?debug=1` は不要)。範囲は制限されているが、既定(24・8・40)の数倍になる。閲覧数 R1 と先読みの件数がそのまま増える。

### 6-3. 歩き続ける・押し直す

- 新しい記事へ進むたびに 4〜8件 + 閲覧数 最大33件。回数やセッション全体の総量の上限は無い
- ただし連打は抑えられている。`loading` 中と、移動の演出中(`TRAVEL_MS=700ms`)はクリックを受け付けない。検索欄も `loading` 中は確定しない。**展開の同時実行は1本に抑えられている**と読める
  - 同じ描画の中で2回クリックが届いた場合に `loading` の判定をすり抜けるかどうかは、React の再描画のタイミングに依存するので**不明**(実際に確かめていない)
- 429 やエラーのあと、押し直せば待たずに再送される(4-3)

### 6-4. カーソルを次々に乗せる

ノードごとに 300ms 止まれば3件ずつ飛ぶ。成功・失敗とも保存されるので、同じノードでは1回だけ。ノード数(数十〜数百)× 3件が上限。取得中に別のノードへ移っても、送信済みのリクエストは中断しない。

### 6-5. 追加表示の連打

追加表示そのものは Wikipedia に問い合わせない。先読み(1回最大8件)は `moreMax` で頭打ちになるので、際限なくは増えない。

### 6-6. 検索欄

200ms の debounce のみ。ゆっくり打つと1文字ごとに1件。古いリクエストは中断せず、結果を捨てるだけ。キャッシュも無い。

---

## 改善案(リスクの高い順。実装はしていない)

1. **URL 復元の件数に上限を付ける**(6-1)
   `path` を例えば20記事程度で切り、超えた分は読まないか確認を出す。あわせて、復元時の閲覧数取得は最後の数記事分だけにするか、遅らせる。共有リンク1本で、開いた人全員に大量のリクエストを送らせる経路を塞ぐため。

2. **429・5xx のときに待つしくみを入れる**(4-3・6-3)
   429 を受けたら、アプリ全体で一定時間(`Retry-After` があればそれに従う)新しいリクエストを止める。押し直しでもすぐには再送しない。閲覧数の失敗には「一定時間は取り直さない」という印を付ける。

3. **`Api-User-Agent` を付けられるか検証する**(5)
   Wikimedia は、ブラウザからの呼び出しでも連絡先入りの識別子を求めている(User-Agent ポリシー)。問題が起きたときに運営者へ連絡してもらう手段にもなる。プリフライトの問題が本当に REST API だけのものなら、少なくとも Action API(api.php)には付けられる可能性がある。URL パラメータやページ内の説明など、ヘッダ以外で身元を示す方法も含めて確認する。**今回は未検証**。

4. **URL から上書きできる件数の上限を下げる**(6-2)
   `neighborLimit` などの URL 上書きは `?debug=1` のときだけ効くようにするか、公開版の上限を既定値の近くまで下げる。

5. **Action API 全体に同時実行数の上限を付ける**(3-5)
   閲覧数と同じように、アプリ全体の行列(例: 同時2〜4本)にまとめる。サイドバーのホバー3件と展開4件が重なって最大7本以上になる状態を防ぐ。

6. **重いクエリを減らす**
   - A5 の `morelike`(`srlimit=500`)と A7 の `linksto:` はどちらも検索エンジンを使う。A7 はホバーのたびに飛ぶので、被リンク数を表示するのは現在地だけにする、などを検討する
   - 閲覧数 R1 は1記事1リクエストで、件数がいちばん多い。表示ノード全件ではなく、画面に出ている分だけにするなど件数を減らす

7. **キャッシュを再読み込み後も残す**(4-1)
   展開結果・閲覧数・要約を `sessionStorage` 等に期限付きで保存し、再読み込みや同じ URL の開き直しで取り直さないようにする。あわせて、メモリ上のキャッシュに件数の上限を付ける。

8. **検索候補の小さな改善**(6-6)
   候補の結果を短期間キャッシュする。古いリクエストを AbortController で中断する。

9. **`fetchLinkedArticles` で取得中の呼び出しをまとめる**(4-1・6-3)
   同じ記事の取得が進行中なら、その Promise を使い回す。画面側の `loading` による防止に頼らないため。

---

## 不明な点(コードからは判断できなかったこと)

- 独自ヘッダ(`Api-User-Agent`)を付けたときにプリフライトが本当に失敗するのか、それは R1・R2・Action API のどれで起きるのか
- 実際の通信件数と所要時間(今回は計測していない。上記の件数はコードから数えたもの)
- Wikimedia 側の各 API のレート制限の具体的な値
- 同じ描画の中で2回クリックが届いたときに、`loading` の判定をすり抜けるかどうか
- 公開後に想定している利用者数・アクセス量
