/**
 * サイドバーに出す記事の情報(プレビュー + メタ情報)をまとめて取る。SPEC 6.2・3.6e。
 *
 * App の useEffect から切り出したもの。「待機中に取り消したものを失敗として保存しない」決まりを
 * テストで確かめられるようにするため(tests/wikipedia.test.js)。
 *
 * - 取れた結果は、失敗(null)も含めて caches に保存する(補助情報なので、失敗しても取り直さない)
 * - 待機中に signal で取り消された場合は何も保存せず null を返す。
 *   取り消しは「取得しなかった」のであって失敗ではないので、次に表示するとき取り直す
 */
import { fetchSummary } from './summary.js'
import { fetchArticleMeta } from './wikipedia.js'
import { isCancelled } from './requestQueue.js'

/**
 * @param {string} id 記事名
 * @param {{ preview: Map<string, any>, meta: Map<string, any> }} caches 記事名 => 結果
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ summary:any, meta:any } | null>} 取り消されたら null
 */
export async function loadSidebarData(id, caches, { signal } = {}) {
  const cachedSummary = caches.preview.get(id)
  const cachedMeta = caches.meta.get(id)
  let summary
  let meta
  try {
    ;[summary, meta] = await Promise.all([
      cachedSummary !== undefined ? cachedSummary : fetchSummary(id, { signal }),
      cachedMeta !== undefined ? cachedMeta : fetchArticleMeta(id, { signal }),
    ])
  } catch (e) {
    if (isCancelled(e)) return null
    throw e
  }
  caches.preview.set(id, summary)
  caches.meta.set(id, meta)
  return { summary, meta }
}
