/**
 * 画面上の見え方の測定(SPEC 12.5)で測る経路。
 * 行を足すだけで window.__viz.measure() の対象になる(key は measure({ routes: [...] }) で指定する名前)。
 *
 * sets はどの組で測るか。measure() は既定で 'default' の組を測る。
 *   default … 見え方の比較の基本(06 の3本 + coffee)
 *   tiers   … 中心同士の距離の段階(SPEC 6.9 の 1b)を確かめる組。段階ごとに2〜3経路。
 *             measure({ routes: 'tiers', presets: ['rev4'], viewports: ['pc'] }) で測る
 * tier は2つの中心の共通ワードの件数による段階(rev2 の重み・種 1 で実測。2026-09-27)
 *
 * seed は抽選と初期配置の種。比べるプリセットすべてにこの値を使う
 * (プリセットの seed が違っても、同じ展開結果・同じ初期配置で比べられるように)
 */
export const BENCH_ROUTES = [
  {
    key: 'work',
    sets: ['default', 'tiers'],
    start: '初音ミク',
    path: ['鏡音リン・レン'],
    seed: 1,
    // 作品内。子の相互リンクが飽和し、共通ワードが多い(タスク05 で共通15件)
    note: '作品内',
  },
  {
    key: 'science',
    sets: ['default', 'tiers'],
    start: '流体力学',
    path: ['マグネシウム', 'ウラン'],
    seed: 1,
    // 分野をまたぐ。中心同士の手がかりが少ない(タスク05 で共通8件・なし)
    note: '分野をまたぐ',
  },
  {
    key: 'voice',
    sets: ['default', 'tiers'],
    start: '綾波レイ',
    path: ['林原めぐみ'],
    seed: 1,
    // 作品の外の強い関係(タスク01 で声優が確定枠に入った組)
    note: '作品の外の強い関係',
  },
  {
    key: 'coffee',
    sets: ['default', 'tiers'],
    start: 'コーヒー',
    path: ['カフェイン'],
    seed: 1,
    // 中心同士の共通ワードが中くらい(5件。段階 mid)。タスク07 で中心同士の距離の段階を確かめるために足した。
    // 既存の3本は none(流体力学→マグネシウム)・few(綾波レイ→林原めぐみ 1件)・many の組しかなかった
    note: '共通ワードが中くらい(mid)',
  },
  // --- 段階の確認用(tiers)。どれも2件目は1件目の子で、クリックで進める ---
  { key: 'none-air', sets: ['tiers'], start: '流体力学', path: ['空気力学'], seed: 1, note: 'none(共通 0件)' },
  { key: 'none-choco', sets: ['tiers'], start: 'コーヒー', path: ['チョコレート'], seed: 1, note: 'none(共通 0件)' },
  { key: 'few-fuji', sets: ['tiers'], start: '富士山', path: ['静岡県'], seed: 1, note: 'few(共通 1件)' },
  { key: 'few-fair', sets: ['tiers'], start: 'コーヒー', path: ['フェアトレードコーヒー'], seed: 1, note: 'few(共通 3件。上端)' },
  { key: 'mid-photo', sets: ['tiers'], start: '光合成', path: ['葉緑体'], seed: 1, note: 'mid(共通 6件)' },
  { key: 'mid-shogi', sets: ['tiers'], start: '将棋', path: ['羽生善治'], seed: 1, note: 'mid(共通 4件。下端)' },
  { key: 'many-tsuina', sets: ['tiers'], start: '鏡音リン・レン', path: ['ついなちゃん'], seed: 1, note: 'many(共通 8件。下端)' },
  { key: 'many-american', sets: ['tiers'], start: 'コーヒー', path: ['アメリカン・コーヒー'], seed: 1, note: 'many(共通 13件)' },
]

/** 組の名前(default / tiers / all)か key の配列から、測る経路の key の配列にする */
export function routeKeysOf(routes = 'default') {
  if (Array.isArray(routes)) return routes
  if (routes === 'all') return BENCH_ROUTES.map((r) => r.key)
  return BENCH_ROUTES.filter((r) => r.sets.includes(routes)).map((r) => r.key)
}
