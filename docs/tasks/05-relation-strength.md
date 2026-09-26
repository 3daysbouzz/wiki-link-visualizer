# タスク05: 関連の強さを配置と動きで見せる(距離・相互リンクの脈動・共通ワードのパケット・中心間の距離)

CLAUDE.md と SPEC.md(3.3〜3.5・6章(特に 6.1・6.3・6.7)・12章)を読んでから着手すること。
前提: 01(関連スコア方式)・02(関連リンクの追加表示)・03(奥のラベルを透けさせる)が完了していること

## 背景と目的

今は関連スコア(01で導入した m・mutual・lead・score)が並び順と抽選にしか使われておらず、
画面上の配置や動きには反映されていない。wiki散歩で「次にどれをクリックするか」を判断しやすくするため、
関連の強さを次の4つで見せる。

1. 関連スコアが高い記事ほど、中心の近くに置く
2. 相互リンクのある線を、**控えめな太さ + 目に見える脈動**で強調する(色は使わない)
3. 1つ前の中心ワードと今の中心ワードの**両方に**つながっている関連ワード(共通ワード)に、
   前の中心 → 共通ワード → 今の中心 の経路でパケットを流し、前後の記事のつながりを見せる
4. 訪問した中心ワード同士の距離を、相互リンクの有無と共通ワードの数で変える
   (単純な関連ワードより基準は大きめに取るが、関連が強い中心同士は近づいてよい)

利用者との合意事項(2026-09-25):

- 共通ワードの母集団は、**画面に出ている分**(`expansions` に記憶している全件。+ MORE の追加分を含む)。
  「見えているものが根拠になっている」ほうが体験として分かりやすいため。候補プール(150件)は使わない
- 中心同士の距離は、今は子の距離と同じ考え方の式でよいが、将来は独立した基準に変える可能性がある。
  そのため設定値と式を child 用と trail 用で最初から分けておく
- 強調は太さより脈動が主役。太くしすぎない
- 今回はすべて新プリセット `rev3` だけで on にする。まだ調整段階のため `current`・`rev2`・`mesh` は off のまま
  (将来は既定を on にする可能性がある)

## 用語

- **中心(center)**: 軌跡 `shown` 上の記事。今の中心 = `shown` の末尾、1つ前の中心 = 末尾から2番目
- **child edge**: 中心 → その子(`expansions.get(中心)` の各記事)の線
- **trail edge**: 軌跡上で隣り合う中心同士の線(`buildGraph` の `addLink(shown[i], shown[i + 1])`)
- **共通ワード**: `expansions.get(1つ前の中心)` と `expansions.get(今の中心)` の両方にある記事(中心自身は除く)

## 仕様

### 0. 下地: スコア情報をエッジまで運ぶ

現状、`fetchLinkedArticles`・`getMoreLinks` は候補を `{ title }` だけに削って `expansions` に渡しており、
`m`・`mutual`・`lead`・`score` は `linkCache` 止まりになっている。これを次のように直す。

1. `expansions` に保存する各子を `{ title, mutual, relScore }` に拡張する
   - `relScore` は `score` を 0〜1 にならした値。**その記事を展開したときの重み**で計算して、この時点で保存する
     (重みの変更は「次に展開する記事から効く」約束(SPEC 3.3)なので、`buildGraph` で今の重みを使って
     割り直すと、パネルで重みを動かした瞬間に記憶済みの配置がずれてしまう)
   - `relScore = clamp(score / (wMorelike + wMutual + wLead), 0, 1)`。重みの合計が 0 なら `relScore = 0`
     (m∈[0,1]・mutual/lead∈{0,1} なので、重みを変えても常に 0〜1 に収まる)
   - 計算は純粋関数(例: `normalizeScore(score, weights)`)に切り出す
   - `m`・`lead`・`score` まで持たせるかは任意(デバッグに便利なら持たせてよい)
2. `buildGraph`(App.jsx)の `addLink` で、線に `type` と計算用の値を持たせる
   - child edge: `{ type: 'child', relScore, mutual }`
   - trail edge: `{ type: 'trail', mutual, sharedCount }`(値の求め方は 3・4)
   - trail edge と child edge が同じ2点を結ぶ場合(次の中心が前の中心の子だった場合)は、
     今の `addLink` の重複除去により trail edge が優先される。この挙動は変えない
     (その記事は関連スコアの距離ではなく、中心同士の距離で置かれる。「中心同士は大きめ」の要望に合う)
3. `Graph3D.jsx` の力学計算(`(dist - springLength) * springK` の箇所)を、
   全エッジ共通の `springLength` ではなく**エッジごとの自然長**を参照するように直す。
   自然長の計算は `type` で分岐する純粋関数 `computeEdgeSpringLength(edge, config)` として `src/utils/` に置き、
   child 用と trail 用で別々の設定値を参照する。毎ステップ計算せず、グラフの更新時と
   力学の設定の変更時にエッジへ書き込んでおく(内側のループを重くしないため)

