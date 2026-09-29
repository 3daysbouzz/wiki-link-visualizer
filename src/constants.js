/**
 * アプリ全体で使う定数。SPEC.md 3.7 に対応。
 * チューニング対象の値はすべてここに集める。
 */

// 1記事から展開するノード数
export const MAX_LINKS = 40
// rev5(既定)で1記事から展開する件数(VizConfig の neighborLimit。確定枠 GUARANTEED_TOP 10 + 抽選の枠 14)。
// 決め方(タスク09。2026-09-28): rev4 を土台に n40・n30・n24 を、保存した展開結果の22経路 × 復元・歩く × pc・phone で比べた。
// n24 は phone の中心付近の混み具合(M5)が 13.9 → 7.6、近すぎる組(M6)が 114.6 → 39.5 に減り、
// 上位の読める件数(M3)は減らずに増え(phone 2.9 → 3.9)、保証した共通ワード1件は全組で読めた。
// 段階の境目(3件・7件)のままでも段階の偏りがいちばん小さかった(n40 は many に偏る)。
// 輪を閉じられる候補(M10)は 30 → 23 に減るが、長い経路10本中8本で残る。
// 確定枠は変えない(当たり前の道を残す役目は件数によらないため)。11位以降は追加表示(+ MORE)で出せる
export const REV5_NEIGHBOR_LIMIT = 24

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

// --- 関連リンクの追加表示 (SPEC 5章・6.8) ---------------------------------
// 中心ノードのクリック / サイドバーの + MORE で、まだ出していない候補を
// スコアの高い順に足す。1回に足す件数と、1記事あたりの上限。
// VizConfig(presets.ts)にも項目があり、URL と leva から上書きできる。
// **ここの値は current プリセットの既定値**
export const MORE_BATCH = 8
export const MORE_MAX = 40

// 追加の瞬間に現在地ノードを震わせる(「振ると増える」手触りの名残)。
// 時間(ms)・振幅(画面上の px)・振動の回数。減衰させながら左右に揺らす
export const MORE_SHAKE_MS = 250
export const MORE_SHAKE_PX = 5
export const MORE_SHAKE_CYCLES = 3
// 上限に達していて足せないときの震えの大きさ(倍率)。「もう出ない」を小さな反応で伝える
export const MORE_SHAKE_EMPTY_RATIO = 0.4
// 追加したノードの出現位置を、現在地からどれだけずらすか(ワールド座標)。
// 完全に同じ座標だと反発力が発散するので、(seed, 記事名) から決まる微小なずれを付ける
export const MORE_SPAWN_JITTER = 6
// 追加したノードのラベルを優先表示する時間(ms)。何が増えたか読めるように
export const MORE_LABEL_BOOST_MS = 3000

// 左上のステータス行に一時的な案内を出す時間(ms)
export const NOTICE_MS = 3000
// 初めてグラフを出したときの操作の案内(「中心をクリックで…」)を出す時間(ms)
export const MORE_HINT_MS = 5000

// リンク先一覧の継続取得の上限回数。1回で最大500件取れるので、
// 3回=1500件を超えるリンクを持つ記事(「日本」など)はそこで打ち切る
export const MAX_CONTINUE = 3

// 打ち切りで候補に入らなかった冒頭リンクを、候補に補うときの上限件数(SPEC 3.3)。
// 問い合わせは50件ずつなので最大2回。冒頭リンクは多い記事でも170件ほどで、
// 候補に無いものは実測で最大49件だったので、通常は1回で済む
export const LEAD_EXTRA_MAX = 100

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

