# Wiki Link 3D Visualizer (プロトタイプ)

Wikipedia記事間のリンク関係を3Dグラフとして可視化するプロトタイプです。

**デモ: https://3daysbouzz.github.io/wiki-link-visualizer/**

## セットアップ

```bash
npm install
npm run dev
```

起動するとターミナルに URL が表示されるので、それを開いてください
(`http://localhost:5173/wiki-link-visualizer/`)。GitHub Pages の配信階層に
合わせるため、開発時も URL にリポジトリ名が付きます(`vite.config.js` の `base`)。

`npm` が見つからない場合は Node.js 自体が未インストールです。
[nodejs.org](https://nodejs.org/) からLTS版を入れて、ターミナルを開き直してください。

**Node.js は 22.18 以降が必要です**(推奨 24)。テストが TypeScript のファイルを
直接読み込むため、型除去(type stripping)に対応したバージョンが要ります。
`node --version` で確認できます。

## 使い方

1. 上部の検索欄に記事名(例: `初音ミク`)を入力する。候補が出るので ↑↓ で選んで Enter
   (候補を選ばずに Enter でも検索できる)
2. その記事と、関連する記事(内容の近いものから抽選で40件)が3Dグラフになる
3. マウスドラッグで回転、ホイールまたは右下の +/− でズーム
4. ノードにカーソルを乗せると、右のサイドバーにその記事の概要・カテゴリ・被リンク数・
   更新日・隣接記事が出る(外すと現在地の記事に戻る)
5. ノード、またはサイドバーの隣接記事をクリックするとその記事へ進み、カメラが飛んでから追いかける
6. 左下のパンくず、← ボタン、Backspace キーで来た道を戻れる
7. 右上の ↺ ボタンでグラフを空にして最初からやり直せる

画面は黒地に白だけで、色は使っていません。

- **一番大きい球 + 呼吸する輪** = 現在地
- **中くらいの球** = 現在地から直接たどれる記事。大きいほど閲覧数が多い(表示の1〜3秒後に育つ)
- **小さく薄い球・破線** = ひとつ前の記事の関連記事(参考として残している)
- **中空の輪** = 一度訪れた記事。クリックするとそこまで戻る
- **線の上を流れる点** = 現在地から関連度の高い記事へ向かう線(上位12本)

関連記事は抽選で選んでいますが、乱数は種付き(`seed`)なので、同じ記事・同じ `seed` なら
いつ開いても同じ顔ぶれになります。違う顔ぶれが見たいときは URL の `seed=` を変えてください。

上部のバーには表示中のノード数(NODES)・線の数(EDGES)・歩いた深さ(DEPTH)が出ます。

画面の形によって配置が3通りに変わります。操作はどれも同じです(ノードをタップで進む、← で戻る)。

| 画面 | サイドバーの出かた |
|---|---|
| PC・タブレット | 右に固定。`>` ボタンで格納でき、閉じるとグラフが広がります |
| スマートフォン(縦) | グラフの下。同じく格納できます |
| スマートフォン(横) | グラフに重なるドロワー。**初期状態は閉じています**。右上の `<` ボタンで開きます |

横向きでは画面の高さが足りないので、サイドバーを重ねてグラフの領域を確保しています。
ドロワーを開け閉めしてもグラフの配置は動きません。

## URL で設定と経路を指定する

```
http://localhost:5173/?preset=mesh&nodeLimit=64&start=初音ミク&path=MEIKO,KAITO&debug=1
```

| クエリ | 意味 |
|---|---|
| `preset=current` / `mesh` | 表示プリセット(`src/config/presets.ts`) |
| `nodeLimit=` `neighborLimit=` `edgeMode=` `colorMode=` `trailEnabled=` `seed=` | プリセットの値を個別に上書き |
| `start=記事名&path=記事,記事` | 開始記事と辿った経路。歩くと自動で URL に書かれる |
| `debug=1` | 右上にデバッグパネル(設定をその場で変更)を出す |

同じ経路・同じ設定なら、開き直しても同じ配置になります。
2つのタブで別プリセットを開いて並べると比較できます。

## テスト

```bash
npm test
```

Node.js 組み込みのテストランナー(`node:test`)で動きます。追加の依存はありません。
`tests/` にある内容: 存在しない記事・HTTP 429/5xx・JSON でない応答・タイムアウト・
検索候補 0 件の扱い、抽選の決定論、URL クエリの読み取り。

## エラー時の挙動を手で確認する

いずれも画面が真っ白になったり固まったりせず、日本語のエラーが出れば正常です。

| 確認したいこと | 手順 | 期待する表示 |
|---|---|---|
| URL の `start` が存在しない記事 | `http://localhost:5173/?start=存在しない記事xyz` を開く | グラフエリア中央に `ERROR 経路の復元に失敗: 記事が見つかりませんでした: 「存在しない記事xyz」…` |
| URL の `path` の途中が存在しない | `http://localhost:5173/?start=初音ミク&path=存在しないxyz` を開く | 「初音ミク」のグラフは出て、左上に `ERROR 経路の復元に失敗: …`。URL の `path` は消える |
| 検索欄に存在しない記事名 | `zzqqxx` と入力して Enter | 入力中は候補欄に「該当する記事がありません」。Enter 後は `ERROR 記事が見つかりませんでした: 「zzqqxx」…` |
| Wikipedia が 429 を返す | DevTools の Console で下のコードを実行してから検索 | `ERROR Wikipedia へのアクセスが集中しています(HTTP 429)。しばらく待ってから再試行してください` |
| Wikipedia が 502 を返す | 同上(`429` を `502` に変える) | `ERROR Wikipedia 側で障害が起きている可能性があります(HTTP 502)。…` |
| 応答が返ってこない | DevTools の Network タブで throttling を `Offline` にして検索 | `ERROR Wikipedia APIへの接続に失敗しました…`(Offline 以外で止まるサーバーは 15 秒で打ち切り) |
| WebGL が使えない | Chrome の `chrome://flags` で WebGL を無効にして開く | グラフの代わりに「WebGLの初期化に失敗しました。…」の文言 |

429 / 502 を再現するコード(DevTools の Console に貼り付ける。ページを再読み込みすると元に戻る):

```js
const realFetch = window.fetch
window.fetch = (u, o) =>
  String(u).includes('api.php') && !String(u).includes('opensearch')
    ? Promise.resolve(new Response('Too Many Requests', { status: 429 }))
    : realFetch(u, o)
```

## 公開(GitHub Pages)

`main` に push すると GitHub Actions が「依存のインストール → テスト → ビルド → 公開」
を自動で行います(`.github/workflows/deploy.yml`)。テストが落ちるとそこで止まるので、
壊れた状態は公開されません。

ビルド結果を手元で確認するには以下を実行します(本番と同じパス構成で配信されます)。

```bash
npm run build
npm run preview
```

## 技術構成

- React + Vite
- 3D描画: **Three.js 本体を直接使用**(ラッパーライブラリなし)
- データ取得: MediaWiki API (`https://ja.wikipedia.org/w/api.php`) を
  `origin=*` パラメータ付きでフロントエンドから直接呼び出し。
  関連度は検索エンジンの `morelike:` を使い、閲覧数は Wikimedia REST API
  (`wikimedia.org/api/rest_v1/metrics/pageviews`) から表示分だけ取得

依存パッケージは `react` / `react-dom` / `three` と、デバッグパネル用の `leva` だけです。

## なぜ react-force-graph-3d を使っていないのか

当初は `react-force-graph-3d` で実装していましたが、同ライブラリの内部依存
(`3d-force-graph` → `three-render-objects`)がWebGPU関連の実験的な
エクスポート(`three/webgpu`、`Timer`)を要求しており、Three.js本体との
バージョン整合が取れずグラフが真っ暗になる不具合に当たりました。

`package.json` の `overrides` でバージョンを固定しようとしましたが、
`3d-force-graph` が内部で `three-render-objects` を `^1.29` という緩い指定で
参照しているため、npmの解決規則上どうしても壊れた最新版が選ばれてしまい、
根本解決に至りませんでした。

参考: [3d-force-graph#691](https://github.com/vasturiano/3d-force-graph/issues/691)

そのため依存そのものを撤廃し、`src/components/Graph3D.jsx` に以下を自前実装しています。

- 力学レイアウト(ノード間の反発 / リンクのバネ / 中心への引力)
- ノード描画(`THREE.Sprite`、画面上のピクセルで大きさ固定)、リンク描画(`THREE.LineSegments`、実線と破線)
- 記事名ラベル(`THREE.Sprite` + `CanvasTexture`、JetBrains Mono)
- 背景グリッド・データパケット・パララックスドリフト・クリック遷移のアニメーション
- カメラ操作(`OrbitControls`)、クリック判定(画面に投影した距離で判定)

書体(Space Grotesk / JetBrains Mono)は Google Fonts から読み込んでいます(npm 依存ではありません)。

## CORSについて

MediaWiki APIは `origin=*` を付与すると、ブラウザからのクロスオリジン
リクエストを許可するCORSヘッダーを返します。そのためプロトタイプ段階では
専用バックエンドは不要です。

参考: [API:Cross-site requests](https://www.mediawiki.org/wiki/API:Cross-site_requests)

## ドキュメント

| ファイル | 内容 |
|---|---|
| `SPEC.md` | 仕様。API・UI・定数の意味 |
| `CLAUDE.md` | Claude Code 向けの作業指示 |

チューニング可能な値は `src/constants.js` に集約しています。

未対応: 非公式wiki対応、モバイルでの本格的な再構成(サイドバーを下に畳む基本形と描画解像度の抑制のみ)
