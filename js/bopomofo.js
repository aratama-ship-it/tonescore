// ピンイン → 注音（ボポモフォ）決定論的変換
// 手打ちの注音を混ぜないための変換器。入力は "zhe4" のような「ピンイン+声調数字(1-5)」。
// 5 = 軽声。台湾式に軽声記号「˙」は先頭へ置く。

const INITIALS = [
  ['zh', 'ㄓ'], ['ch', 'ㄔ'], ['sh', 'ㄕ'],
  ['b', 'ㄅ'], ['p', 'ㄆ'], ['m', 'ㄇ'], ['f', 'ㄈ'],
  ['d', 'ㄉ'], ['t', 'ㄊ'], ['n', 'ㄋ'], ['l', 'ㄌ'],
  ['g', 'ㄍ'], ['k', 'ㄎ'], ['h', 'ㄏ'],
  ['j', 'ㄐ'], ['q', 'ㄑ'], ['x', 'ㄒ'],
  ['r', 'ㄖ'], ['z', 'ㄗ'], ['c', 'ㄘ'], ['s', 'ㄙ'],
];

const FINALS = {
  a: 'ㄚ', o: 'ㄛ', e: 'ㄜ', ea: 'ㄝ',
  ai: 'ㄞ', ei: 'ㄟ', ao: 'ㄠ', ou: 'ㄡ',
  an: 'ㄢ', en: 'ㄣ', ang: 'ㄤ', eng: 'ㄥ', er: 'ㄦ',
  i: 'ㄧ', ia: 'ㄧㄚ', io: 'ㄧㄛ', ie: 'ㄧㄝ', iai: 'ㄧㄞ', iao: 'ㄧㄠ',
  iou: 'ㄧㄡ', ian: 'ㄧㄢ', in: 'ㄧㄣ', iang: 'ㄧㄤ', ing: 'ㄧㄥ',
  u: 'ㄨ', ua: 'ㄨㄚ', uo: 'ㄨㄛ', uai: 'ㄨㄞ', uei: 'ㄨㄟ',
  uan: 'ㄨㄢ', uen: 'ㄨㄣ', uang: 'ㄨㄤ', ueng: 'ㄨㄥ', ong: 'ㄨㄥ',
  v: 'ㄩ', ve: 'ㄩㄝ', van: 'ㄩㄢ', vn: 'ㄩㄣ', iong: 'ㄩㄥ',
};

const TONE_MARK = { 1: '', 2: 'ˊ', 3: 'ˇ', 4: 'ˋ', 5: '˙' };

// 空韻（zhi/chi/shi/ri/zi/ci/si）は注音では声母のみ
const EMPTY_RIME = new Set(['zhi', 'chi', 'shi', 'ri', 'zi', 'ci', 'si']);

// y-/w- 始まりの綴りを「本来の韻母」へ戻す
const ZERO_INITIAL = {
  yi: 'i', ya: 'ia', yo: 'io', ye: 'ie', yai: 'iai', yao: 'iao', you: 'iou',
  yan: 'ian', yin: 'in', yang: 'iang', ying: 'ing', yong: 'iong',
  yu: 'v', yue: 've', yuan: 'van', yun: 'vn',
  wu: 'u', wa: 'ua', wo: 'uo', wai: 'uai', wei: 'uei',
  wan: 'uan', wen: 'uen', wang: 'uang', weng: 'ueng',
  er: 'er', e: 'e', a: 'a', o: 'o', ai: 'ai', ei: 'ei', ao: 'ao', ou: 'ou',
  an: 'an', en: 'en', ang: 'ang', eng: 'eng', ee: 'ea',
};

/** "zhe4" → { base:"zhe", tone:4 } */
export function splitTone(syl) {
  const m = String(syl).trim().match(/^([a-zü:v]+)([1-5])$/i);
  if (!m) return { base: String(syl).toLowerCase(), tone: 1, invalid: true };
  return { base: m[1].toLowerCase().replace(/ü|u:/g, 'v'), tone: Number(m[2]) };
}

/** ピンイン音節（声調数字つき）→ 注音文字列 */
export function toBopomofo(syl) {
  const { base, tone } = splitTone(syl);
  const mark = TONE_MARK[tone] ?? '';
  const wrap = (body) => (tone === 5 ? mark + body : body + mark);

  if (EMPTY_RIME.has(base)) {
    const ini = INITIALS.find(([p]) => base.startsWith(p));
    return wrap(ini ? ini[1] : base);
  }
  if (ZERO_INITIAL[base]) {
    return wrap(FINALS[ZERO_INITIAL[base]] || base);
  }

  const ini = INITIALS.find(([p]) => base.startsWith(p));
  if (!ini) return wrap(FINALS[base] || base);

  let rest = base.slice(ini[0].length);
  // 省略綴りの復元
  if (rest === 'iu') rest = 'iou';
  else if (rest === 'ui') rest = 'uei';
  else if (rest === 'un') rest = 'uen';
  // j/q/x + u は実体が ü
  if ('jqx'.includes(ini[0])) {
    if (rest === 'u') rest = 'v';
    else if (rest.startsWith('u')) rest = 'v' + rest.slice(1);
  }
  if (rest === 've' || rest === 'ue') rest = 've';

  const fin = FINALS[rest];
  return wrap(ini[1] + (fin || rest));
}

/** ピンイン（数字表記）→ 声調記号つき表示（zhe4 → zhè） */
const VOWEL_MARKS = {
  a: ['ā', 'á', 'ǎ', 'à', 'a'], e: ['ē', 'é', 'ě', 'è', 'e'],
  i: ['ī', 'í', 'ǐ', 'ì', 'i'], o: ['ō', 'ó', 'ǒ', 'ò', 'o'],
  u: ['ū', 'ú', 'ǔ', 'ù', 'u'], v: ['ǖ', 'ǘ', 'ǚ', 'ǜ', 'ü'],
};
export function toPinyinMarked(syl) {
  const { base, tone } = splitTone(syl);
  let target = null;
  if (base.includes('a')) target = 'a';
  else if (base.includes('e')) target = 'e';
  else if (base.includes('ou')) target = 'o';
  else {
    for (let i = base.length - 1; i >= 0; i--) {
      if ('aeiouv'.includes(base[i])) { target = base[i]; break; }
    }
  }
  const out = base.replace('v', 'ü');
  if (!target) return out;
  const marked = VOWEL_MARKS[target][tone - 1];
  const idx = base.lastIndexOf(target);
  return (base.slice(0, idx) + marked + base.slice(idx + 1)).replace(/v/g, 'ü');
}