// --- ラベルの深さフェード (SPEC 6.3) ---------------------------------------
// 現在地より奥にあるラベルを深さに応じて薄くし、一定以上奥では消す。
// グラフを回して手前に持ってきたときに初めて名前が読める、という体験にするため。
// 球と線は今まで通り見せる(「そこに何かある」ことは分かるようにする)。
//
// delta = (ノードの深さ) − (現在地の深さ)。深さはカメラの視線方向に沿った距離。
//   delta ≤ LABEL_FADE_START            … そのまま(不透明度 1)
//   LABEL_FADE_START < delta < LABEL_FADE_END … 線形に薄くする
//   delta ≥ LABEL_FADE_END              … 消える
// VizConfig(presets.ts)にも項目があり、URL と leva から上書きできる。
// **ここの値は current プリセットの既定値**(current はオフ = 従来の見た目)。
//
// ここの 0 / 110 は current(オフ)の値で、指示書の初期値の目安(0 と springLength の2倍)。
// rev2・mesh は −60 / 60 を使う(presets.ts の REV2_LABELS)。0 / 110 で見ると、
// ラベルはもともと「カメラに近い順」に選んでいるので、表示されるのはほぼ手前の記事で、
// 薄くなるのは現在地より奥の一部だけだった(実測で表示中6件のうち2件)。
// 一次ノードは現在地から前後 ±150 程度に広がるので、始点を現在地の手前 60 に寄せ、
// 「手前ははっきり、現在地と同じ奥行きは半分、奥は見えない」の段差が選ばれたラベルの中にも出るようにした
// (2026-09-25 利用者と確認)
export const LABEL_DEPTH_FADE = false
export const LABEL_FADE_START = 0
export const LABEL_FADE_END = 110
// 深さで薄くなったラベルを、間引きの候補から外す基準(補間前の目標の不透明度)。
// 見えないラベルが VISIBLE_LABELS の枠と重なり判定の場所を使うと、
// 手前に出せたはずのラベルが減ってしまうため。
// 出す基準(SHOW)と引っ込める基準(KEEP)を分けて、閾値付近でチラつかないようにする
export const LABEL_FADE_SHOW = 0.05
export const LABEL_FADE_KEEP = 0.02

// ラベルの選び直し(200ms ごと)で、前回表示していたラベルを優先する度合い。
// カメラからの距離にこの倍率を掛けて「近い」とみなす(1 で優遇なし)。
// 回転中は距離の順が少しずつ入れ替わり、重なり判定の勝ち負けがそのたびに変わって
// 同じ場所のラベルが出たり消えたりしていた。表示中のものを少し優遇して入れ替わりを減らす
export const LABEL_KEEP_BIAS = 0.8

// ラベルの出入りのフェード時間(秒)。深さフェードが有効なとき(rev2・mesh)だけ使う。
// 重なりや件数の上限で選ばれなくなったラベルを即座に消すと、回転中に点滅して見える。
// この時間をかけて薄れさせ、新たに選ばれたラベルも同じ時間で浮かび上がらせる
// 0.3秒では速すぎて「ふわっと」感じられなかったので 0.5秒にした(2026-09-25 利用者の確認)。
// 濃さは等速ではなく、ゆっくり始まってゆっくり終わる曲線(smoothstep)で変える
export const LABEL_SWAP_S = 0.5
// 出入りのときにラベルを縦にずらす量(画面上の px)。現れるときは下から浮かび上がり、
// 消えるときは少し沈みながら薄れる
export const LABEL_SWAP_RISE_PX = 4
// 深さフェードでこの濃さ以下になっている奥のラベルは、重なり判定をしない
// (手前のラベルと重なっても消さず、場所も取らない)。
// 薄い文字は重なっても読みにくさにほとんど影響しないので、「奥にうっすら名前がある」状態を残し、
// 回して手前に来ると濃くなるようにする
export const LABEL_OVERLAP_FAINT = 0.3
// 上の「薄いので重なり判定をしないラベル」の最大数。VISIBLE_LABELS とは別枠
// (同じ枠を使うと、手前の読めるラベルが減ってしまうため)
export const LABEL_FAINT_MAX = 12

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

