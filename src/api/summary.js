/**
 * 記事プレビュー(冒頭文 + サムネイル)の取得。SPEC.md 3.5 に対応。
 *
 * REST API の summary エンドポイントは、1リクエストで冒頭の要約文・
 * サムネイル画像・本文URLをまとめて返す。CORSも許可済み。
 *
 * プレビューは補助機能なので、失敗しても画面にエラーを出さないこと。
 * 呼び出し側は null を「情報なし」として扱う。
 * 例外は待機中に signal で取り消されたときで、CancelledError を投げる
 * (「取得しなかった」ので、null を保存してはいけない)。
 */

import { fetchWithTimeout } from './wikipedia.js'
import { isCancelled } from './requestQueue.js'

const SUMMARY_ENDPOINT = 'https://ja.wikipedia.org/api/rest_v1/page/summary/'

/**
 * @param {string} title 記事名
 * @param {{ signal?: AbortSignal }} [options] 待機中に abort されたら取り消す
 * @returns {Promise<{ title:string, extract:string, thumbnail:string|null, url:string|null } | null>}
 */
export async function fetchSummary(title, { signal } = {}) {
  try {
    const res = await fetchWithTimeout(SUMMARY_ENDPOINT + encodeURIComponent(title), {
      priority: 'mid',
      signal,
    })
    if (!res.ok) return null

    const data = await res.json()

    return {
      title: data.title || title,
      extract: data.extract || '',
      thumbnail: (data.thumbnail && data.thumbnail.source) || null,
      url:
        (data.content_urls &&
          data.content_urls.desktop &&
          data.content_urls.desktop.page) ||
        null,
    }
  } catch (e) {
    if (isCancelled(e)) throw e
    // 意図的に握りつぶす。プレビューの失敗で操作を妨げない
    return null
  }
}
