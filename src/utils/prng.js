/**
 * 種(seed)から決まる乱数。
 *
 * Math.random() を使うと、同じ記事・同じ経路でも開くたびに配置や抽選結果が変わり、
 * 「設定を変えて良くなったのか、配置が変わっただけなのか」が判別できない。
 * レイアウトの初期配置・シミュレーション中の微小なずらし・リンクの抽選は
 * すべてこの乱数を使い、(seed, 記事名) が同じなら同じ結果になるようにする。
 */

/** 文字列を 32bit の整数に潰す(FNV-1a)。記事名を乱数の種に混ぜるために使う */
export function hashString(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * mulberry32。32bit の種から [0,1) の乱数列を作る。
 * 小さく速く、用途(配置のばらつき・抽選)には十分な品質
 */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * (seed, キー文字列) から乱数生成器を作る。
 * 例: seededRandom(config.seed, 記事名) → その記事専用の乱数列
 */
export function seededRandom(seed, key = '') {
  return mulberry32((seed >>> 0) ^ hashString(String(key)))
}