// --- カメラ (SPEC 4章・6.5) ------------------------------------------------
// 縦の画角(度)と描画範囲。画角は縦で決まるので、描画領域の幅を変えても縦の縮尺は変わらない
export const CAMERA_FOV = 60
export const CAMERA_NEAR = 1
export const CAMERA_FAR = 6000
// 起動時のカメラの位置(原点から +z 方向にこれだけ離れて原点を見る)
export const CAMERA_START_DISTANCE = 320
// 全体を収める(zoomToFit)ときの余白の倍率と、グラフが小さいときの半径の下限
export const FIT_PADDING = 1.4
export const FIT_MIN_RADIUS = 40
// 最初の表示(検索・URL からの復元)で、全体を収めるまでの待ち時間と、そのあと起点の追従に移るまでの時間(ms)。
// レイアウトがある程度広がってから収めないと、固まった初期配置に合わせて寄りすぎる。
// 画面上の見え方の測定(SPEC 12.5)は、この待ち時間を 60 ステップ/秒で換算したステップ数の配置で距離を求める
export const INITIAL_FIT_DELAY_MS = 900
export const INITIAL_FOLLOW_DELAY_MS = 1700
// 最初のカメラ距離の決め方(VizConfig の cameraFit。SPEC 4章。タスク08)
// 'all' は従来の「全体が入る」距離。current・rev2・rev3 はこれ。
// rev4 は 'd'(今の中心と確定枠 GUARANTEED_TOP 件の子が入る距離)。12経路 × 復元・歩く × pc・phone で候補 a〜d を比べ、
// 完了条件をすべて満たした a・c・d のうち、phone の混み具合(M5・M6)がいちばん小さく、移動ごとの距離の比も
// いちばん小さかった(1.43)ため。前の中心が画面に入る割合は a・c・d で同じ(46/48)。
// d は遠くに飛んだ子に引っ張られない(子が1件でも遠いと a はそれに合わせて引いてしまう)
export const CAMERA_FIT = 'all'
export const CAMERA_FIT_MODES = ['all', 'a', 'b', 'c', 'd']
// cameraFit 'b'(前の中心も入れる)で、今の中心の周りの範囲の何倍まで広げてよいか(上限)
export const CAMERA_FIT_PREV_CAP = 1.5
// cameraFit 'c'(前の中心が端に収まるときだけ入れる)で、今の中心の周りの範囲の何倍以内なら入れるか
export const CAMERA_FIT_PREV_EDGE = 1.2

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

// --- 関連の強さを配置と動きで見せる (SPEC 6.9・12.2) ------------------------
// VizConfig(presets.ts)にも項目があり、URL と leva(relation フォルダ)から上書きできる。
// **ここの値は current プリセットの既定値**。current・rev2・mesh では on/off を
// すべて off にして従来の配置・見た目を保ち、数値は rev3(すべて on)と共通にしている
// (on/off だけを切り替えて比べられるように)。

// 関連スコアが高い記事ほど中心の近くに置くか。off なら全部の線が springLength
export const DISTANCE_BY_SCORE = false
// 子への線の自然長の範囲。relScore=1(関連が最も強い)で MIN、0 で MAX。
// springLength(55)の 0.6倍〜1.4倍。狭いと差が見えず、広げすぎると
// 関連の弱い記事が外側の別の塊に混ざって「どの中心の子か」が読めなくなる
export const CHILD_SPRING_MIN = 33
export const CHILD_SPRING_MAX = 77
// 中心同士(trail edge)の自然長の基準。子の最大(77)の 1.3倍程度にして、
// 何の手がかりも無い中心同士は子より外側に並べる(「中心同士は大きめ」の要望)
export const TRAIL_SPRING_BASE = 100
// 中心同士が相互リンクしているときに縮める量
export const TRAIL_MUTUAL_BONUS = 15
// 共通ワード1件あたりに縮める量と、数える上限。
// 上限 10 件 × 4 = 40 と相互リンクの 15 を足しても 45 で、下限(CHILD_SPRING_MIN)の手前に収まる。
// 関連が強い中心同士ほど近く、ただし子の最も近い記事よりは内側に入らない
export const TRAIL_SHARED_BONUS = 4
export const TRAIL_SHARED_CAP = 10

// 中心同士の相互リンクを太線と脈動で強調する仕組み(タスク05 の mutualEmphasis)は、タスク07で外した。
// 中心同士はクリックで進めばほぼ必ず相互リンクになり、判断の材料にならなかったため。
// 明るさの脈動は、タスク10 で「輪を閉じられる記事の合図」に使った(下の EGG_HINT_*)

// 1つ前の中心と今の中心に共通する関連ワードがあるとき、パケットを
// 前の中心 → 共通ワード → 今の中心 に流すか(SPEC 6.7)。off なら従来どおり 今の中心 → 子
export const SHARED_PACKETS = false
// 共通ワードを通るパケットの半径(px)。通常のパケット(PACKET_PX = 2.2)より少し大きくして、
// 前後の記事のつながりを示す点だと分かるようにする(2026-09-26 利用者の指示)
export const SHARED_PACKET_PX = 3

