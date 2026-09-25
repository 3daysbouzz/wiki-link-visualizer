/**
 * 表示パラメータ(VizConfig)とプリセット。
 *
 * UI の調整は試行回数が多い。コードを書き換えずに設定を切り替えて
 * 同じ経路を並べて比較できるよう、表示に関わる値はここに集める。
 * URL クエリ(?preset=mesh&nodeLimit=64)で個別に上書きできる(src/config/urlState.js)。
 *
 * 'current' は比較の基準。回帰確認用なので削除しないこと。
 * **current の値は src/constants.js の既定値と完全に一致させること。**
 * ずれると「プリセットを変えていないのに配置が変わる」ことになり、比較の土台が壊れる。
 */

import {
  REPULSION,
  REPULSION_RANGE,
  SPRING_K,
  SPRING_LENGTH,
  CENTER_K,
  DAMPING,
  ALPHA_DECAY,
  VISIBLE_LABELS,
  EDGE_PRIMARY_OPACITY,
  EDGE_WEAK_OPACITY,
  FOLLOW_LERP,
  W_MORELIKE,
  W_MUTUAL,
  W_LEAD,
  MORE_BATCH,
  MORE_MAX,
  LABEL_DEPTH_FADE,
  LABEL_FADE_START,
  LABEL_FADE_END,
} from '../constants.js'

export type EdgeMode = 'radial' | 'induced'
export type ColorMode = 'mono' | 'category'

export interface VizConfig {
  /** 画面に出すノード数の上限。Phase 2 で間引きに使う(Phase 0 では記録のみ) */
  nodeLimit: number
  /** 1記事から展開するリンク数(旧 MAX_LINKS) */
  neighborLimit: number
  /** 'radial' = 現在地→隣接の線だけ / 'induced' = 表示中ノード同士の全リンク(Phase 1) */
  edgeMode: EdgeMode
  /** 'mono' = 白のみ / 'category' = カテゴリで色相(Phase 3) */
  colorMode: ColorMode
  /** 歩いた軌跡(訪問済みノードとその子)を残すか */
  trailEnabled: boolean
  /** レイアウトと抽選の乱数の種。同じ種なら同じ配置・同じ顔ぶれになる */
  seed: number

  // --- 力学レイアウト(layout) -------------------------------------------
  // 変更するとシミュレーションを再開する(配置は作り直さない)
  /** ノード同士が押し合う強さ。大きいほど広がる */
  repulsion: number
  /** 反発を計算する距離の上限 */
  repulsionRange: number
  /** リンクのバネの硬さ */
  springK: number
  /** バネの自然長(隣接ノードの狙いの距離) */
  springLength: number
  /** 原点へ引き戻す力 */
  centerK: number
  /** 速度の減衰(0〜1) */
  damping: number
  /** alpha の減衰率。小さいほど早く収束する */
  alphaDecay: number

  // --- 見た目(visual) ---------------------------------------------------
  // 変更しても配置には影響しない(描画だけが変わる)
  /** 同時に表示するラベルの最大数 */
  visibleLabels: number
  /** 実線(起点↔一次)の不透明度 */
  edgePrimaryOpacity: number
  /** 破線(弱いエッジ)の不透明度 */
  edgeWeakOpacity: number
  /** カメラ追従の追いつき速度。1 に近いほど機敏 */
  followLerp: number
  /** 現在地より奥のラベルを深さに応じて薄くするか(SPEC 6.3) */
  labelDepthFade: boolean
  /** 薄くし始める深さの差(ワールド座標。現在地より奥が正) */
  fadeStart: number
  /** 見えなくなる深さの差 */
  fadeEnd: number

  // --- 関連リンクの順位付け(ranking) -----------------------------------
  // 変更は次に展開する記事から効く(記憶済みの展開結果は変えない)。SPEC 3.3
  /** morelike 順位の重み */
  wMorelike: number
  /** 相互リンク(候補→中心のリンクもある)の加点 */
  wMutual: number
  /** 冒頭リンク(中心記事のリード文・インフォボックスにある)の加点 */
  wLead: number
  /** 追加表示(中心クリック / + MORE)1回で足す件数。次に追加するときから効く */
  moreBatch: number
  /** 1記事あたりの追加の上限 */
  moreMax: number
}

