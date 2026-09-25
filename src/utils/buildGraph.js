/**
 * 訪問した記事の列(trail)から、画面に出すグラフを組み立て直す(純粋関数)。
 * もとは App.jsx にあった。線に種類と関連の強さを持たせるようになったので(SPEC 6.9)、
 * テストできるようにここへ切り出した。
 *
 * グラフを差分で足し引きするのではなく、毎回 trail から作り直している。
 * こうすると「戻る」が trail を短く切るだけで実現でき、
 * 進む/戻るのどちらでも同じ結果になることが保証される。
 *
 * 表示の方針(散歩の軌跡モデル):
 *   - 訪問した記事そのものは消さない … 歩いた軌跡になる
 *   - 直近 TRAIL_KEEP 件の訪問記事は、その子(リンク先)も出す … この先の選択肢
 *   - それより古い訪問記事の子は畳む … 選び終わった選択肢はもう要らない
 *
 * 線の種類:
 *   trail … 軌跡上で隣り合う中心同士。{ mutual, sharedCount } を持つ
 *   child … 中心 → その子。{ relScore, mutual } を持つ
 * 同じ2点を結ぶ場合(次の中心が前の中心の子だった場合)は、先に足す trail が残る
 */
import { TRAIL_KEEP } from '../constants.js'
import { sharedTitles } from './relation.js'

export function buildGraph(trail, expansions, viewsOf, config) {
  const nodeMap = new Map()
  const links = []
  const linkKeys = new Set()
  const trailSet = new Set(trail)

  const addNode = (id) => {
    if (nodeMap.has(id)) return
    nodeMap.set(id, {
      id,
      name: id,
      views: viewsOf.get(id) || 0,
      expanded: trailSet.has(id),
    })
  }

  const addLink = (source, target, props) => {
    if (source === target) return
    if (linkKeys.has(`${source}->${target}`)) return
    if (linkKeys.has(`${target}->${source}`)) return
    linkKeys.add(`${source}->${target}`)
    links.push({ source, target, ...props })
  }

  // trailEnabled=false なら軌跡を残さず、現在地とその子だけを出す
  const shown = config.trailEnabled ? trail : trail.slice(-1)

  // 歩いた経路そのもの
  for (const id of shown) addNode(id)
  for (let i = 0; i + 1 < shown.length; i++) {
    const from = shown[i]
    const to = shown[i + 1]
    addLink(from, to, {
      type: 'trail',
      // 後の中心が前の中心の子として記憶されていれば、その子の相互リンクの印を使う。
      // 1つ前の中心の子から進んだ・リダイレクトで名前が変わった場合は分からないので 0
      // (判定のためだけに Wikipedia へ問い合わせはしない)
      mutual: (expansions.get(from) || []).find((l) => l.title === to)?.mutual ? 1 : 0,
      sharedCount: sharedTitles(expansions.get(from), expansions.get(to), [from, to]).length,
    })
  }

  // 直近の訪問記事については、その先の選択肢も出す
  for (const id of shown.slice(-TRAIL_KEEP)) {
    for (const child of expansions.get(id) || []) {
      addNode(child.title)
      addLink(id, child.title, {
        type: 'child',
        relScore: child.relScore || 0,
        mutual: child.mutual ? 1 : 0,
      })
    }
  }

  return { nodes: Array.from(nodeMap.values()), links }
}