// --- 中心同士の距離の段階 (SPEC 6.9。タスク07。rev4) --------------------------
// 共通ワードの件数を4段階に分け、段階ごとに中心同士の線の長さを決める(trailTiered が on のとき。
// distanceByScore も on であること)。細かく比例させないのは、説明しなくても
// 「共通ワードで距離が変わっている」と気づいてもらうため。2026-09-26 利用者と決定。
// 境目は利用者が決めた割り振りなので動かさない(調整するのは下の長さの方)。
// 表示件数を 24 にした rev5(タスク09)でも変えていない: 件数に合わせて縮めた案(2件・4件)は
// かえって many に偏り(53組中24組)、今のまま(3件・7件)の方が4段階に散らばった(5/21/13/14)
//   0 … none / 1〜3 … few / 4〜7 … mid / 8 以上 … many
export const TRAIL_TIER_FEW_MAX = 3
export const TRAIL_TIER_MID_MAX = 7
// 段階で決めるか。off なら従来(05)の計算(基準から相互リンクと共通ワードの数で縮める)
export const TRAIL_TIERED = false
// 段階で決めるときの、中心同士の線のバネの硬さ(子の線は springK のまま)。
// 中心同士の線は1本だけで、両側の中心にぶら下がる約40件の子すべてに原点への引き戻し(centerK)が掛かる。
// springK(0.012)のままでは線が負け、狙いの長さを変えても段階が分かれなかった。
// 決め方(タスク07。2026-09-27): 段階ごとに2〜4組(src/debug/benchRoutes.js の tiers)で実際の距離を測り、
// 隣り合う段階の比が最悪値でも 1.35 倍以上(1.3 に余裕を持たせた)になり、かつ段階の長さが
// RANGES(600)に収まる範囲で、いちばん低い硬さを選んだ。
//   0.065 以下は none を 600 より長くしないと届かない(0.04 で none 840、0.035 で 920)。
//   低くするほど長さが伸び、同じ none でも経路による距離のばらつきが大きくなる
// 記事を移動した直後の振動・行き過ぎは無い(SPEC 6.9 の 1b)。0.2 を超えると振動しやすい(springK の RANGES と同じ理由)
export const TRAIL_SPRING_K = 0.07
// 段階ごとの線の自然長(ワールド座標)。実際の距離は反発と引き戻しで狙いからずれるので、
// 上の方法で、実際の 3D 距離の比が最悪値で none/few 1.350・few/mid 1.357・mid/many 1.351 になる値にした。
// mid は子どうしの反発で約 190 より近づかないので、few・none を大きめにして差を取っている。
// many は 60(指示書の目安)より短くすると中心同士の球が重なって見えるので下げない
export const TRAIL_LEN_NONE = 580
export const TRAIL_LEN_FEW = 340
export const TRAIL_LEN_MID = 170
export const TRAIL_LEN_MANY = 60

// --- 到着時の共通ワード強調 (SPEC 6.10。タスク07。rev4) -----------------------
// 子をクリックして進んだ直後だけ、前後の中心と共通ワード以外をホバーと同じ比率まで減光し、
// 共通ワードの名前を確実に読めるようにする。強調している間だけで、終われば通常の表示に戻す
// (ずっと目立たせると、意図が伝わらないまま画面を占めるため。2026-09-26 利用者と合意)
export const ARRIVAL_SHARED = false
// 強調を続ける時間(ms)。値は見て決めたら理由を書き直す
export const ARRIVAL_SHARED_MS = 2500
// 通常の表示に戻す時間(ms)
export const ARRIVAL_SHARED_FADE_MS = 500
// 名前を保証する共通ワードの件数(今の中心の並び順 = 関連スコアの順で上から)。残りは点と線だけ明るく、件数をステータス行に出す。
// 1 にした理由(タスク07。2026-09-27): work・science の両経路、pc と phone、周回の最悪値でも全件読めるのが 1 件までだった。
// 共通ワードが多い組は中心同士が近く(画面上で pc 約19px・phone 約9px)、共通ワードはそのあいだに集まるので、
// 2件以上は角度によって重なる(2件で最悪 1件、4件で最悪 2〜3件)。回さずに見る初期視点だけなら 4件まで読める。
// 最初のカメラ距離の決め方(タスク08)で画面上の間隔が広がれば、増やせる可能性がある
export const ARRIVAL_SHARED_MAX = 1

