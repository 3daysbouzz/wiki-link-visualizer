import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
//
// base について:
//   GitHub Pages は https://<ユーザー名>.github.io/<リポジトリ名>/ に配信するため、
//   JS や CSS の参照先も同じ階層に揃えないと読み込めず、画面が真っ白になる。
//
//   「本番ビルドのときだけ base を付ける」という書き方は罠がある。
//   vite preview は command が 'serve' 扱いになるので base が外れ、
//   ビルド済み HTML が指す /wiki-link-visualizer/... と配信元がズレて
//   やはり真っ白になる(確認済み)。
//   環境で切り替えず、開発・preview・本番のすべてで同じ base を使う。
//
//   そのため npm run dev / preview で開く URL にもこの階層が付く。
//   起動時にターミナルへ正しい URL が表示されるので、それを開くこと。
const BASE_PATH = '/wiki-link-visualizer/'

export default defineConfig({
  plugins: [react()],
  base: BASE_PATH,
  server: {
    port: 5173,
  },
})
