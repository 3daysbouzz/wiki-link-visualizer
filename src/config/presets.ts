/**
 * 表示パラメータ(VizConfig)とプリセット。
 *
 * UI の調整は試行回数が多い。コードを書き換えずに設定を切り替えて
 * 同じ経路を並べて比較できるよう、表示に関わる値はここに集める。
 * URL クエリ(?preset=mesh&nodeLimit=64)で個別に上書きできる(src/config/urlState.js)。
 *
 * 'current' は比較の基準。回帰確認用なので削除しないこと。
 */

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
  },
  // ネットワークに見せるための設定(Phase 1 以降で本領を発揮する)
  mesh: {
    nodeLimit: 48,
    neighborLimit: 18,
    edgeMode: 'induced',
    colorMode: 'mono',
    trailEnabled: true,
    seed: 1,
  },
}

export const DEFAULT_PRESET = 'current'

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

  return {
    nodeLimit: int(raw.nodeLimit, base.nodeLimit, 8, 1000),
    neighborLimit: int(raw.neighborLimit, base.neighborLimit, 1, 150),
    edgeMode: oneOf(raw.edgeMode, ['radial', 'induced'] as const, base.edgeMode),
    colorMode: oneOf(raw.colorMode, ['mono', 'category'] as const, base.colorMode),
    trailEnabled: bool(raw.trailEnabled, base.trailEnabled),
    seed: int(raw.seed, base.seed, 0, 2147483647),
  }
}
