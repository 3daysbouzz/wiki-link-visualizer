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
  },
}

export const DEFAULT_PRESET = 'current'

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

/** 見た目だけの項目。変えても配置は動かない */
export const VISUAL_KEYS = [
  'visibleLabels',
  'edgePrimaryOpacity',
  'edgeWeakOpacity',
  'followLerp',
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
  }
}
