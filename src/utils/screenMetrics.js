/**
 * 画面上の見え方の測定(SPEC 12.5。タスク06)で使う、小さな計算の集まり。
 * three にもブラウザにも依存しないので node:test で直接確かめられる。
 * 測る手順そのもの(展開・配置・視点を回す)は src/debug/measure.js にある。
 */

/** 順位付けに効く値。これが違うプリセット同士は顔ぶれが変わるので比べない */
export const RANKING_KEYS = ['wMorelike', 'wMutual', 'wLead', 'neighborLimit', 'seed']

/**
 * プリセットの順位付けに効く値がすべて同じかを確かめ、違えばエラーを投げる
 * (顔ぶれの違う展開結果を黙って比べないため)。
 * @param {{name:string, config:object}[]} named
 */
export function assertSameRanking(named) {
  if (named.length === 0) return
  const base = named[0]
  for (const other of named.slice(1)) {
    const diff = RANKING_KEYS.filter((k) => base.config[k] !== other.config[k])
    if (diff.length > 0) {
      const detail = diff
        .map((k) => `${k}: ${base.name}=${base.config[k]} / ${other.name}=${other.config[k]}`)
        .join(', ')
      throw new Error(
        `[measure] ${base.name} と ${other.name} は順位付けに効く値が違うので、同じ展開結果で比べられません(${detail})`
      )
    }
  }
}

/** 中央値。空なら null */
export function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * ピアソンの相関係数。組が2つ未満、またはどちらかのばらつきが 0 なら null
 * (タスク05 の −0.75 の計算方法は記録が残っていないので、ピアソンで出す)
 */
export function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return null
  let mx = 0
  let my = 0
  for (let i = 0; i < n; i++) {
    mx += xs[i]
    my += ys[i]
  }
  mx /= n
  my /= n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx
    const dy = ys[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

/** a / b。どちらかが null か b が 0 なら null */
export function ratio(a, b) {
  if (a === null || b === null || b === 0) return null
  return a / b
}

/**
 * center から radius 以内(境界を含む)にある点の数。
 * @param {{x:number,y:number}} center
 * @param {{x:number,y:number}[]} points
 */
export function countWithin(center, points, radius) {
  let count = 0
  for (const p of points) {
    if (Math.hypot(p.x - center.x, p.y - center.y) <= radius) count += 1
  }
  return count
}

/**
 * 画面上の間隔が threshold 未満の組を数える。centerId を含む組は別に数える
 * (中心のタップは追加表示なので、隣の球と取り違えると困るため)。
 * @param {{id:string, x:number, y:number}[]} points
 * @returns {{pairs:number, centerPairs:number}} pairs は中心を含まない組の数
 */
export function closePairs(points, threshold, centerId) {
  let pairs = 0
  let centerPairs = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    for (let j = i + 1; j < points.length; j++) {
      const b = points[j]
      if (Math.hypot(a.x - b.x, a.y - b.y) >= threshold) continue
      if (a.id === centerId || b.id === centerId) centerPairs += 1
      else pairs += 1
    }
  }
  return { pairs, centerPairs }
}

/**
 * 「消えてから windowMs 以内に再表示」の回数を数える(タスク03 の点滅の確認と同じ数え方)。
 * update(now, selectedIds) をラベルを選び直すたびに呼ぶ。
 * 選ばれていた → 外れた時刻を覚え、再び選ばれたときに windowMs 以内なら1回と数える
 */
export function createFlickerCounter(windowMs) {
  let prev = new Set()
  const lostAt = new Map()
  let flickers = 0
  let updates = 0
  return {
    update(now, selectedIds) {
      const next = new Set(selectedIds)
      updates += 1
      for (const id of prev) {
        if (!next.has(id)) lostAt.set(id, now)
      }
      for (const id of next) {
        if (prev.has(id)) continue
        const t = lostAt.get(id)
        if (t !== undefined && now - t <= windowMs) flickers += 1
        lostAt.delete(id)
      }
      prev = next
    },
    get flickers() {
      return flickers
    },
    get updates() {
      return updates
    },
  }
}

/**
 * 表示と同じ間隔でラベルを選び直すかを決める。
 * 表示は「前回から LABEL_UPDATE_INTERVAL_MS を超えたら」選び直すので(> であって ≥ ではない)、
 * ちょうど 60fps なら 200ms ではなく 13 フレームごと(約217ms)になる。それに合わせる
 */
export function shouldReselect(now, last, intervalMs) {
  return now - last > intervalMs
}

/**
 * 周回視点ごとの値から平均と最悪値を出す。
 * worstOf は項目名 → 'max' | 'min'(どちらが悪いか)。null の値は除く
 * @param {object[]} perView 各視点の平らな値({ 項目名: 数値 | null })
 */
export function summarizeViews(perView, worstOf) {
  const mean = {}
  const worst = {}
  for (const key of Object.keys(worstOf)) {
    const values = perView.map((v) => v[key]).filter((x) => x !== null && x !== undefined)
    if (values.length === 0) {
      mean[key] = null
      worst[key] = null
      continue
    }
    mean[key] = values.reduce((a, b) => a + b, 0) / values.length
    worst[key] = worstOf[key] === 'max' ? Math.max(...values) : Math.min(...values)
  }
  return { mean, worst }
}

/** 数値を小数点以下 digits 桁に丸める(null はそのまま)。出力を読みやすくするため */
export function round(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return value ?? null
  const f = 10 ** digits
  return Math.round(value * f) / f
}