### 1. 子ノードの距離 = 関連スコア

- `distanceByScore`(on/off)を VizConfig に追加する。**off なら child edge も trail edge も
  `config.springLength`**(VizConfig 化済みの値。定数 `SPRING_LENGTH` ではない)を使う従来どおりの挙動
- on のとき:

      springLength(child edge) = lerp(childSpringMax, childSpringMin, relScore)

  (relScore が高い = 関連が強いほど短い。lerp は線形補間)
- `childSpringMin`・`childSpringMax` を VizConfig に追加する。目安は `springLength` の 0.6〜1.4倍
  (実際に見て調整する。決めた値と理由を constants.js のコメントに残す)

### 2. 相互リンクの強調(太さ控えめ + 脈動が主役)

- 対象は `mutual === 1` の線(child edge と trail edge の両方)
- `mutualEmphasis`(on/off)を VizConfig に追加する。**off のときは今の描画(`LineSegments`)をそのまま使い**、
  on のときだけ相互リンクの線を `three` 同梱の太線(`three/examples/jsm/lines` の
  `LineSegments2` / `LineMaterial`。依存は増えない)で描く。
  off でも太線に置き換えると、`current`・`rev2` の見た目が微妙に変わるおそれがあるため
- 太さ: 通常線(1px)の `mutualWidthMultiplier` 倍。太くしすぎない(目安 1.3〜1.5)。
  実線・破線の区別(起点につながる線は実線)は太線でも保つ
- 脈動: 線の明るさに正弦波を掛ける。

      bright = baseBright × (1 - mutualPulseAmplitude × (1 + sin(t × mutualPulseSpeed)) / 2)

  明るさは `baseBright × (1 - 振幅)` 〜 `baseBright` を滑らかに往復する(0 までは落とさない)。
  強調の主役は脈動なので、振幅は**目で見て脈打っていると分かる**大きさにする
  (目安 0.4〜0.6。決めた値と理由を constants.js のコメントに残す)
- 今の線は不透明度ではなく頂点色の濃さ(`link.bright`)で明るさを表している。脈動は、
  ホバー時の減光・遷移中の減光を反映して補間した後の明るさに、**最後に掛ける**
  (暗くしてある線が脈動で急に目立つことを防ぐ)
- 色は変えない(SPEC の「白だけを使い、意味を1つずつ割り当てる」ルールを保つ)。
  脈動は「相互リンク」専用の表現とし、ほかの意味に使わない
- `mutualWidthMultiplier`・`mutualPulseAmplitude`・`mutualPulseSpeed` を VizConfig に追加する

### 3. 共通ワードにパケットを流す

- `sharedPackets`(on/off)を VizConfig に追加する
- on で、1つ前の中心と今の中心に共通ワードがあるときは、データパケット(SPEC 6.7)を
  **1つ前の中心 → 共通ワード → 今の中心** の2区間の経路で流す
  - 流す先は今の中心の `expansions` の並び順(スコア順)で先頭から最大 `PACKET_COUNT` 件
  - 2区間を同じ速さで進む(1周の時間は今の `PACKET_PERIOD_S` の2倍)。区間の継ぎ目で止めない
  - 経路の2本の線(前の中心 → 共通ワード、共通ワード → 今の中心)は、TRAIL_KEEP=2 のため既に表示されている。
    新しい線やノードは足さない
- 共通ワードが無いとき(最初の記事・共通が0件・`trailEnabled=false`・`shown` が2件未満)は、
  今までどおり 今の中心 → 子の上位 `PACKET_COUNT` 件 に流す
- off なら今までどおり(`current`・`rev2`・`mesh` は off)
- パケットの意味が「今の中心の上位の子」から「前後の中心をつなぐ共通ワード」に変わるので、
  SPEC 6.7 のパケットの説明を、両方の場合が分かるように書き直す

### 4. 中心同士(trail edge)の距離

- `sharedCount` = 隣り合う2つの中心それぞれの `expansions.get(id)` の title の積集合の件数
  (+ MORE の追加分を含む。中心自身は数えない)。純粋関数に切り出す
- `mutual`(中心同士が相互リンクしているか)は、後の中心が前の中心の `expansions` に子として記憶されていれば、
  その子の `mutual` を使う。記憶されていない場合(1つ前の中心の子をクリックして進んだ、
  リダイレクトで記事名が変わった、など)は 0 とする。判定のために新たな問い合わせはしない
- `distanceByScore` が on のとき:

      springLength(trail edge) = max(childSpringMin,
          trailSpringBase
          - trailMutualBonus × mutual
          - trailSharedBonus × min(sharedCount, trailSharedCap))

  - `trailSpringBase` は `childSpringMax` より大きくする(初期値の目安は `childSpringMax` の1.3倍程度)。
    「単純な関連ワードより中心同士を大きめに取る」は、この**基準値を大きめに取る**という意味。
    関連が強い中心同士は、`childSpringMin` まで近づいてよい
  - `trailSpringBase`・`trailMutualBonus`・`trailSharedBonus`・`trailSharedCap` を VizConfig に追加する
  - 式と設定値は `computeEdgeSpringLength` の trail 用の分岐に閉じ込め、child 用の値を参照しない
    (下限の `childSpringMin` だけは共用。将来 trail を独立した基準に変えるときは、この分岐だけを書き換える)
