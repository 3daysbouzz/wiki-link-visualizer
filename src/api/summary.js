/**
 * 記事プレビュー(冒頭文 + サムネイル)の取得。SPEC.md 3.5 に対応。
 *
 * REST API の summary エンドポイントは、1リクエストで冒頭の要約文・
 * サムネイル画像・本文URLをまとめて返す。CORSも許可済み。
 *
 * プレビューは補助機能なので、失敗しても画面にエラーを出さないこと。
 * 呼び出し側は null を「情報なし」として扱う。
 */

import { fetchWithTimeout } from './wikipedia.js'

const SUMMARY_ENDPOINT = 'https://ja.wikipedia.org/api/rest_v1/page/summary/'

/**
 * @param {string} title 記事名
 * @returns {Promise<{ title:string, extract:string, thumbnail:string|null, url:string|null } | null>}
 */
export async function fetchSummary(title) {
  try {
    const res = await fetchWithTimeout(SUMMARY_ENDPOINT + encodeURIComponent(title))
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
    // 意図的に握りつぶす。プレビューの失敗で操作を妨げない
    return null
  }
}