/**
 * rev2 の順位付けの重み。
 * 相互リンクは「互いに主要な関係」の強い手がかりなので高め(0.8 = morelike 5位相当)、
 * 冒頭リンクは記事の要点に出てくるが汎用語(国名・「漫画」など)も混ざるので、それより低くする。
 *
 * wLead は指示書の 0.4 から 0.6 に上げた(2026-09-25 利用者と合意)。
 * 作品内の記事は登場人物も作品名もほぼ全員が相互リンクなので、相互リンクの加点は
 * 上位で差を生まず、声優を押し上げるのは実質的に冒頭リンクだけだった。
 * 0.4 ではキャラクター記事5件のどれでも声優が確定枠(上位10件)に届かず、
 * 0.6 で4件が入った。詳細は docs/tasks/01-report-relevance-score.md
 */
const REV2_RANKING = { wMorelike: 1.0, wMutual: 0.8, wLead: 0.6 }

/** rev2 のラベルの深さフェード。current はオフ(従来の見た目を保つ) */
const REV2_LABELS = {
  labelDepthFade: true,
  fadeStart: LABEL_FADE_START,
  fadeEnd: LABEL_FADE_END,
}

export const PRESETS: Record<string, VizConfig> = {
  // 今の見た目をそのまま再現する基準。消さないこと
  current: {
    nodeLimit: 300,
    neighborLimit: 40,
    edgeMode: 'radial',
    colorMode: 'mono',
    trailEnabled: true,
    seed: 1,
    repulsion: REPULSION,
    repulsionRange: REPULSION_RANGE,
    springK: SPRING_K,
    springLength: SPRING_LENGTH,
    centerK: CENTER_K,
    damping: DAMPING,
    alphaDecay: ALPHA_DECAY,
    visibleLabels: VISIBLE_LABELS,
    edgePrimaryOpacity: EDGE_PRIMARY_OPACITY,
    edgeWeakOpacity: EDGE_WEAK_OPACITY,
    followLerp: FOLLOW_LERP,
    labelDepthFade: LABEL_DEPTH_FADE,
    fadeStart: LABEL_FADE_START,
    fadeEnd: LABEL_FADE_END,
    wMorelike: W_MORELIKE,
    wMutual: W_MUTUAL,
    wLead: W_LEAD,
    moreBatch: MORE_BATCH,
    moreMax: MORE_MAX,
  },
  // rev2 の既定。current に関連スコアの加点(相互リンク・冒頭リンク)を足したもの。
  // 力学・見た目の値は current と同じ(順位付けの違いだけを比べられるように)
  rev2: {
    nodeLimit: 300,
    neighborLimit: 40,
    edgeMode: 'radial',
    colorMode: 'mono',
    trailEnabled: true,
    seed: 1,
    repulsion: REPULSION,
    repulsionRange: REPULSION_RANGE,
    springK: SPRING_K,
    springLength: SPRING_LENGTH,
    centerK: CENTER_K,
    damping: DAMPING,
    alphaDecay: ALPHA_DECAY,
    visibleLabels: VISIBLE_LABELS,
    edgePrimaryOpacity: EDGE_PRIMARY_OPACITY,
    edgeWeakOpacity: EDGE_WEAK_OPACITY,
    followLerp: FOLLOW_LERP,
    ...REV2_LABELS,
    ...REV2_RANKING,
    moreBatch: MORE_BATCH,
    moreMax: MORE_MAX,
  },
  // ネットワークに見せるための設定(Phase 1 以降で本領を発揮する)
  mesh: {
    nodeLimit: 48,
    neighborLimit: 18,
    edgeMode: 'induced',
    colorMode: 'mono',
    trailEnabled: true,
    seed: 1,
    repulsion: REPULSION,
    repulsionRange: REPULSION_RANGE,
    springK: SPRING_K,
    springLength: SPRING_LENGTH,
    centerK: CENTER_K,
    damping: DAMPING,
    alphaDecay: ALPHA_DECAY,
    visibleLabels: VISIBLE_LABELS,
    edgePrimaryOpacity: EDGE_PRIMARY_OPACITY,
    edgeWeakOpacity: EDGE_WEAK_OPACITY,
    followLerp: FOLLOW_LERP,
    ...REV2_LABELS,
    ...REV2_RANKING,
    moreBatch: MORE_BATCH,
    moreMax: MORE_MAX,
  },
}

// 何も指定しないときのプリセット。rev2 の改善を既定にし、
// current は ?preset=current で従来の見た目と比べるために残す
export const DEFAULT_PRESET = 'rev2'

