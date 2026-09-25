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
