/**
 * ラベルの深さフェードの計算(SPEC 6.3)。Graph3D から切り出した純粋関数。
 * three に依存しないので node:test で直接確かめられる。
 */

/**
 * 深さの差 delta から、ラベルの不透明度に掛ける値(0〜1)を返す。
 *   delta ≤ start … 1
 *   start < delta < end … 線形に 1 → 0
 *   delta ≥ end … 0
 * end ≤ start のときは delta ≤ start で 1、それより奥は 0(境目で切り替わるだけ。壊れない)
 *
 * @param {number} delta depth(ノード) − depth(現在地)。正の値ほど現在地より奥
 */
export function depthFadeOf(delta, start, end) {
  if (delta <= start) return 1
  if (delta >= end) return 0
  return 1 - (delta - start) / (end - start)
}

/**
 * 深さで薄くなったラベルを、間引きの候補に残すか。
 * 出すとき(前回非表示)は show 以上、出し続けるとき(前回表示)は keep 以上で残す。
 * 基準を分けておくと、ちょうど境目にあるラベルが 200ms ごとに出たり消えたりしない
 */
export function keepsLabelCandidate(fadeTarget, wasVisible, show, keep) {
  return fadeTarget >= (wasVisible ? keep : show)
}

/**
 * value を target へ、最大 step だけ近づける(等速)。ラベルの出入りの進み具合に使う
 */
export function approach(value, target, step) {
  if (value < target) return Math.min(target, value + step)
  if (value > target) return Math.max(target, value - step)
  return value
}

/**
 * 0〜1 の進み具合を、ゆっくり始まってゆっくり終わる曲線にする(smoothstep)。
 * 指数補間(最初に一気に動いて最後にゆっくり止まる)だと出始めが急に見えるので、
 * ラベルの出入りはこちらで「ふわっと」させる
 */
export function smoothstep(t) {
  const x = Math.min(Math.max(t, 0), 1)
  return x * x * (3 - 2 * x)
}