/**
 * 数値項目の範囲。leva のスライダーの端にもそのまま使う。
 *
 * 上限・下限の決め方:
 *   「この外に出すと比較にならない(発散する・描画が壊れる)」ところを境にしている。
 *   好みの範囲を狭く切ると調整の幅が減るので、危ない手前までは許す方針。
 *
 *   repulsion      0 で反発なし(全ノードが中心に固まる)。20000 を超えると
 *                  画面外へ飛び、ズームしても何も見えなくなる
 *   repulsionRange 小さいほど速いが、0 にすると反発が一切効かない。
 *                  上限は SPAWN_SPREAD の数倍あれば十分
 *   springK        0.2 を超えるとバネが強すぎて振動が止まらない(発散する)
 *   springLength   0 だと隣接ノードが完全に重なる。上限は画面に収まる範囲
 *   centerK        0 にすると全体が際限なく広がる。0.2 を超えると中心に潰れる
 *   damping        1 以上だと減速せず発散する。0 だと即座に止まって動かない。
 *                  0.99 を上限にして「絶対に発散しない」側に倒している
 *   alphaDecay     1 以上だと永久に収束しない。小さすぎると動く前に止まる
 *   followLerp     1 でカメラが瞬間移動する。0 だと追従しない
 *   fadeStart/End  深さの差(ワールド座標)。負にすると現在地より手前から薄くなる。
 *                  グラフの広がり(SPAWN_SPREAD・springLength)の数倍あれば十分。
 *                  fadeEnd ≤ fadeStart でも壊れない(その深さを境に表示/非表示が切り替わる)
 *   wMorelike 等   0 で その要素を無視。上限 2 は morelike 1位(1.0)の2倍まで。
 *                  それ以上は1つの要素だけで順位が決まり、比べる意味がなくなる
 *   moreBatch      0 だと追加できない。上限は POOL_SIZE の範囲で一度に出して意味のある量
 *   moreMax        0 で追加なし。上限は候補プール(POOL_SIZE=150)を超えない
 */
export const RANGES: Record<string, { min: number; max: number; step?: number }> = {
  nodeLimit: { min: 8, max: 1000 },
  neighborLimit: { min: 1, max: 150 },
  seed: { min: 0, max: 2147483647 },
  repulsion: { min: 0, max: 20000, step: 50 },
  repulsionRange: { min: 20, max: 1200, step: 10 },
  springK: { min: 0, max: 0.2, step: 0.001 },
  springLength: { min: 1, max: 400, step: 1 },
  centerK: { min: 0, max: 0.2, step: 0.001 },
  damping: { min: 0.5, max: 0.99, step: 0.01 },
  alphaDecay: { min: 0.9, max: 0.999, step: 0.001 },
  visibleLabels: { min: 0, max: 200 },
  edgePrimaryOpacity: { min: 0, max: 1, step: 0.05 },
  edgeWeakOpacity: { min: 0, max: 1, step: 0.05 },
  followLerp: { min: 0.005, max: 1, step: 0.005 },
  fadeStart: { min: -200, max: 400, step: 5 },
  fadeEnd: { min: -195, max: 800, step: 5 },
  wMorelike: { min: 0, max: 2, step: 0.05 },
  wMutual: { min: 0, max: 2, step: 0.05 },
  wLead: { min: 0, max: 2, step: 0.05 },
  moreBatch: { min: 1, max: 40 },
  moreMax: { min: 0, max: 150 },
}

/** 力学に関わる項目。変えたらシミュレーションを再開する(配置は作り直さない) */
export const LAYOUT_KEYS = [
  'repulsion',
  'repulsionRange',
  'springK',
  'springLength',
  'centerK',
  'damping',
  'alphaDecay',
] as const

/**
 * 関連リンクの順位付けの重みと、追加表示の件数。
 * 重みは次に展開する記事から、件数は次に追加するときから効く
 */
export const RANKING_KEYS = ['wMorelike', 'wMutual', 'wLead', 'moreBatch', 'moreMax'] as const

/** 見た目だけの項目。変えても配置は動かない */
export const VISUAL_KEYS = [
  'visibleLabels',
  'edgePrimaryOpacity',
  'edgeWeakOpacity',
  'followLerp',
  'labelDepthFade',
  'fadeStart',
  'fadeEnd',
] as const

