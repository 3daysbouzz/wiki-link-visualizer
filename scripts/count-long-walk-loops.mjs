/**
 * 保存した長い経路(tests/fixtures/long-walk-routes.json)で、長さ別の輪の起きやすさを数え、Markdown の表にして出す(タスク11)。
 * 結果は docs/tasks/11-report-loops.md に貼る。Wikipedia には問い合わせない
 *
 *   node scripts/count-long-walk-loops.mjs
 */
import fs from 'node:fs'
import { loopOpportunities } from '../src/debug/walks.js'

const walks = JSON.parse(fs.readFileSync(new URL('../tests/fixtures/long-walk-routes.json', import.meta.url), 'utf8'))
const BUCKETS = ['3', '4', '5', '6', '7以上']
const bucketOf = (len) => (len >= 7 ? '7以上' : String(len))

function count(limit, filter = () => true) {
  const steps = { total: 0, any: 0 }
  const atSteps = Object.fromEntries(BUCKETS.map((b) => [b, 0]))
  const cands = Object.fromEntries(BUCKETS.map((b) => [b, 0]))
  let six = { steps: 0, cands: 0 }
  let seven = { steps: 0, cands: 0 }
  let routes = 0
  const perRoute = []
  for (const [key, { mode, trail, expansions }] of Object.entries(walks)) {
    if (!filter(mode)) continue
    routes++
    const ops = loopOpportunities(trail, new Map(Object.entries(expansions)), limit)
    const row = []
    for (const op of ops) {
      steps.total++
      if (op.candidates.length > 0) steps.any++
      const lens = op.candidates.map((c) => c.length)
      for (const b of BUCKETS) if (lens.some((l) => bucketOf(l) === b)) atSteps[b]++
      for (const l of lens) cands[bucketOf(l)]++
      if (lens.some((l) => l >= 6)) six.steps++
      if (lens.some((l) => l >= 7)) seven.steps++
      six.cands += lens.filter((l) => l >= 6).length
      seven.cands += lens.filter((l) => l >= 7).length
      row.push(lens.length ? lens.sort((a, b) => a - b).join('・') : '-')
    }
    perRoute.push({ key, centers: trail.length, row })
  }
  return { routes, steps, atSteps, cands, six, seven, perRoute }
}

const lines = []
for (const [label, filter] of [
  ['2種類の合計', () => true],
  ['top(毎回いちばん関連が強い子へ)', (m) => m === 'top'],
  ['draw(毎回、抽選の枠からいちばん順位が高い子へ)', (m) => m === 'draw'],
]) {
  lines.push(`### ${label}`, '')
  lines.push('| neighborLimit | 経路 | 時点(3件目以降) | 輪を閉じられる時点 | 3 | 4 | 5 | 6 | 7以上 | **6以上** | **7以上** |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|')
  for (const limit of [24, 40]) {
    const r = count(limit, filter)
    const cell = (b) => `${r.atSteps[b]} / ${r.cands[b]}`
    lines.push(
      `| ${limit}${limit === 24 ? '(rev5)' : '(参考)'} | ${r.routes} | ${r.steps.total} | ${r.steps.any} | ${BUCKETS.map(cell).join(' | ')} | **${r.six.steps} / ${r.six.cands}** | **${r.seven.steps} / ${r.seven.cands}** |`
    )
  }
  lines.push('')
}
lines.push('### 経路ごと(neighborLimit 24。各時点で閉じられる輪の長さ。- は無し)', '')
lines.push('| 経路 | 中心 | 3件目 | 4件目 | 5件目 | 6件目 | 7件目 | 8件目 |')
lines.push('|---|---|---|---|---|---|---|---|')
for (const p of count(24).perRoute) {
  const cells = Array.from({ length: 6 }, (_, i) => p.row[i] ?? '')
  lines.push(`| ${p.key} | ${p.centers} | ${cells.join(' | ')} |`)
}
console.log(lines.join('\n'))