// --- 輪を閉じたときの演出(イースターエッグ。SPEC 6.11。タスク10) ------------
// 今の中心の子をクリックして、2つ以上前に通った記事へ戻ると輪が閉じる(中心が3件以上の輪)。
// 説明はしない。気づいた人だけが驚く仕掛けにする(2026-09-26 利用者と合意)。
// 境目・色・長さは試用前の仮の値。身内の試用を見て調整する(別のタスク)
//
// 演出を行うか(VizConfig の easterEgg。見た目だけの項目)。current・rev2・rev3 は off(比較の土台を変えない)
export const EASTER_EGG = false
// カメラワーク(10b)を見せる輪の長さの下限。これより短い輪は、今のカメラのまま光らせるだけ
export const EGG_CINEMATIC_MIN = 6
// 輪の長さごとの色(段階)。**色はこの演出の中だけで使う**(CLAUDE.md の「色は使わない」の明示的な例外)。
// 長いほど一方向に色相が進む(黄 → 黄緑 → 緑 → 青に近い色)。「次はもっと先の色が見たい」と思ってもらうため、
// 行ったり来たりさせない(tests/egg.test.js で色相が長さの順に増えることを検査している)。
// 黒背景で白の線と並んでも沈まないよう、どれも明るさを高めに揃えた。
//
// 段階は4つ(タスク11。2026-09-27 利用者と決定): 3 = 黄、4 = 黄緑、5 = 緑、6 以上 = 最後の1色 + カメラワーク。
// 10 では 6〜9 を細かく分けていたが、保存した長い経路10本(neighborLimit 24)では 5件の輪を閉じられる候補さえ
// 30時点のうち2件で、7件以上は狙ってもまず届かない。誰も見ない色を作るより、段階を少なくして規則に気づいてもらいやすくする。
// 7件以上は 6件と同じ色・同じ演出で、長さの違いは左上の LOOP CLOSED // N NODES の数字で伝える。
// 最上位の色は 10 の 9件の色(青に近い色)。6 を最上位のままにするか 7 にするかは、11 の報告の数字を見て試用の後に決める
export const EGG_COLORS = {
  3: '#ffe23d', // 黄
  4: '#b4f03c', // 黄緑
  5: '#46e664', // 緑
  6: '#5a8cff', // 6 以上: 青に近い色(最上位)
}
// --- 演出の時間割(タスク11。SPEC 6.11)---------------------------------------
// 先に「人が気持ちよさや驚きを感じる時間」を決め、その中に見せる中身を割り当てる(時間割は eggMotion.js の eggTimeline)。
//   - 起きる頻度で長さを変える: 3〜5件はよく起きる(3件目以降の約4割の時点で3件の輪を閉じられる)ので、散歩を止めないよう短く(2.5秒以内)。
//     6件以上はめったに起きないご褒美なので長め(8秒以内)。操作への反応は約1秒までなら考えが途切れず、約10秒を超えると注意がよそへ移る
//   - 驚きは始まりの一瞬で決まる: 白一色の画面に一瞬で色が付き、ほんの少し止まる
//   - 気持ちよさはリズム(光が記事に届くたびの小さな波紋)・締め(一度だけの大きな波紋と、輪が揃って光る)・余韻(ゆっくり消える)で決まる
// どの長さも早送り(ドラッグ・ホイール・キー・ズームボタン)で終えられる。
//
// 3〜5件(合計 2300ms)
//   驚き 0〜150 … 一瞬で輪に色が付き、少し止まる。150ms は「何か起きた」と感じる間の短い方(0.1〜0.3秒)。長いと散歩が止まって感じる
export const EGG_SURPRISE_MS = 150
//   リズム 150〜1350 … 光が戻り先から輪を一周し、記事に届くたびに小さな波紋。1200ms で5件でも波紋の間隔が 0.24秒あり、1つずつ数えられる
export const EGG_LAP_MS = 1200
//   締め 1350〜1600 … 戻り先から大きな波紋、輪の線が揃って一度だけ光る、背景の円が内側から波のように光る。
//   250ms は締めの山を見届ける間。大きな波紋と光の減衰は余韻の中まで続く
export const EGG_FINALE_MS = 250
//   余韻 1600〜2300 … 色と明るさがゆっくり戻る。急に終わると安っぽく見えるので 0.5〜1秒の中ほど
export const EGG_AFTERGLOW_MS = 700
// 動きを減らす設定(prefers-reduced-motion)のとき: 光・波紋・走査線・文字の打ち込みを行わず、
// 驚き(EGG_SURPRISE_MS)→ 色を保つ(EGG_REDUCED_HOLD_MS)→ 余韻(EGG_AFTERGLOW_MS)だけにする
export const EGG_REDUCED_HOLD_MS = 900
// 光が通ったあとの線の明るさ(3〜5件。頂点の色の明るさ。1 が最大)。締めで揃って 1 まで光る余地を残すため 1 より下げる
export const EGG_LAP_LIT = 0.7
// 締めで揃って光るときの線の明るさ(最大)と、そこから元の明るさへ戻る時間(ms)。演出の中で一度だけ
export const EGG_EDGE_LIT = 1.0
export const EGG_FLASH_MS = 600
// 小さな波紋(光が記事に届くたび): 輪の色の中空のリングが、半径 EGG_RIPPLE_START_PX から EGG_RIPPLE_PX(= 直径 120px。指示書の上限)まで
// 勢いよく広がってゆっくり止まりながら(ease-out)、EGG_RIPPLE_MS で消える
export const EGG_RIPPLE_MS = 450
export const EGG_RIPPLE_START_PX = 8
export const EGG_RIPPLE_PX = 60
// 小さな波紋の上限: 1秒あたりに新しく出る数と、同時に出ている数。超える分は出さない(記事が灯るのはそのまま)。
// 点滅の決まり(1秒に3回まで)は画面の広い範囲の変化についてのもので、画面のごく狭い範囲の変化は数えない
// (WCAG 2.3.1 の「小さな安全な範囲」。1024×768 の画面で約 341×256px)。小さな波紋は1つ 120px 四方以内なので、
// 同時に 6つまで(合わせて約 290×290px 相当)に抑え、1秒あたりも 12 までにする(1つの記事では1秒に2回以下になる)
export const EGG_RIPPLE_MAX_PER_S = 12
export const EGG_RIPPLE_MAX_LIVE = 6
// 大きな波紋(締め。演出の中で一度だけ)。3〜5件は戻り先から画面上で半径 EGG_BIG_RIPPLE_PX まで広がる。
// 6件以上は輪の面の上に、重心から多角形の半径の EGG_BIG_RIPPLE_PLANE_RATIO 倍まで広がる平らなリング(斜め上から見ると楕円)
export const EGG_BIG_RIPPLE_MS = 900
export const EGG_BIG_RIPPLE_PX = 170
export const EGG_BIG_RIPPLE_PLANE_RATIO = 2.2
// 背景の円の波(3〜5件の締めだけ。一度だけ)。内側の円から EGG_GRID_WAVE_STEP_MS ずつ遅れて、
// それぞれ EGG_GRID_WAVE_RING_MS かけて不透明度を EGG_GRID_WAVE_BOOST だけ上げて戻す。
// 6件以上は、輪を並べ替えている間グリッドを薄くしていて、グリッドの中心(今の中心)が多角形の頂点の1つになるので使わない
export const EGG_GRID_WAVE_STEP_MS = 70
export const EGG_GRID_WAVE_RING_MS = 380
export const EGG_GRID_WAVE_BOOST = 0.35
// 輪全体が画面に収まっていないとき、カメラを引く上限(今の距離の倍率)と、画面の端から空ける余白(px)。
// 「小さく引く」だけにするため上限を付ける(向きは変えない)。スマホで前の中心が画面の外に出ることがあるため
export const EGG_FIT_MAX_RATIO = 1.8
export const EGG_FIT_PAD_PX = 28
// カメラを引く時間(ms)。IN のあいだに終わる長さにする
export const EGG_FIT_MS = 400

