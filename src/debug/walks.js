/**
 * 長い経路の歩き方(タスク09・11)。保存した展開結果から、同じ経路を毎回同じように作り直すための純粋関数。
 * 輪の起きやすさを数える経路(docs/tasks/11-report-loops.md)と、その回帰テスト(tests/walks.test.js)が使う。
 *
 * 歩き方は2種類(09 と同じ):
 *   top  … 毎回、まだ通っていない子のうち、関連スコアがいちばん高い記事へ進む
 *   draw … 毎回、抽選の枠から出た子(展開結果の 11位以降。neighborLimit 24 なら 11〜24位)のうち、
 *           まだ通っていない、いちばん順位が高い(関連スコアが高い)記事へ進む
 * どちらも neighborLimit(既定 24 = rev5)件目までの子から選ぶ。同じ関連スコアなら展開結果の順(先の方)を選ぶ
 */
import { GUARANTEED_TOP } from '../constants.js'
import { loopCandidates } from '../utils/relation.js'

/**
 * 経路の各時点(3件目以降)で閉じられる輪(タスク11 の報告)。表示の合図と同じ loopCandidates で数える。
 * 子は neighborLimit(limit)件目までに切り詰める(同じ種なら、件数を減らした抽選は多い件数の抽選の先頭と同じ。09)
 * @param {string[]} trail
 * @param {Map<string, {title:string}[]>} expansions
 * @returns {{at:string, candidates:{title:string, length:number}[]}[]}
 */
export function loopOpportunities(trail, expansions, limit = 24) {
  const cut = new Map([...expansions].map(([k, v]) => [k, v.slice(0, limit)]))
  const out = []
  for (let k = 2; k < trail.length; k++) {
    const shown = trail.slice(0, k + 1)
    const candidates = loopCandidates(shown, cut).map((title) => ({ title, length: k - shown.indexOf(title) + 1 }))
    out.push({ at: trail[k], candidates })
  }
  return out
}

/**
 * 次に進む記事。候補が無ければ null
 * @param {{title:string, relScore?:number}[]} children 今の中心の展開結果(確定枠 → 抽選枠の順)
 * @param {Set<string>} visited これまでに通った記事
 * @param {'top'|'draw'} mode
 */
export function nextWalkStep(children, visited, mode, limit = 24) {
  let best = null
  const list = children.slice(0, limit)
  for (let i = mode === 'draw' ? GUARANTEED_TOP : 0; i < list.length; i++) {
    const c = list[i]
    if (visited.has(c.title)) continue
    if (!best || (c.relScore || 0) > (best.relScore || 0)) best = c
  }
  return best ? best.title : null
}

/**
 * 保存した展開結果(記事名 → 展開結果)で、start から centers 件の中心になるまで歩いた経路。
 * 展開結果が無い記事に来たら、そこで止める
 * @param {Map<string, {title:string, relScore?:number}[]>} expansions
 * @returns {string[]}
 */
export function walkRoute(start, expansions, mode, centers, limit = 24) {
  const trail = [start]
  while (trail.length < centers) {
    const children = expansions.get(trail[trail.length - 1])
    if (!children) break
    const next = nextWalkStep(children, new Set(trail), mode, limit)
    if (!next) break
    trail.push(next)
  }
  return trail
}
