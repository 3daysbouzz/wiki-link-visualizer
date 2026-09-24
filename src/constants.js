/**
 * アプリ全体で使う定数。SPEC.md 3.7 に対応。
 * チューニング対象の値はすべてここに集める。
 */

// 1記事から展開するノード数
export const MAX_LINKS = 40

// --- リンクの抽選 (SPEC 3.5) --------------------------------------------
// 関連度順に固定で上位を出すと、同じ記事からは永遠に同じ顔ぶれしか出てこない。
// 散歩としてつまらないので、上位から重み付きで抽選する。

// 抽選の母集団にする候補数(関連度上位から何件をプールするか)
export const POOL_SIZE = 150

// 抽選せず必ず出す上位件数。
// 「初音ミク→ボーカロイド」のような当たり前の道を必ず残すため
export const GUARANTEED_TOP = 10

// 抽選の重みの効き方。重み = 1 / (順位 + SAMPLE_BIAS)。
// 小さくすると上位に偏り、大きくすると全体が平坦(よりランダム)になる
export const SAMPLE_BIAS = 10

// --- 関連度 (SPEC 3.2〜3.3) --------------------------------------------
// 関連度は検索エンジンの morelike(内容が似た記事)の順位で決める。
// 何件まで取るか(APIの上限は500)。リンク先との突き合わせに使うので多いほどよい
export const RELATED_LIMIT = 500

// --- 関連スコア (SPEC 3.3) ----------------------------------------------
// score = wMorelike × m + wMutual × mutual + wLead × lead
// morelike だけだと、本文の語彙が違う記事(キャラクター記事に対する担当声優など)が
// 圏外に落ちる。相互リンク・冒頭リンクを加点してそれを拾う。
//
// m = 1 / (1 + 順位 / MORELIKE_HALF_RANK)。この順位で m が 0.5 になる。
// 20 にしておくと、mutual だけ(0.8)の候補が morelike 5位(0.8)と同じ強さになる
export const MORELIKE_HALF_RANK = 20

// 重みの既定値。VizConfig(presets.ts)にも項目があり、URL と leva から上書きできる。
// **ここの値は current プリセットの既定値**(=加点なしの従来の順位)。
// 加点を効かせた値は rev2 プリセット側に書いている
export const W_MORELIKE = 1
export const W_MUTUAL = 0
export const W_LEAD = 0

// ?debug=1 のとき、スコアの内訳を console.table に出す件数
export const SCORE_DEBUG_ROWS = 20

// リンク先一覧の継続取得の上限回数。1回で最大500件取れるので、
// 3回=1500件を超えるリンクを持つ記事(「日本」など)はそこで打ち切る
export const MAX_CONTINUE = 3

// --- 閲覧数 (SPEC 3.4) ---------------------------------------------------
// 閲覧数は「表示するノードの分だけ」REST APIから1件ずつ取る。
// (MediaWiki API の prop=pageviews は1リクエストで5件しか新規に取れないため、
//  候補全件の閲覧数を集めるのは現実的でない。経緯は SPEC 3.1)

// 閲覧数を集計する日数
export const PAGEVIEW_DAYS = 3

// 閲覧数を同時に取りにいく件数。多すぎると 429(叩きすぎ)で拒否される
export const VIEWS_CONCURRENCY = 8

// --- 通信の打ち切り ---------------------------------------------------------
// 1リクエストをこの時間(ms)で諦める。Wikipedia 側が応答を返さないまま
// 止まったとき、画面が「FETCHING」のまま固まらないようにするため。
// morelike 検索は通常 1〜3 秒なので、それより十分長く取る
export const FETCH_TIMEOUT_MS = 15000

// ホバーしてからプレビューを取りに行くまでの待ち時間(ms)
export const PREVIEW_DELAY_MS = 300

// 同時に表示するラベルの最大数。
// これとは別に、画面上で重なるラベルは後から来たものを捨てる
export const VISIBLE_LABELS = 24

// ラベルの重なり判定にかけるノードの最大数(多すぎると計算が重い)
export const LABEL_CANDIDATES = 60

// --- ノードの大きさ (SPEC 4章・6.4) -------------------------------------
// ノードは「画面上のピクセル」で大きさを指定する(カメラが寄っても引いても
// 見た目の大きさは変わらない)。デザイン指示書が 2D の px 指定なのでそれに合わせた。
//
// 階層(現在地からの距離)ごとの半径(px)
//   起点   = 現在地(trail の末尾)。呼吸で NODE_PX_CURRENT〜NODE_PX_CURRENT_MAX を往復
//   一次   = 現在地に直接つながるノード。この中だけ閲覧数で幅を持たせる
//   二次   = それ以外(TRAIL_KEEP で残っている過去の訪問記事の子など)
export const NODE_PX_CURRENT = 14
export const NODE_PX_CURRENT_MAX = 15.5
export const NODE_PX_PRIMARY_MIN = 6
export const NODE_PX_PRIMARY_MAX = 9
// 訪問済み(軌跡上の起点以外)は中空の輪で描く。その半径
export const NODE_PX_VISITED = 7
export const NODE_PX_SECONDARY = 4
// 二次ノードの不透明度(奥にあるものとして薄く見せる)
export const NODE_SECONDARY_OPACITY = 0.5