// --- 6件以上のカメラワーク(10b・10c・11)---
// 6件以上(合計 7000ms)
//   驚き 0〜300 … 一瞬で輪に色が付き、動きが止まる(力学を止める)。輪以外が薄くなり始める。
//     ご褒美の始まりなので 3〜5件より長く止めて、何か特別なことが起きたと感じる間を取る(0.1〜0.3秒の長い方)
export const EGG_CINE_SURPRISE_MS = 300
//   並べ替え 300〜1300 … 輪を正多角形に並べ替え、カメラが斜め上へ移る(10c。ゆっくり動き出してゆっくり止まる)
export const EGG_CINE_ARRANGE_MS = 1000
//   溜め 1300〜1800 … 輪の記事が戻り先から順に灯り、それぞれ小さな波紋を出す(一周の前の「構え」)
export const EGG_CINE_CHARGE_MS = 500
//   一周 1800〜5400 … カメラが一周し、光が輪を EGG_CINE_LAPS 周走る。1周目だけ記事に届くたびに小さな波紋、2周目からはなめらかに走らせる
export const EGG_CINE_ORBIT_MS = 3600
//   締め 5400〜6000 … 光が戻り先に戻った瞬間に、輪の面の上の大きな波紋・輪が揃って光る・走査線を一度だけ。左上の文字の打ち込みが始まる
export const EGG_CINE_FINALE_MS = 600
//   余韻 6000〜7000 … EGG_CINE_HOLD_MS 保ったあと、残りで輪を元の位置へ戻し(10c)、ほかの記事の明るさを戻す
export const EGG_CINE_AFTERGLOW_MS = 1000
export const EGG_CINE_HOLD_MS = 300
// 溜めより前の輪の記事の明るさ(色の倍率)。溜めで順に 1 まで灯る
export const EGG_NODE_UNLIT = 0.45
// 走査線(6件以上の締めだけ。一度だけ): 白い 1px の横線が、画面を上から下へ EGG_SCAN_MS で通り過ぎる(DOM の重ね表示)
export const EGG_SCAN_MS = 500
// 左上の LOOP CLOSED // N NODES を、EGG_TYPE_CHAR_MS ごとに1文字ずつ出す(端末風。6件以上の締めから)
export const EGG_TYPE_CHAR_MS = 30
// ORBIT のあいだに光が輪を回る回数。1周目は 10a と同じく線を順に明るくしていき、2周目からは光の頭だけが明るい。
// どの線も1周に1回だけ明るさの山が来るので、3周 / 3.6秒 = 0.83 回/秒(1秒間に3回までの安全の決まりを満たす。tests/egg.test.js)
export const EGG_CINE_LAPS = 3
// 光が通ったあとの線の明るさ(山と山のあいだ)。0 まで落とさないのは、明暗の差を小さくして点滅に見せないため
export const EGG_CINE_BASE = 0.55
// 光の尾の長さ(線の本数)。頭から離れるほど EGG_CINE_BASE へ指数で戻る
export const EGG_CINE_TAIL = 1.2

