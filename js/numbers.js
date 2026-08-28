// 数字・時刻の聞き取りドリル用の生成器。
//
// ★方針：出題はすべて**その場で生成**する（データファイル不要・無限に出題できる）。
//   ただし数字→漢字の変換規則は間違えやすいので、テストで固定する。
//   - 2 は位で読み方が変わる：兩百・兩千・兩點だが、二十・二十二。単独の2（兩塊・兩點）は 兩。
//   - 途中の0は「零」を1回だけ挟む：105=一百零五、1005=一千零五。末尾の0は読まない。
//   - 10台は「十五」（一十五にしない）。ただし110は「一百一十」（百の後は一十）。
//   - 分の一桁は「零五分」。30分は会話どおり「半」。
//
// ★ピンインは表示しない。「一」の変調（yì/yí）を機械生成すると間違えるため、
//   ここでは音声（TTS）と漢字だけを教材にする。

const D = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const two = (d) => (d === 2 ? '兩' : D[d]); // 百・千の位の2は「兩」

/** 0〜9999 を台湾の口語で自然な漢数字へ */
export function numToHanzi(n) {
  n = Math.floor(n);
  if (n < 0 || n > 9999) throw new Error(`範囲外: ${n}`);
  if (n === 0) return '零';
  if (n === 2) return '兩'; // 兩塊・兩點の単独2

  const th = Math.floor(n / 1000) % 10;
  const h = Math.floor(n / 100) % 10;
  const te = Math.floor(n / 10) % 10;
  const u = n % 10;
  let s = '';

  if (th > 0) s += two(th) + '千';
  if (h > 0) s += two(h) + '百';
  else if (th > 0 && (te > 0 || u > 0)) s += '零';

  if (te > 0) {
    // 15=十五 だが 110=一百一十（百・千の後は「一十」）
    s += (te === 1 && th === 0 && h === 0) ? '十' : D[te] + '十';
  } else if (h > 0 && u > 0) {
    s += '零';
  }
  if (u > 0) s += D[u];
  return s;
}

/** 時刻 → 「三點半」「十點十五分」「三點零五分」 */
export function timeToHanzi(hour, minute) {
  if (hour < 1 || hour > 12) throw new Error(`時が範囲外: ${hour}`);
  if (minute < 0 || minute > 59) throw new Error(`分が範囲外: ${minute}`);
  let s = numToHanzi(hour) + '點';
  if (minute === 0) return s;
  if (minute === 30) return s + '半';
  if (minute < 10) return s + '零' + D[minute] + '分';
  return s + numToHanzi(minute) + '分';
}

/**
 * 値段の出題。台湾の日常の価格帯に寄せる（夜市の小吃〜レストラン〜タクシー）。
 * 「一百零五」と「一百五十」のような聞き間違いの罠は、生成の分布に織り込む。
 */
export function genPrice(rand = Math.random) {
  const r = rand();
  let n;
  if (r < 0.40) {
    n = (3 + Math.floor(rand() * 17)) * 5;            // 15〜95（5刻み）夜市・ドリンク
  } else if (r < 0.70) {
    n = (10 + Math.floor(rand() * 50)) * 10;          // 100〜590（10刻み）食事
  } else if (r < 0.85) {
    const h = 1 + Math.floor(rand() * 5);             // 105/150/205/250… 聞き分けの罠
    n = h * 100 + [5, 15, 50, 55][Math.floor(rand() * 4)];
  } else {
    n = (12 + Math.floor(rand() * 29)) * 50;          // 600〜2000（50刻み）タクシー・まとめ買い
  }
  return { value: n, hanzi: numToHanzi(n) + '塊', kind: 'price' };
}

const MINUTES = [0, 0, 0, 30, 30, 30, 5, 10, 15, 20, 40, 45, 50]; // 0分と半を厚めに

/** 時刻の出題 */
export function genTime(rand = Math.random) {
  const h = 1 + Math.floor(rand() * 12);
  const m = MINUTES[Math.floor(rand() * MINUTES.length)];
  return { value: h * 100 + m, hanzi: timeToHanzi(h, m), kind: 'time', hour: h, minute: m };
}

/**
 * 入力された数字列を答えとして解釈する。
 * 値段：そのまま整数。時刻：末尾2桁を分、残りを時（"305"→3:05、"3"→3:00）。
 * @returns {number|null} 比較用の値。解釈できなければ null
 */
export function parseAnswer(kind, digits) {
  if (!/^\d{1,4}$/.test(digits)) return null;
  if (kind === 'price') return parseInt(digits, 10);
  // time
  let h, m;
  if (digits.length <= 2) { h = parseInt(digits, 10); m = 0; }
  else { h = parseInt(digits.slice(0, -2), 10); m = parseInt(digits.slice(-2), 10); }
  if (h < 1 || h > 12 || m < 0 || m > 59) return null;
  return h * 100 + m;
}

/** 時刻の表示用 "3:05" */
export function fmtTime(v) {
  return `${Math.floor(v / 100)}:${String(v % 100).padStart(2, '0')}`;
}