/** URL や leva から来た値を VizConfig の型に揃える。不正な値は base の値を使う */
export function coerceConfig(
  base: VizConfig,
  raw: Partial<Record<keyof VizConfig, unknown>>
): VizConfig {
  const int = (v: unknown, fallback: number, min: number, max: number) => {
    const n = typeof v === 'number' ? v : parseInt(String(v), 10)
    if (!Number.isFinite(n)) return fallback
    return Math.min(Math.max(Math.round(n), min), max)
  }
  /**
   * 小数を受ける版。力学のパラメータは 0.012 のような小数なので、
   * parseInt だと 0 に潰れてしまう。
   * 数値として読めない値・NaN・Infinity は base の値に戻し、範囲外は端に丸める
   */
  const float = (v: unknown, fallback: number, min: number, max: number) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v))
    if (!Number.isFinite(n)) return fallback
    return Math.min(Math.max(n, min), max)
  }
  const bool = (v: unknown, fallback: boolean) => {
    if (typeof v === 'boolean') return v
    if (v === undefined || v === null) return fallback
    const s = String(v).toLowerCase()
    if (s === '1' || s === 'true' || s === 'on') return true
    if (s === '0' || s === 'false' || s === 'off') return false
    return fallback
  }
  const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
    list.includes(v as T) ? (v as T) : fallback

  const r = RANGES

  return {
    nodeLimit: int(raw.nodeLimit, base.nodeLimit, r.nodeLimit.min, r.nodeLimit.max),
    neighborLimit: int(
      raw.neighborLimit,
      base.neighborLimit,
      r.neighborLimit.min,
      r.neighborLimit.max
    ),
    edgeMode: oneOf(raw.edgeMode, ['radial', 'induced'] as const, base.edgeMode),
    colorMode: oneOf(raw.colorMode, ['mono', 'category'] as const, base.colorMode),
    trailEnabled: bool(raw.trailEnabled, base.trailEnabled),
    seed: int(raw.seed, base.seed, r.seed.min, r.seed.max),

    repulsion: float(raw.repulsion, base.repulsion, r.repulsion.min, r.repulsion.max),
    repulsionRange: float(
      raw.repulsionRange,
      base.repulsionRange,
      r.repulsionRange.min,
      r.repulsionRange.max
    ),
    springK: float(raw.springK, base.springK, r.springK.min, r.springK.max),
    springLength: float(
      raw.springLength,
      base.springLength,
      r.springLength.min,
      r.springLength.max
    ),
    centerK: float(raw.centerK, base.centerK, r.centerK.min, r.centerK.max),
    damping: float(raw.damping, base.damping, r.damping.min, r.damping.max),
    alphaDecay: float(raw.alphaDecay, base.alphaDecay, r.alphaDecay.min, r.alphaDecay.max),

    visibleLabels: int(
      raw.visibleLabels,
      base.visibleLabels,
      r.visibleLabels.min,
      r.visibleLabels.max
    ),
    edgePrimaryOpacity: float(
      raw.edgePrimaryOpacity,
      base.edgePrimaryOpacity,
      r.edgePrimaryOpacity.min,
      r.edgePrimaryOpacity.max
    ),
    edgeWeakOpacity: float(
      raw.edgeWeakOpacity,
      base.edgeWeakOpacity,
      r.edgeWeakOpacity.min,
      r.edgeWeakOpacity.max
    ),
    followLerp: float(raw.followLerp, base.followLerp, r.followLerp.min, r.followLerp.max),
    labelDepthFade: bool(raw.labelDepthFade, base.labelDepthFade),
    fadeStart: float(raw.fadeStart, base.fadeStart, r.fadeStart.min, r.fadeStart.max),
    fadeEnd: float(raw.fadeEnd, base.fadeEnd, r.fadeEnd.min, r.fadeEnd.max),

    wMorelike: float(raw.wMorelike, base.wMorelike, r.wMorelike.min, r.wMorelike.max),
    wMutual: float(raw.wMutual, base.wMutual, r.wMutual.min, r.wMutual.max),
    wLead: float(raw.wLead, base.wLead, r.wLead.min, r.wLead.max),
    moreBatch: int(raw.moreBatch, base.moreBatch, r.moreBatch.min, r.moreBatch.max),
    moreMax: int(raw.moreMax, base.moreMax, r.moreMax.min, r.moreMax.max),
  }
}