// 一次ノードの半径に対応させる閲覧数の下端・上端。
// 閲覧数は記事間で1万倍以上違うので、必ず対数で割り当てる(線形だと二極化する)
export const VIEWS_SCALE_MIN = 10
export const VIEWS_SCALE_MAX = 100000

// 起点の呼吸(周期・秒)と、外周リングの半径(px)・不透明度の往復範囲
export const BREATH_PERIOD_S = 3.2
export const RING_PX_MIN = 20
export const RING_PX_MAX = 26
export const RING_OPACITY_MAX = 0.55
export const RING_OPACITY_MIN = 0.15

// クリックの当たり判定の半径(px)。見た目の球より広く取って小さい球を押しやすくする
export const HIT_RADIUS_PX = 16

// --- エッジ ---------------------------------------------------------------
// 主要エッジ(起点↔一次)は実線、弱いエッジ(それ以外)は破線。
// 色は白のみで、不透明度だけで階層を分ける
export const EDGE_PRIMARY_OPACITY = 0.5
export const EDGE_HOVER_OPACITY = 1.0
export const EDGE_WEAK_OPACITY = 0.15
// 破線の実部・空白部の長さ(ワールド座標。画面上では距離により変わる)
export const EDGE_DASH_SIZE = 1.5
export const EDGE_GAP_SIZE = 3.5

// ホバー時、隣接していないノード・エッジの不透明度をどこまで落とすか(倍率) (SPEC 6.1)
export const HOVER_DIM_RATIO = 0.3
// ホバー中のノードの拡大率と、切り替えの補間時間(秒)
export const HOVER_SCALE = 1.35
export const HOVER_TRANSITION_S = 0.2

// --- ラベル ---------------------------------------------------------------
// ラベルも画面上のピクセルで固定する(近づいたときに巨大化しないように)
export const LABEL_PX = 12
export const LABEL_CURRENT_PX = 13
// ノードとラベルの間隔(px)
export const LABEL_GAP_PX = 6
// この文字数で打ち切って末尾に … を付ける
export const LABEL_MAX_CHARS = 16
export const LABEL_COLOR = '#cfcfcf'
export const LABEL_HOVER_COLOR = '#ffffff'
// ラベル表示の再評価の間隔(ms)。毎フレームだと重い
export const LABEL_UPDATE_INTERVAL_MS = 200

// --- 背景グリッド ---------------------------------------------------------
// 起点を中心にした同心円と放射状ガイド線。カメラに正対させて起点に追従させる
export const GRID_RING_RADII_PX = [60, 120, 180, 240, 300]
export const GRID_RING_OPACITIES = [0.05, 0.045, 0.04, 0.035, 0.03]
export const GRID_RADIAL_COUNT = 8
export const GRID_RADIAL_LENGTH_PX = 420
export const GRID_RADIAL_OPACITY = 0.03
// 放射状ガイド線が1回転するのにかける時間(秒)
export const GRID_ROTATION_PERIOD_S = 140

// --- データパケット -------------------------------------------------------
// 起点→一次エッジの上を流れる小さな点。関連度上位の本数だけに限定する
export const PACKET_COUNT = 12
export const PACKET_PERIOD_S = 2.6
export const PACKET_STAGGER_S = 0.4
export const PACKET_PX = 2.2

// --- パララックスドリフト -------------------------------------------------
// 背景レイヤー(グリッド・二次ノード)と前景レイヤー(起点+一次)を別々の
// 周期で微小に揺らし、視差で奥行きを出す。振幅は px 相当
export const DRIFT_BACK = { periodS: 26, x: 7, y: -5 }
export const DRIFT_FRONT = { periodS: 19, x: -4, y: 3 }

// --- クリック遷移 ---------------------------------------------------------
// クリックしたノードへカメラが飛ぶ時間(ms)と、そのイージング(cubic-bezier)
export const TRAVEL_MS = 700
export const TRAVEL_EASE = [0.22, 0.85, 0.25, 1]
// 移動中、目的地以外のノード・主要エッジをこの不透明度まで落とす
export const TRAVEL_DIM_OPACITY = 0.15

// カメラ追従の追いつき速度(1に近いほど機敏、小さいほど滑らか)
export const FOLLOW_LERP = 0.06

// ズームボタン1回あたりの倍率(カメラと注視点の距離をこの比で縮める/伸ばす)
export const ZOOM_STEP = 1.3
export const ZOOM_TWEEN_MS = 250

