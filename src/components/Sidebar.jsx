import React from 'react'

/** 外部データ由来の URL を href にしてよいか(https のみ許可。javascript: 等を弾く) */
function isHttpsUrl(url) {
  return typeof url === 'string' && /^https:\/\//i.test(url)
}

/**
 * 右サイドバー。常時表示で、ホバー中はそのノード、外れたら現在地の記事を出す。
 * SPEC.md 6.2 に対応。
 *
 * - summary / meta が undefined のときは取得中。空パネルにせず記事名だけ先に出す
 * - 取得に失敗しても(null)エラーは出さず、取れなかった項目は「—」にする。
 *   サイドバーは補助機能なので、散歩を止めない
 * - 隣接記事はそのノードの展開結果(expansions)。未展開のノードなら一行案内を出す
 */
export default function Sidebar({
  id,
  summary,
  meta,
  adjacent,
  isCurrent,
  onSelect,
  disabled,
}) {
  const dash = '—'
  const fmtNumber = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : dash)

  return (
    <aside className="sidebar" aria-label="選択中の記事">
      <div className="sidebar-head">
        <div className="sidebar-label">
          {isCurrent || !id ? 'SELECTED NODE' : 'HOVER NODE'}
        </div>
        <h2 className="sidebar-title">
          {id ? (summary && summary.title) || id : '記事を検索してください'}
        </h2>
      </div>

      <dl className="sidebar-meta">
        <div>
          <dt>カテゴリ</dt>
          <dd>{meta === undefined && id ? '…' : (meta && meta.category) || dash}</dd>
        </div>
        <div>
          <dt>被リンク数</dt>
          <dd>{meta === undefined && id ? '…' : fmtNumber(meta && meta.backlinks)}</dd>
        </div>
        <div>
          <dt>更新</dt>
          <dd>{meta === undefined && id ? '…' : (meta && meta.updated) || dash}</dd>
        </div>
      </dl>

      <p className="sidebar-excerpt">
        {!id
          ? '記事名を入力すると、その記事と関連記事の3Dグラフが出ます。ノードにカーソルを乗せるとここに概要が出て、クリックするとその記事へ進みます。'
          : summary === undefined
            ? '読み込み中…'
            : (summary && summary.extract) || '概要を取得できませんでした。'}
      </p>

      {/* target="_blank" には必ず rel="noopener noreferrer" を付ける
          (開いた先のページから window.opener 経由でこの画面を操作されないため)。
          href は API から来た値なので、https の URL 以外はリンクにしない */}
      {id && summary && isHttpsUrl(summary.url) && (
        <a
          className="sidebar-link"
          href={summary.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          WIKIPEDIA で読む →
        </a>
      )}

      <div className="sidebar-adjacent">
        <div className="sidebar-label">
          隣接記事 {adjacent ? `(${adjacent.length})` : ''}
        </div>
        {adjacent ? (
          <ul className="adjacent-list">
            {adjacent.map((title) => (
              <li key={title}>
                <button
                  type="button"
                  className="adjacent-item"
                  onClick={() => onSelect(title)}
                  disabled={disabled}
                  title={title}
                >
                  <span className="adjacent-title">{title}</span>
                  <span className="adjacent-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="adjacent-empty">
            {id ? 'クリックして展開すると表示されます' : dash}
          </p>
        )}
      </div>
    </aside>
  )
}