// --- カメラワークの前に輪を並べ替える(10c。2026-09-29 利用者の指示) ---
// 力学で決まった位置のままだと、輪の記事が一直線に近く並んだり近くに寄ったりして、どの角度から見ても輪の形にならない。
// 演出の間だけ輪を、重心を中心とする水平な面の上の正多角形に並べ替える(IN で動かし、OUT で記録した位置へ戻す)。
// 演出の間は力学を止め、戻してから再開する(戻る処理の後の配置を、並べ替えをしなかった場合と一致させるため)
//
// カメラが面を見下ろす角度(度)。指示書の 30〜40 度の中ほど。浅いと多角形がつぶれて見え、深いと回っても景色が変わらない
export const EGG_CINE_ELEV_DEG = 35
// 輪以外のノードと線(と背景グリッド)の明るさ(倍率)。ホバーの減光(×0.3)より強くして、ほぼ見えないところまで落とす。
// 値が小さいのは、three は描画の最後に色を sRGB に変換するので、暗い値ほど画面では明るく見えるため
// (0.06 では画面上で約 0.27 = #444 に見え、周りの線がはっきり残った。0.01 で約 0.1 = #1a1a1a)。
// 0 にしないのは、どこから来た輪なのかの手がかり(周りの記事の気配)を少しだけ残すため
export const EGG_CINE_DIM = 0.01
// 多角形とカメラの距離の決め方(polygonFitDistance): 多角形の大きさは今の輪の広がりのまま(重心からの平均距離)にし、
// カメラの距離の方を、一周のどの角度でも、頂点と横に出るラベルが画面の端から EGG_POLY_PAD_PX 内側に入る距離にする
// (遠近で手前の頂点が大きく見える分も、投影して確かめる)。
// 大きな画面では、重心の深さで見た半径が EGG_POLY_MAX_PX を超えない距離まで引く
// (輪が画面いっぱいに広がると、形より点の並びに見えるため)
export const EGG_POLY_PAD_PX = 24
export const EGG_POLY_MAX_PX = 240
// 上下は、画面に重ねて出している UI の分だけ余白を広げる(タスク11): 上は左上のステータス行(LOOP CLOSED // N NODES)、
// 下は左下のパンくずと右下のズームボタン。スマホの横画面で、手前に来た今の中心の名前がパンくずに重なったため
export const EGG_POLY_PAD_TOP_PX = 40
export const EGG_POLY_PAD_BOTTOM_PX = 56

