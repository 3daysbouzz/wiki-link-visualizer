# タスク: 同時リクエスト制御のレビュー指摘の修正

作成日: 2026-09-29 / 対象ブランチ: `feature/concurrency-limit`(コミット `90b6ca7` の続き)
前提: `docs/task-concurrency-limit.md` の実装に対するレビュー。差分を読んだ結果、ブロッカー(マージを止める欠陥)は無かった。
以下の修正3点と確認3点を行い、`main` へのマージ前に反映する。`main` へのマージ・push はこのタスクに含めない。

## 修正1(必須): 表示中の閲覧数をサイドバーより後にする

### 原因
`fetchPageviews` の既定優先度が `'mid'` で、サイドバー(R2・A6・A7)と同じ段になっている。
同じ段は先入れ順なので、先に入った閲覧数(最大25件)の後ろにサイドバーが並び、
検索直後にサイドバーが出るまでが +0.5〜1.0秒 から +1.5〜2.4秒 に遅くなった。
CLAUDE.md の「クリック前にその記事が何かを判断できることが体験の質を決める」に照らすと、
サイドバーを球の大きさより先にするのが筋。

### 変更
- `src/api/requestQueue.js`: `PRIORITIES` を4段階にする。
  `['high', 'mid', 'views', 'low']`(展開・検索候補 / サイドバー / 表示中の閲覧数 / 追加表示の先読み)
  - `waiting` の行列も4本にする。先頭コメントの優先度の説明も更新する。
- `src/api/wikipedia.js`:
  - `fetchPageviews` の既定優先度を `'views'` にする。引数の型は `'views' | 'low'`。
  - 関連コメント(「表示中のノードは既定の 'mid'(サイドバーと同じ段)」など)を実態に合わせる。
  - `enqueueViews` の優先度の引き上げは `PRIORITIES.indexOf` の比較なので、そのまま動くはず。確認だけする。
- 追加表示の先読み(`'low'`)の挙動は変えない。表示中の取得(`views`)が残っている間は始めない、を保つ。
- `docs/SPEC.md` 3.6e と CLAUDE.md にある優先度の説明を更新する。

### テスト
- `views` の待機が積まれている状態で `mid`(サイドバー)を入れると、サイドバーが先に実行される。
- `low` は `views` が残っている間は始まらない。
- 待機中の `low` を `views` に引き上げる動作(`setPriority`)が、新しい段でも動く。

## 修正2(必須): 上限の上書きを本番ビルドで効かせない

### 原因
`?debug=1&maxConcurrent=N` は、`?debug=1` を付ければ誰でも使える。
共有URLに `maxConcurrent=16` を入れておくと、開いた人のブラウザが最大16本で送る。
1〜16の範囲制限だけでは、Wikimedia の推奨(同時3以下)を超えられてしまう。

### 変更
`src/App.jsx`(`setMaxConcurrentRequests` を呼ぶ箇所)を、本番ビルドでは `MAX_CONCURRENT_REQUESTS` を上限にする形にする。

```js
const n = initialUrlState.maxConcurrent
if (n) {
  setMaxConcurrentRequests(
    import.meta.env.DEV ? n : Math.min(n, MAX_CONCURRENT_REQUESTS)
  )
}
```

- 開発サーバーでは従来どおり 1〜16 で計測できる。
- 本番ビルドでは、URL から上限を上げられない(下げるのは可)。
- `src/config/urlState.js` 側の読み取りも確認する。`debug` が無いときは無視される現在の挙動は変えない。
- テスト: 本番ビルド相当の条件で `maxConcurrent=16` が 3 に丸められること(`import.meta.env.DEV` を切り替えられる形にするか、丸める処理を関数に切り出して単体でテストする)。

## 修正3(推奨): `fetchWithTimeout` の戻り値に `headers` を足す

### 理由
次のタスク(429 を受けたときの一時停止と `Retry-After` の尊重)で必要になる。今足すのは1行で済む。

### 変更
`src/api/wikipedia.js` の `fetchWithTimeout` の戻り値に `headers: res.headers` を足す。

```js
return {
  ok: res.ok,
  status: res.status,
  headers: res.headers,
  text: async () => text,
  json: async () => JSON.parse(text),
}
```

- 本文を読み終えた後でも `Headers` は使える。
- 戻り値の形を使う既存のテストの偽 `fetch`(`tests/wikipedia.test.js` など)に影響が無いか確認する。
- `Retry-After` を読んで待つ処理そのものは、このタスクでは実装しない。

## 確認(コードを直す前に調べて、結果を報告する)

1. **検索候補の取り消し**: `src/components/TopBar.jsx` が `fetchSuggestions(query, limit, { signal })` に `signal` を渡し、
   入力が変わったときに古い待機分を `abort` しているか。渡していなければ、指示書(`task-concurrency-limit.md` の仕様5)を満たしていないので、渡すよう直す。
2. **`priority: 'high'` を渡す既存の呼び出し**: `fetchPageviews(...)` を `{ priority: 'high' }` で呼んでいる箇所が
   `App.jsx` などに残っていないか `grep` する。あれば `'views'` に直す(または理由を報告する)。
3. **`Response` から独自オブジェクトに変えた影響**: `fetchWithTimeout` の戻り値に対して `.headers`(修正3で復活)・`.clone()`・`.body`・
   `.arrayBuffer()` などを使っている箇所が、`src/`・`scripts/fetch-long-walks.mjs`・`tests/` に無いか `grep` する。あれば報告して直す。

## 変えないこと

- 同時実行数の既定値(`MAX_CONCURRENT_REQUESTS = 3`)。
- キャッシュの仕組み、リクエストの内容・件数。
- 429 への待機処理、閲覧数の件数削減、URL の `path`・`neighborLimit` の上限(別タスク)。
- 英語版対応(見送り決定済み)。

## 手順

1. `feature/concurrency-limit` で作業する。`main` には触れない。push は指示があるまでしない。
2. 上の「確認」3点を先に調べて、結果を報告する。
3. 修正1〜3を実装し、テストを足す。既存の406件と合わせて全部通す。ビルドも通す。
4. 修正1の効果を測る。前回と同じ条件で、検索直後にサイドバーが出るまでの時間(展開の後)を、キャッシュを使わない計測用のビルドで3回測り、
   前回の値(+1.5〜2.4秒)と比べる。結果は `docs/report-concurrency-limit.md` に追記する。
5. `docs/SPEC.md`・CLAUDE.md の更新を確認する。

## 完了条件

- サイドバーが閲覧数より先に処理されることが、テストと計測の両方で確認できる。
- 本番ビルド相当の条件で、URL から上限を3より大きくできない。
- 「確認」3点の結果が報告されている。
- 既存テストと新しいテストがすべて通り、ビルドが成功する。

## 残る作業(このタスクの後)

- Network タブでの目視確認(人が行う。`docs/report-concurrency-limit.md` 末尾の手順)。
- 429 を受けたときの全体の一時停止と `Retry-After` の尊重(別タスク)。
- 復元時の閲覧数の取得を絞る、`neighborLimit` などの URL 上書きを制限する(別タスク)。