// --- 検索オートコンプリート・パンくず -------------------------------------
// 入力が止まってから候補を取りに行くまでの待ち(ms)と候補数
export const SUGGEST_DEBOUNCE_MS = 200
export const SUGGEST_LIMIT = 8
// 左下のパンくずに出す直近の件数
export const BREADCRUMB_COUNT = 3

// この数を超えたら操作パネルに注意を表示する(止めはしない)
export const MAX_NODES_WARN = 300

// --- 狭幅(モバイル)対応 -------------------------------------------------
// この幅(px)未満を「モバイル用レイアウト」とみなす。
// App.css の @media (max-width: 899px) と同じ値にしておくこと
// (CSS のメディアクエリは変数を参照できないので、両方に書く)
export const MOBILE_BREAKPOINT_PX = 900
// モバイルでの描画解像度の上限(devicePixelRatio の上限)。
// スマートフォンは DPR 3 が普通で、そのまま描くとデスクトップの数倍の画素を
// 毎フレーム塗ることになる。1.5 に抑えると見た目はほぼ変わらず負荷が半分以下になる
export const MOBILE_MAX_PIXEL_RATIO = 1.5

// 「低い横画面」とみなす高さ(px)の上限。App.css にも同じ値を書くこと
// (CSS のメディアクエリは JS の定数を参照できない)。
//
// 幅だけで判定すると横向きのスマートフォンが救えない:
//   844x390(横向きのスマートフォン)は幅900px未満なので縦積みになり、
//     折り返したトップバーと 40vh のサイドバーでグラフが 100px 前後しか残らない
//   932x430(大きめのスマートフォン 横)は幅900px以上なのでPCレイアウトになり、
//     340px のサイドバーでグラフが狭くなる
// どちらも「高さが足りない」ことが本質なので、高さで判定する。
// 500px は、横向きスマートフォン(390〜430程度)を含み、
// 小さめのタブレット縦(768程度)を含まない値として選んだ
export const SHORT_LANDSCAPE_MAX_HEIGHT_PX = 500

// 散歩の軌跡をどこまで残すか (直近この数の訪問記事について、
// その未展開の子ノードを画面に残す)。
// 訪問した記事そのもの(軌跡)は、この値に関わらず消さない。
export const TRAIL_KEEP = 2

// --- 力学シミュレーション (SPEC 8章・12.2) --------------------------------
// もともと Graph3D.jsx の冒頭に直書きしていたが、「数値は constants.js に集める」
// 方針に合わせてここへ移した。
//
// このうち repulsion / repulsionRange / springK / springLength / centerK /
// damping / alphaDecay は VizConfig(presets.ts)にも項目があり、
// URL と leva から上書きできる。**ここの値は current プリセットの既定値**で、
// 実際に計算へ渡るのは config の値。両方を変えるときは必ず揃えること。
//
// 残り(MAX_SPEED / ALPHA_MIN / SIM_STEPS_*/ SPAWN_SPREAD)は公開していない。
// 数値を動かしても「配置の好み」ではなく安定性やフレーム処理に効く値で、
// 触ると発散したり環境ごとに結果が変わったりするため。

// ノード同士が押し合う強さ。大きいほど全体が広がる。
// 距離の2乗で割るので、近いノードほど強く効く
export const REPULSION = 2600
// 反発を計算する距離の上限(ワールド座標)。これより遠い組は総当たりから外す。
// 小さくすると速くなるが、離れた塊同士が重なりやすくなる
export const REPULSION_RANGE = 320
// リンクのバネの硬さ。大きいほど繋がったノードが素早く引き寄せられ、
// 大きすぎると振動する
export const SPRING_K = 0.012
// バネの自然長(ワールド座標)。隣接ノードの狙いの距離
export const SPRING_LENGTH = 55
// 原点へ引き戻す力。0 にすると全体が際限なく広がる
export const CENTER_K = 0.006
// 速度の減衰(0〜1)。小さいほど早く止まり、1 に近いほど揺れが長引く
export const DAMPING = 0.86
// 1ステップごとの alpha の減衰率。小さくすると早く収束する
export const ALPHA_DECAY = 0.99

// --- 以下は VizConfig に出さない(安定性・再現性に関わるため) ---
// 1ステップで動ける速度の上限。発散(ノードが飛んでいく)の歯止め
export const MAX_SPEED = 14
// alpha がこれを下回ったら計算を止める(収束とみなす)
export const ALPHA_MIN = 0.015
// シミュレーションは固定の時間刻みで進める(1秒あたりのステップ数と、1フレームで進める最大数)。
// フレームレートに依存させると、同じ種でも環境ごとに配置が変わってしまう
export const SIM_STEPS_PER_SEC = 60
export const SIM_MAX_STEPS_PER_FRAME = 4
// 新規ノードの初期配置をばらまく範囲(ワールド座標)。
// (seed, 記事名) から決まるので、同じ種なら同じ場所に生まれる
export const SPAWN_SPREAD = 120