- trail edge が相互リンクなら、2と同じ太さ・脈動で強調する(設定値は共用)
- `trailEnabled=false` のとき、または `shown` が2件未満のときは trail edge が無いので、この計算はしない

### 5. 設定とプリセット

- 新しい設定はすべて VizConfig に入れる。URL クエリで上書きでき、leva の新フォルダ `relation` で変更できるようにする
  - 配置に効くもの(`distanceByScore`・`childSpring*`・`trail*`)は、変更したら力学を再開する(今の `LAYOUT_KEYS` と同じ扱い)
  - 見た目だけのもの(`mutual*`・`sharedPackets`)は、描画だけを変える(今の `VISUAL_KEYS` と同じ扱い)
- 既定値は constants.js、範囲は presets.ts の `RANGES` に置き、`current` と揃える(既存のテストが検査している)
- `current`・`rev2`・`mesh` は見た目と配置を変えない。`distanceByScore`・`mutualEmphasis`・`sharedPackets` は off
- 新プリセット `rev3` を `rev2` をベースに作り、今回の機能をすべて on にする
- `DEFAULT_PRESET` は変更しない(`rev2` のまま。`?preset=rev3` で確認する)

## 実装の順番とコミット

描画の変更がいちばん大きいので最後に回す。段階ごとにコミットしてよい(すべてタスク05のコミットとする)。

1. 下地(0): `expansions` に保存する情報を増やす・線に `type` を持たせる・`computeEdgeSpringLength` とテスト。
   off のままなので見た目は変わらない
2. 子ノードの距離(1)
3. 中心同士の距離(4)
4. 共通ワードのパケット(3)
5. 相互リンクの太さと脈動(2)
6. プリセット `rev3`・leva・SPEC・README・CLAUDE.md の更新

## テスト(tests/)

- `normalizeScore`: 重み(wMorelike/wMutual/wLead)を変えても常に 0〜1 に収まる。重みの合計が 0 なら 0
- `computeEdgeSpringLength`:
  - `distanceByScore` off なら child edge も trail edge も `config.springLength` を返す
  - relScore=1 で `childSpringMin`、relScore=0 で `childSpringMax` になる
  - trail edge が mutual・sharedCount に応じて短くなり、`childSpringMin` を下回らない。sharedCount は `trailSharedCap` で頭打ち
- `sharedCount` が2つの title 配列の積集合の件数と一致する(順不同・重複なし・中心自身を除く)
- trail edge の `mutual` が、後の中心が前の中心の子として記憶されていないとき 0 になる
- `shown` が2件未満、または `trailEnabled=false` のとき trail edge が作られない
- パケットの流す先: 共通ワードがあるときは共通ワード(今の中心の並び順で最大 `PACKET_COUNT` 件)、
  無いとき・`sharedPackets` off のときは今の中心の子の上位になる(純粋関数に切り出してテストする)
- 既存テスト(constants.js・RANGES・current の一致)が新しい項目でも通る

## 完了条件

- `?preset=rev3` で、関連の強い記事ほど中心に近く配置される
- `?preset=rev3` で、相互リンクの線が脈動(主)と太さ(従)で見分けられる(色は変わらない)
- `?preset=rev3` で2記事以上進むと、前の中心 → 共通ワード → 今の中心 にパケットが流れる。
  共通ワードが無い記事では、今までどおり今の中心から流れる
- `?preset=rev3` で、訪問した中心同士の距離が相互リンク・共通ワード数によって変わる
  (共通ワードが多い/相互リンクがある経路ほど近くなることを、実際の記事名と共通ワード数を添えて報告する)
- `?preset=current`・`?preset=rev2` で見た目・配置・パケットが変わっていない(回帰確認)
- `npm test`・`npm run build` が通り、Console にエラーが出ない
- SPEC 3.3・6章(6.1 の線・6.7 のパケット)・12.2・12.4、README、CLAUDE.md の該当記述を更新する
  (CLAUDE.md の「線種・不透明度」の割り当ての一覧に「脈動 = 相互リンク」を加える)

## 確認後の修正(2026-09-26 利用者と合意)

- 相互リンクの強調(2)の対象を**中心同士(trail edge)の相互リンクだけ**にする。子への線は対象外。
  rev2 の重みでは表示される子の 97〜100% が相互リンクで、全部の線が脈打って見分けられなかったため
- 共通ワードを通るパケット(3)の点を少し大きくする(`sharedPacketPx`。既定 3px、通常は 2.2px)
