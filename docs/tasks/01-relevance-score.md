# タスク01: 関連リンクの順位付けを「合計スコア方式」に変える(相互リンク・冒頭リンクの加点)

CLAUDE.md と SPEC.md(3.3〜3.5・7章・12章)を読んでから着手すること。
前提: 別途実装中の「力学パラメータの VizConfig 化」(以下 VizConfig 化)が完了していること

## 背景

友人のフィードバックで「有名キャラクターを検索したのに担当声優が出てこない」とあった。
原因は、順位付けが morelike(本文の類似度)だけであること。
キャラクター記事と声優記事(出演作の一覧が中心)は本文の語彙が違うため、
声優は morelike の順位が低いか圏外になる。圏外になると「記事の長さ順」で後ろに回され、抽選にも漏れやすい。
声優のような記事は「相互にリンクしている」「冒頭(リード文・インフォボックス)にある」
という特徴を持つので、これを加点する。相互リンクは高め、冒頭リンクはほどほどに効かせる。

## 仕様

### 1. スコアの定義

候補ごとに次を計算し、スコアの高い順に並べる。
同点のときは記事の長さの降順、それも同じならタイトル順(順序を決定論的にするため)。

    score = wMorelike × m + wMutual × mutual + wLead × lead

- `m`: morelike の順位 r(0始まり)があれば `1 / (1 + r / MORELIKE_HALF_RANK)`、圏外なら 0。
  `MORELIKE_HALF_RANK = 20`(20位で0.5になる)。constants.js に置く
- `mutual`: 候補記事から中心記事へのリンクもある(相互リンク)なら 1、ない・不明なら 0
- `lead`: 中心記事の冒頭節(section=0。インフォボックスを含む)にリンクがあれば 1、それ以外は 0

上位 `POOL_SIZE` 件をプールにし、その後の抽選(`GUARANTEED_TOP`・`SAMPLE_BIAS`)は今のまま使う。

### 2. 相互リンクの取得

- 第一案: 既存の `fetchLinks`(generator=links)に `prop=links&pltitles=<中心記事>&pllimit=max` を相乗りさせ、
  各候補が中心記事にリンクしているかを同じリクエストで取る
- 実際に API を叩いて、継続取得(continue)を含め正しく取れるか確認すること。
  うまくいかなければ `list=backlinks`(中心記事への被リンク)と候補の突き合わせに切り替える。
  その場合は取得の上限回数を定数で設ける(「日本」のように被リンクが膨大な記事で止まらないように)
- どちらの方式を採ったか、その理由を SPEC 3.3 に書く

### 3. 冒頭リンクの取得

- `action=parse&page=<中心記事>&prop=links&section=0&redirects=1`
- parse が返すリンク先はリダイレクト解決前の名前。候補(generator=links&redirects=1 で解決済み)と
  突き合わせるには名前を揃える必要がある。そのため `fetchLinks` の応答に含まれる
  `query.redirects`(from→to)を集めておき、冒頭リンクの名前をそれで解決してから照合する

### 4. 取得失敗時の扱い

- 相互リンク・冒頭リンクの取得は既存のリクエストと並列に投げる(Promise.all)。表示までの待ち時間を増やさないため
- どちらかが失敗しても展開全体はエラーにしない。その要素を 0 として続行し、`console.warn` を出す
  (閲覧数と同じ「補助情報は取れなくても止めない」扱い)
- Wikipedia への fetch は `fetchWithTimeout` を通し、独自ヘッダを付けない(CLAUDE.md の約束)

### 5. 重みを VizConfig に入れる

- `wMorelike` / `wMutual` / `wLead` を VizConfig に追加する。URL クエリと leva(新フォルダ ranking)で変更できるようにする
- 新プリセット `rev2` を作り、`DEFAULT_PRESET` にする: wMorelike=1.0, wMutual=0.8, wLead=0.4
  (VizConfig 化で追加した力学・表示の値は current と同じでよい)
- `current` は wMutual=0, wLead=0 にして、従来と同じ順位になることを保証する(回帰確認用)
- `mesh` は rev2 と同じ重みにする
- 重みの変更は「次に展開する記事から」効く(neighborLimit・seed と同じ扱い。expansions に記憶済みの結果は変えない)
- `linkCache` にはスコア計算前の素材(morelike 順位・mutual・lead・length)を保存する。
  並べ替えと抽選は取り出すときに行う。そうしないと重みを変えてもキャッシュ済みの記事に反映されない
- `fetchLinkedArticles` の引数が増えるので、options オブジェクトにまとめてよい

### 6. ログとデバッグ

- `[wikipedia]` のログ行に次を追加する: 相互リンク N件 / 冒頭リンク N件 / 確定枠(上位 GUARANTEED_TOP)のうち morelike 圏外 N件
- `?debug=1` のとき、プール上位20件のスコアの内訳(m・mutual・lead・score)を `console.table` で出す。重みの調整に使う

## テスト(tests/)

スコア計算は純粋関数として切り出してテストする。

- wMutual=0・wLead=0 で、従来の並び(morelike 順 → 長さ順)と一致する
- morelike 圏外・mutual=1・lead=1 の候補が、morelike 1位より上に来る(1.2 > 1.0)
- mutual だけの候補が、morelike 5位前後と同程度の位置に来る
- 冒頭リンクがリダイレクト経由でも正しく照合される
- parse / 相互リンクの取得が失敗しても `fetchLinkedArticles` が成功を返す(0扱い)
- 同じ入力なら同じ順位になる(決定論)

## 完了条件

- アニメ・ゲームのキャラクター記事を3つ以上選んで確認し、担当声優が確定枠に入るかを報告する
  (記事名・声優の順位・スコアの内訳)
- `?preset=current` では従来と同じ顔ぶれになる(同じ seed で比較)
- 展開にかかる時間の変化を `[wikipedia]` のログで比較して報告する(目安: 悪化は1秒以内)
- `npm test` が通る
- SPEC 3.3・3.5・10章(判定基準に「キャラクター記事で担当声優が確定枠に入る」を追加)・12.2、
  README の説明を更新する
