/**
 * Wikipedia / Wikimedia への通信の待ち行列。同時に送る数を上限までに抑える。
 * docs/tasks/task-concurrency-limit.md に対応。
 *
 * Wikimedia の推奨(Wikimedia APIs/Rate limits)は「同時リクエスト 3 以下」。
 * 以前は閲覧数だけ最大8本の行列を持ち、Action API とサイドバーには制御が無かったため、
 * 展開とサイドバーと閲覧数が重なると同時に10本を超えていた。
 * アプリの通信はすべて fetchWithTimeout(wikipedia.js)を通るので、そこでこの行列に入れる。
 *
 * 決まり:
 *   - 優先度は3段階。high(利用者の操作による展開)→ mid(サイドバー・表示中の閲覧数)→ low(先読み)。
 *     同じ優先度の中は先に入れた順
 *   - 待っている間に取り消せる(signal)。取り消すと CancelledError で失敗する。
 *     送信済みのものは取り消さない(中断すると Wikipedia 側の処理が無駄になるだけで、枠も空かない)
 *   - task は「枠をもらってから」呼ぶ。タイムアウトの計測は task の中で始めること
 *     (待っている時間までタイムアウトに数えると、混んでいるだけで失敗する)
 */

export const PRIORITIES = ['high', 'mid', 'low']

/** 待機中に取り消された呼び出しの失敗。通信の失敗ではない(キャッシュに失敗を残さないこと) */
export class CancelledError extends Error {
  constructor() {
    super('取得前に取り消されました')
    this.name = 'CancelledError'
  }
}

/** 待機中に取り消されたための失敗かどうか */
export function isCancelled(e) {
  return !!e && e.name === 'CancelledError'
}

/**
 * @param {number} maxConcurrent 同時に実行する task の上限
 */
export function createRequestQueue(maxConcurrent) {
  let limit = maxConcurrent
  let active = 0
  const waiting = { high: [], mid: [], low: [] }

  const next = () => {
    for (const p of PRIORITIES) {
      if (waiting[p].length > 0) return waiting[p].shift()
    }
    return null
  }

  const pump = () => {
    while (active < limit) {
      const job = next()
      if (!job) return
      job.started = true
      if (job.signal) job.signal.removeEventListener('abort', job.onAbort)
      active += 1
      let result
      try {
        result = Promise.resolve(job.task())
      } catch (e) {
        result = Promise.reject(e)
      }
      result.then(job.resolve, job.reject).finally(() => {
        active -= 1
        pump()
      })
    }
  }

  /**
   * task を行列に入れ、枠が空いたら実行する。task の結果をそのまま返す。
   *
   * @param {() => Promise<any>} task
   * @param {object} [options]
   * @param {'high'|'mid'|'low'} [options.priority]
   * @param {AbortSignal} [options.signal] 待機中に abort されたら取り消す(送信済みなら何もしない)
   * @param {object} [options.handle]
   *   渡すと setPriority(p) を生やす。待機中の優先度を後から上げるのに使う(開始後は何もしない)
   */
  const run = (task, { priority = 'high', signal, handle } = {}) => {
    if (!waiting[priority]) throw new Error(`不明な優先度: ${priority}`)
    if (signal && signal.aborted) return Promise.reject(new CancelledError())

    return new Promise((resolve, reject) => {
      const job = { task, priority, signal, started: false, resolve, reject }
      const remove = () => {
        const list = waiting[job.priority]
        const i = list.indexOf(job)
        if (i >= 0) list.splice(i, 1)
        return i >= 0
      }
      job.onAbort = () => {
        if (job.started) return
        if (remove()) reject(new CancelledError())
      }
      if (signal) signal.addEventListener('abort', job.onAbort, { once: true })
      if (handle) {
        handle.setPriority = (p) => {
          if (job.started || p === job.priority || !waiting[p]) return
          remove()
          job.priority = p
          waiting[p].push(job)
        }
      }
      waiting[priority].push(job)
      pump()
    })
  }

  return {
    run,
    /** 上限を変える(?debug=1 の計測用)。下げた場合は、実行中の分が終わるまで新しく始めない */
    setLimit(n) {
      limit = n
      pump()
    },
    get limit() {
      return limit
    },
    /** 実行中の数(テスト・計測用) */
    get active() {
      return active
    },
    /** 待機中の数(テスト・計測用) */
    get waiting() {
      return waiting.high.length + waiting.mid.length + waiting.low.length
    },
  }
}