// 輪の候補(今の中心の子のうち、2つ以上前に通った記事)の合図。球の明るさだけをゆっくり脈打たせる。
// 周期は今の中心の呼吸(BREATH_PERIOD_S = 3.2秒)と見分けがつくよう、はっきり短くした(1.6 倍の速さ)。
// それでも 0.5 回/秒なので、点滅の安全の決まり(1秒間に3回まで)からは十分に遠い
export const EGG_HINT_PERIOD_S = 2.0
// いちばん暗いときの明るさ(色の倍率)。半透明にせず色を暗くする(重なったときに奥が透けないように)。
// 控えめにするため、暗くしても半分までにとどめる
export const EGG_HINT_MIN = 0.5

// --- 画面上の見え方の測定 (SPEC 12.5。タスク06) ----------------------------
// ?debug=1 の window.__viz.measure() が使う「測る条件」。表示の調整値ではないので VizConfig には入れない
// (LEAD_EXTRA_MAX と同じ扱い)。値を変えると過去の基準値(docs/tasks/06-report-baseline.md)と比べられなくなる。

// 周回視点の数。中心を囲む球面上に均等に並べる(フィボナッチ球面)。
// 8 で上下・前後左右の偏りがおおむね均され、3経路 × 2画面 × 2プリセットでも数十秒で測り終わる
export const MEASURE_VIEWS = 8
// 落ち着くまで進める上限のステップ数。alphaDecay 0.99 なら約 420 ステップで ALPHA_MIN を下回るので、
// その7倍あれば通常は届く。届かないときは結果に「上限に達した」と出す
export const MEASURE_MAX_STEPS = 3000
// 中心付近の混み具合を数える半径(px)。背景グリッドの一番内側の円(GRID_RING_RADII_PX[0])と同じ
export const MEASURE_CROWD_RADIUS_PX = 60
// 指で押す前提の、隣の球との間隔(px)。一般的なタッチ操作の目安(44pt)。
// 指はマウスより大きく押す位置もずれるので、HIT_RADIUS_PX の2倍(32px)より広くとる
export const MEASURE_TOUCH_PAIR_PX = 44
// 回転中の点滅を測るとき、1ステップ(= 1/60 秒)で回す角度(度)。
// 2° だと1周 180 ステップ(3秒)で、手でゆっくり回したときに近い
export const MEASURE_ROTATE_STEP_DEG = 2
// 仮想画面(描画領域の CSS px)。App.css と src/utils/layoutMode.js から求めた値(タスク06 の着手前の報告)。
//   pc    … 1280×800・サイドバー開(wide)。幅 1280 − 340(--sidebar-width)、高さ 800 − 64(--topbar-height)
//   phone … 844×390 の横画面(short-landscape)・ドロワー閉。
//           ドロワーはグラフの上に重ねるので幅は減らない。高さ 390 − 44(低い横画面のトップバー)
// 実機ではアドレスバーの分だけ 100dvh が低くなることがあるが、ここでは端末の公称値で測る。
// App.css の値を変えたら合わせること(tests/screenMetrics.test.js で照合している)
export const MEASURE_VIEWPORTS = {
  pc: { width: 1280 - 340, height: 800 - 64, label: '1280×800・サイドバー開' },
  phone: { width: 844, height: 390 - 44, label: '844×390 横画面・ドロワー閉' },
}
