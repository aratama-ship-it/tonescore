// 聲調譜 TONESCORE — 画面の組み立てと譜面の描画
import { DECKS, syllables, isPunct } from './data/phrases.js?v=16';
import { toBopomofo, splitTone, toPinyinMarked } from './bopomofo.js?v=16';
import { contour, applySandhi, playToneMelody, judge, TONE_NAMES } from './tones.js?v=16';
import { PitchRecorder, medianHz, segment, normalize, smoothTrack, decideVoicing, trimEdges, rejectOutliers } from './pitch.js?v=16';
import * as history from './history.js?v=16';
import { initDrills } from './drills.js?v=16';

const $ = (s) => document.querySelector(s);

// ★画面に出す動作中のバージョン。実機で「どれが動いているか」を推測しないための表示。
//   index.html の ?v= と sw.js の VERSION と必ず揃える。
const APP_VERSION = 'v16';
const ST_MAX = 9.5; // レーンの上下限（半音）

const state = {
  deck: 0,
  item: 0,
  syls: [],      // {char, py, tone, realized, sandhi, bpm}
  user: null,    // [{curve, verdict}] or null
  progress: 0,   // 自分の声の描き込みアニメーション 0..1
  refHz: 0,
  fallback: false,
};

const rec = new PitchRecorder();
let audioCtx = null;
const getCtx = () => {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
};

/* ── 音声合成（台湾華語） ───────────────────────── */
let voices = [];
const loadVoices = () => { voices = speechSynthesis?.getVoices?.() || []; };
loadVoices();
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = loadVoices;

// Apple のノベルティ音声（Eddy / Grandma 等）は zh-TW にも並ぶが朗読には向かない
const NOVELTY = /^(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|bells|boing|bubbles|jester|organ|superstar|trinoids|whisper|wobble|zarvox|bad news|good news|albert|cellos)/i;
const PREFERRED_ZH = /(meijia|mei-jia|美佳|li-?mu|yu-?shu|tingting|ting-ting)/i;

const lang0 = (v) => (v.lang || '').toLowerCase().replace('_', '-');

function zhCandidates() {
  const tw = voices.filter((v) => /^(zh-tw|zh-hant|cmn-hant|zh-hk)/.test(lang0(v)));
  const pool = (tw.length ? tw : voices.filter((v) => lang0(v).startsWith('zh')));
  const plain = pool.filter((v) => !NOVELTY.test(v.name || ''));
  return (plain.length ? plain : pool).sort((a, b) =>
    (PREFERRED_ZH.test(b.name) ? 1 : 0) - (PREFERRED_ZH.test(a.name) ? 1 : 0));
}

function zhVoice() {
  const list = zhCandidates();
  const saved = localStorage.getItem('tonescore.voice');
  return list.find((v) => v.name === saved) || list[0] || null;
}
const jaVoice = () => voices.find((v) => lang0(v).startsWith('ja')) || null;

function speak(text, { lang = 'zh-TW', rate = 0.85 } = {}) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve(false);
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = lang.startsWith('ja') ? jaVoice() : zhVoice();
    if (v) u.voice = v;
    u.lang = v?.lang || lang;
    u.rate = rate;
    u.onend = () => resolve(true);
    u.onerror = () => resolve(false);
    speechSynthesis.speak(u);
  });
}

/* ── データ組み立て ─────────────────────────────── */
function currentItem() { return DECKS[state.deck].items[state.item]; }

function build() {
  const item = currentItem();
  const raw = syllables(item);
  // 句読点は直前の音節の列にぶら下げる（レーンの列と1対1に保つため）
  const syls = [];
  for (const s of raw) {
    if (s.punct) { if (syls.length) syls[syls.length - 1].tail = (syls[syls.length - 1].tail || '') + s.char; continue; }
    const { tone } = splitTone(s.py);
    syls.push({ char: s.char, py: s.py, tone, bpm: toBopomofo(s.py), pinyin: toPinyinMarked(s.py) });
  }
  const { tones, changed } = applySandhi(syls.map((s) => s.tone));
  syls.forEach((s, i) => { s.realized = tones[i]; s.sandhi = changed[i]; });
  state.syls = syls;
  state.user = null;
  state.progress = 0;
  state.refHz = 0;
  state.fallback = false;
}

/* ── 描画：漢字＋注音 ───────────────────────────── */
function renderText() {
  const item = currentItem();
  const n = state.syls.length;
  $('#idx').textContent = `${state.item + 1} / ${DECKS[state.deck].items.length}`;
  $('#deckLabel').textContent = DECKS[state.deck].title;
  $('#verifyFlag').hidden = item.verify !== 'check';

  const host = $('#hanzi');
  host.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  host.innerHTML = state.syls.map((s) => {
    const py = withTone(s.py, s.realized);
    return `
    <span class="syl${s.sandhi ? ' sandhi' : ''}">
      <span class="glyph">
        <span class="han">${s.char}${s.tail ? `<span style="opacity:.4">${s.tail}</span>` : ''}</span>
        <span class="bpm">${toBopomofo(py)}</span>
      </span>
      <span class="py">${toPinyinMarked(py)}</span>
    </span>`;
  }).join('');

  fitHanzi();
  renderToneBar();
  $('#ja').textContent = item.ja;

  const notes = [];
  if (item.note) notes.push(item.note);
  if (state.syls.some((s) => s.sandhi)) {
    notes.push('<b>變調</b>：三声が続く箇所は前を第二声で読む。注音は実際に読む声調で表示している。');
    // 3連以上は語の区切りで実際の変調が変わる。単純規則の近似だと明示する
    let run = 0, maxRun = 0;
    state.syls.forEach((s) => { run = s.tone === 3 ? run + 1 : 0; maxRun = Math.max(maxRun, run); });
    if (maxRun >= 3) {
      notes.push('三声が3つ以上続く場合、実際の変調は語の区切り方で変わる。ここでは最も単純な規則による<b>近似</b>を表示している。');
    }
  }
  if (item.verify === 'check') {
    notes.push('<b>この表現は未確認</b>：意味は通るが、台湾の現場で自然かは要確認。');
  }
  state.notes = notes;          // 常時表示せず「i」のシートで見せる（1画面に収めるため）
  if (!$('#sheet').hidden) renderSheet();
}

const withTone = (py, tone) => py.replace(/[1-5]$/, String(tone));

/**
 * 声調の帯：グラフの各列の真上に、その声調の輪郭を大きく並べる。
 * ★記号（ˉˊˇˋ）ではなく**形そのもの**を置く。このアプリの言語は「形」なので、
 *   ここで形を覚えれば下のグラフがそのまま読める。
 */
function renderToneBar() {
  const host = $('#tonebar');
  const n = state.syls.length;
  host.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
  // 縦は実際の音域（±6半音）いっぱいに使う。レーンと同じ ±9.5 に合わせると
  // 形が浅くなって一目で読めない。ここは「形を覚える」ための図なので誇張する。
  const W = 36, H = 30, padY = 3;
  host.innerHTML = state.syls.map((s) => {
    const pts = contour(s.realized, 20);
    const span = s.realized === 5 ? 0.45 : 1;
    const d = pts.map((p, i) => {
      const x = (p.t / span) * (W - 6) + 3;
      const st = Math.max(-6, Math.min(6, p.st));
      const y = padY + ((6 - st) / 12) * (H - padY * 2);
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    const label = toPinyinMarked(withTone(s.py, s.realized));
    return `<div class="tone-cell${s.sandhi ? ' sandhi' : ''}">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${d}"/></svg>
      <span class="tone-l">${label}</span>
    </div>`;
  }).join('');
}

/**
 * 漢字＋注音＋ピンインが1行に収まるサイズへ。
 * 見積もりで置いたあと、実際に溢れていれば収まるまで縮める（ピンインは字より広いことがある）。
 */
function fitHanzi() {
  const host = $('#hanzi');
  const w = host.clientWidth;
  if (!w) return;
  const units = state.syls.reduce((s, x) => s + (x.tail ? 1.35 : 1) + 0.34, 0); // 0.34 = 注音の幅
  let size = Math.max(14, Math.min(34, (w / units) * 0.98));
  const els = host.querySelectorAll('.syl');
  const apply = () => els.forEach((el) => { el.style.fontSize = `${size}px`; });
  apply();
  let guard = 24;
  while (host.scrollWidth > host.clientWidth + 1 && size > 13 && guard--) {
    size -= 1; apply();
  }
}

/* ── 描画：レーン ───────────────────────────────── */
const cv = $('#lane');
const cx = cv.getContext('2d');

function sizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const r = cv.getBoundingClientRect();
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawLane();
}

const dpr = () => Math.min(window.devicePixelRatio || 1, 3);
const laneW = () => cv.width / dpr();
const laneH = () => cv.height / dpr();
const laneY = (st, h) => 16 + ((ST_MAX - st) / (ST_MAX * 2)) * (h - 32);

/** 五度式のグリッドと高中低の目安。実況ビューでも同じ物差しを使う */
function drawGrid(w, h) {
  for (const st of [-6, -3, 0, 3, 6]) {
    cx.beginPath();
    cx.moveTo(0, laneY(st, h)); cx.lineTo(w, laneY(st, h));
    cx.strokeStyle = st === 0 ? 'rgba(236,230,220,.19)' : 'rgba(236,230,220,.075)';
    cx.lineWidth = 1;
    cx.setLineDash(st === 0 ? [] : [2, 4]);
    cx.stroke();
  }
  cx.setLineDash([]);
  cx.font = '400 9px -apple-system, system-ui, sans-serif';
  cx.textAlign = 'right';
  cx.fillStyle = 'rgba(236,230,220,.26)';
  [[6, '高'], [0, '中'], [-6, '低']].forEach(([st, label]) => {
    cx.fillText(label, w - 7, laneY(st, h) + 3);
  });
}

/**
 * 録音中の実況ビュー。
 * ★押している指の近くに小さく出しても見えない（2026-08-19の実機報告）。
 *   指から最も遠く、いま空いている**レーンそのもの**を実況に使う。
 *   ここでは音節ごとに並べ直さず、実時間のまま1本の線で描く（並べ直すのは離した後）。
 */
function drawLive() {
  const w = laneW(), h = laneH();
  cx.clearRect(0, 0, w, h);
  drawGrid(w, h);

  const frames = rec.frames || [];
  const voiced = frames.filter((f) => f.hz > 0);
  const elapsed = frames.length ? frames[frames.length - 1].t : 0;
  const span = Math.max(1.6, elapsed);
  const hzList = voiced.map((f) => f.hz).sort((a, b) => a - b);
  const ref = hzList.length ? hzList[Math.floor(hzList.length / 2)] : 0;

  if (ref) {
    cx.beginPath();
    let started = false;
    for (const f of frames) {
      if (!f.hz) { started = false; continue; }
      const x = (f.t / span) * w;
      const st = Math.max(-ST_MAX, Math.min(ST_MAX, 12 * Math.log2(f.hz / ref)));
      const yy = laneY(st, h);
      started ? cx.lineTo(x, yy) : cx.moveTo(x, yy);
      started = true;
    }
    cx.strokeStyle = getCSS('--voice');
    cx.lineWidth = 2.4; cx.lineJoin = 'round'; cx.lineCap = 'round';
    cx.stroke();
  }

  // 大きく出す実況の数字。線に重なるので帯を敷く
  // ★状態は「直近」で見る。最後の1フレームで判断すると、音節の切れ目ごとに
  //   「声を拾えていません」が点滅して読めない。
  const now = elapsed;
  const recent = frames.filter((f) => f.t > now - 0.25 && f.hz > 0);
  const silent = !frames.some((f) => f.t > now - 0.6 && f.hz > 0);
  const ratio = frames.length ? voiced.length / frames.length : 0;

  cx.fillStyle = 'rgba(15,18,22,.74)';
  cx.fillRect(0, 0, w, 54);
  cx.textAlign = 'center';
  if (!silent && recent.length) {
    const hzNow = recent[recent.length - 1].hz;
    cx.fillStyle = getCSS('--paper');
    cx.font = '600 28px -apple-system, system-ui, sans-serif';
    cx.fillText(`${Math.round(hzNow)} Hz`, w / 2, 30);
    cx.fillStyle = getCSS('--voice');
    cx.font = '500 13px -apple-system, system-ui, sans-serif';
    cx.fillText(`声を拾えています ${Math.round(ratio * 100)}%`, w / 2, 47);
  } else {
    cx.fillStyle = getCSS('--model');
    cx.font = '600 19px -apple-system, system-ui, sans-serif';
    cx.fillText('声を拾えていません', w / 2, 27);
    cx.fillStyle = 'rgba(236,230,220,.5)';
    cx.font = '400 11.5px -apple-system, system-ui, sans-serif';
    cx.fillText('口を画面の下端に近づけて、声を出す', w / 2, 45);
  }
  cx.fillStyle = 'rgba(236,230,220,.3)';
  cx.font = '400 9.5px -apple-system, system-ui, sans-serif';
  cx.fillText(`録音中（実時間 ${elapsed.toFixed(1)}秒）`, w / 2, h - 8);
}

function drawLane() {
  if (state.live) return drawLive();
  const w = laneW();
  const h = laneH();
  const n = Math.max(1, state.syls.length);
  const y = (st) => laneY(st, h);
  const colW = w / n;

  cx.clearRect(0, 0, w, h);
  drawGrid(w, h);

  // 列の仕切り（声調は上の帯に大きく出しているので、ここには書かない）
  for (let i = 1; i < n; i++) {
    cx.beginPath();
    cx.moveTo(colW * i, 6); cx.lineTo(colW * i, h - 6);
    cx.strokeStyle = 'rgba(236,230,220,.07)';
    cx.stroke();
  }

  // 聴き直し中の列を光らせる（どこを鳴らしているか分かるように）
  if (state.playing >= 0) {
    cx.fillStyle = 'rgba(88,194,177,.10)';
    cx.fillRect(colW * state.playing, 0, colW, h);
  }

  const inset = Math.min(14, colW * 0.16);
  const px = (i, t) => colW * i + inset + t * (colW - inset * 2);

  // 規範カーブ（理論値）
  state.syls.forEach((s, i) => {
    // 変調前の声調をゴーストで残す
    if (s.sandhi) strokeCurve(contour(s.tone), i, px, y, 'rgba(122,46,34,.55)', 1.5, [3, 3]);
    strokeCurve(contour(s.realized), i, px, y, getCSS('--model'), 2.6);
  });

  // 自分の声（実測）
  if (state.user) {
    state.user.forEach((u, i) => {
      if (!u.curve.length) return;
      const cut = Math.max(2, Math.round(u.curve.length * state.progress));
      strokeCurve(u.curve.slice(0, cut).map((p) => ({ t: p.t, st: clamp(p.st) })), i, px, y,
        getCSS('--voice'), 2.2);
    });
  }
}

function strokeCurve(pts, col, px, y, color, width, dash = []) {
  if (pts.length < 2) return;
  cx.beginPath();
  cx.setLineDash(dash);
  pts.forEach((p, k) => {
    const X = px(col, p.t), Y = y(p.st);
    k === 0 ? cx.moveTo(X, Y) : cx.lineTo(X, Y);
  });
  cx.strokeStyle = color;
  cx.lineWidth = width;
  cx.lineJoin = 'round';
  cx.lineCap = 'round';
  cx.stroke();
  cx.setLineDash([]);
}

const clamp = (st) => Math.max(-ST_MAX, Math.min(ST_MAX, st));
const getCSS = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

/* ── 判定の表示 ─────────────────────────────────── */
function renderVerdicts() {
  const host = $('#verdicts');
  const detail = $('#vdDetail');
  host.style.gridTemplateColumns = `repeat(${Math.max(1, state.syls.length)}, 1fr)`;
  if (!state.user) {
    host.innerHTML = '';
    detail.innerHTML = '押している間だけ録音します。1フレーズを一息で。<br>文字やレーンをタップすると、その音節だけ聴き直せます。';
    return;
  }
  host.innerHTML = state.user.map((u) => `
    <div class="vd ${u.verdict.ok ? 'ok' : 'ng'}">
      <span class="vd-mark">${u.verdict.ok ? '○' : '△'}</span>
      <span class="vd-txt">${u.verdict.label}</span>
    </div>`).join('');

  const worst = state.user.find((u) => !u.verdict.ok);
  detail.innerHTML = (worst
    ? `<b>${worst.syl.char}（${TONE_NAMES[worst.syl.realized]}）</b> ${worst.verdict.label} — ${worst.verdict.detail}`
    : '<b>全音節が規範の形と一致しました。</b>速度を上げて崩れないか確かめる。')
    + '<br>文字やレーンをタップすると、その音節だけ聴き直せます。';
  if (!$('#sheet').hidden) renderSheet();
}

/** 「i」で開くシート：凡例・解説・診断。1画面に収めるため常時表示しない */
function renderSheet() {
  const lines = [];
  lines.push(`<span class="k" style="background:var(--model)"></span>規範カーブ（五度式の理論値・実音声の実測ではない）<br>`
    + `<span class="k" style="background:var(--voice)"></span>あなたの声（実測F0／自分の中央ピッチ基準の半音）`);
  if (state.notes?.length) lines.push('<hr>' + state.notes.join('<br>'));

  const d = state.diag;
  if (d) {
    const pct = Math.round((d.voiced / d.frames) * 100);
    const seg = state.seginfo;
    let segTxt = '声の切れ目が音節数とぴったり一致した。';
    if (state.fallback && seg) {
      if (seg.adjusted.nuclei) {
        segTxt = `声が繋がっていたので、音量の山（母音）を ${state.syls.length} 個数えて割り当てた。`;
      } else {
        segTxt = `声のかたまりを ${seg.detected} 個検出し、`
          + `${seg.adjusted.merged ? `${seg.adjusted.merged}回結合` : ''}`
          + `${seg.adjusted.merged && seg.adjusted.split ? '・' : ''}`
          + `${seg.adjusted.split ? `${seg.adjusted.split}回分割` : ''}`
          + `して${state.syls.length}音節に合わせた。`;
      }
    }
    lines.push('<hr><b>この収録の測定値</b><br>'
      + `声の高さ（中央）${Math.round(state.refHz)} Hz<br>`
      + `押していた時間のうち、声として拾えたのは ${pct}%（40%を超えていれば十分）<br>`
      + `${d.frames}フレーム・${Math.round(d.fps)}回/秒`
      + (d.prepMs ? ` ／ マイク準備 ${d.prepMs}ms` : '') + '<br>'
      + segTxt);
    if (pct < 25) {
      lines.push('<b>声として拾えた割合が低い。</b>口をマイク（画面下端）に近づけ、'
        + '母音を伸ばし気味に、少し大きめの声で言うと安定する。');
    }
    if (state.audioBuf) {
      lines.push(`<hr><b>再生</b><br>録音のピーク ${state.audioPeak.toFixed(3)} → `
        + `${state.audioGain.toFixed(1)}倍に持ち上げて再生（長さ ${state.audioBuf.duration.toFixed(2)}秒）<br>`
        + '再生の前にマイクを手放している（iOSは掴んだままだと受話口から鳴るため）。');
    }
    if (state.user) {
      lines.push('<hr><b>音節ごとの割り当て</b>（タップでその部分だけ聴き直せる）<br>'
        + state.user.map((u) => (u.seg
          ? `${u.syl.char} ${u.seg.from.toFixed(2)}–${u.seg.to.toFixed(2)}秒（${Math.round((u.seg.to - u.seg.from) * 1000)}ms）`
          : `${u.syl.char} 割り当てなし`)).join('<br>'));
    }
  }

  lines.push(renderHistory());
  $('#sheetBody').innerHTML = lines.join('<br>');
}

const TONE_LABEL = { 1: '第一声', 2: '第二声', 3: '第三声', 4: '第四声', 5: '軽声' };

/**
 * これまでの成績。★数字を出すだけでなく「まだ判断できない」も正直に言う。
 *   数回の結果で「あなたの弱点は◯◯」と断定しない。
 */
function renderHistory() {
  const rows = history.all();
  if (!rows.length) return '';
  const stats = history.byTone(rows);
  const bars = stats.map((m) => {
    const pct = Math.round(m.rate * 100);
    const w = Math.max(2, Math.round(m.rate * 100));
    const color = m.total < 3 ? 'var(--muted)' : (m.rate >= 0.8 ? 'var(--ok)' : 'var(--model)');
    return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
      <span style="width:3.5em;flex:none">${TONE_LABEL[m.tone]}</span>
      <span style="flex:1;height:6px;background:var(--line);border-radius:3px;overflow:hidden">
        <span style="display:block;height:100%;width:${w}%;background:${color}"></span>
      </span>
      <span style="width:6.5em;flex:none;text-align:right;font-variant-numeric:tabular-nums">${pct}%（${m.ok}/${m.total}）</span>
    </div>`;
  }).join('');

  const w = history.weakest(rows);
  let advice;
  if (!w) {
    advice = stats.every((m) => m.total < 3)
      ? 'まだ回数が少ないので、弱点は判断できない（各声調3回以上から）。'
      : 'いまのところ落としている声調はない。';
  } else {
    const streak = history.currentStreak(w.tone, rows);
    advice = `<b>いちばん落としているのは ${TONE_LABEL[w.tone]}</b>`
      + `（${Math.round(w.rate * 100)}%・${w.ok}/${w.total}）`
      + (w.label ? `。多い指摘は「${w.label}」` : '')
      + (streak >= 2 ? `。直近 ${streak} 回続けて外している` : '');
  }
  return `<hr><b>これまでの成績</b>（この端末に${rows.length}件・外部送信なし）<br>`
    + bars + advice
    + '<br><button id="histClear" style="margin-top:8px;appearance:none;background:transparent;'
    + 'border:1px solid var(--line-2);color:var(--muted);border-radius:3px;'
    + 'padding:5px 10px;font-family:inherit;font-size:11px">成績を消す</button>';
}

// シート内は毎回描き直すので、クリックは親で受ける
$('#sheetBody').addEventListener('click', (e) => {
  if (e.target?.id !== 'histClear') return;
  history.clear();
  renderSheet();
});

$('#infoBtn').addEventListener('click', () => {
  const sheet = $('#sheet');
  if (sheet.hidden) { renderSheet(); sheet.hidden = false; $('#infoBtn').classList.add('on'); }
  else { sheet.hidden = true; $('#infoBtn').classList.remove('on'); }
});
$('#sheetClose').addEventListener('click', () => {
  $('#sheet').hidden = true; $('#infoBtn').classList.remove('on');
});

/* ── 収録と解析 ─────────────────────────────────── */
const mic = $('#mic');
let pressed = false;   // 指が触れているか
let holding = false;   // 実際に録音中か

async function startRec() {
  if (holding) return;
  pressed = true;
  const first = !rec.ready;
  // 押した瞬間に見た目を変える（準備待ちでも「反応していない」と感じさせない）
  mic.classList.add('rec');
  if (first) $('#micState').textContent = 'マイクの許可を確認中…';
  try {
    await rec.ensure();
  } catch (e) {
    pressed = false;
    mic.classList.remove('rec');
    $('#micState').textContent = 'マイクを使えません。ブラウザの許可を確認してください';
    refreshPrep();
    return;
  }
  refreshPrep();
  // 許可ダイアログを操作している間に指が離れていることがある（初回に必ず起きる）
  if (!pressed) {
    mic.classList.remove('rec');
    $('#micState').textContent = first
      ? `マイクを使えます（準備 ${(rec.timing.totalMs / 1000).toFixed(1)}秒）。もう一度、押しながら話してください`
      : 'マイクを使います';
    return;
  }
  holding = true;
  mic.classList.add('rec');
  $('#micState').textContent = '離すと判定します';
  // 実況はレーンに大きく出す（指の近くの小さい文字は見えないため）
  state.live = true;
  state.user = null;
  drawLive();
  rec.start(() => { if (state.live) drawLive(); });
}

function stopRec() {
  pressed = false;
  if (!holding) return;
  holding = false;
  state.live = false;
  mic.classList.remove('rec');
  const frames = rec.stop();
  analyze(frames);
}

function analyze(rawFrames) {
  // 有声判定 → 端（押し始め・離し際）を落とす → 単発の飛び・穴を整える → 外れ値を捨てる
  const frames = rejectOutliers(smoothTrack(trimEdges(decideVoicing(rawFrames))));

  // ★測れていないのに判定を出さない。
  //   取り込みが間引かれると数フレームしか無いのに「0/8 音節が一致」と断定してしまう。
  //   （タブが非表示、他アプリに切り替え、極端な低電力状態などで起きる）
  const dur = frames.length ? frames[frames.length - 1].t : 0;
  const fps = dur > 0 ? frames.length / dur : 0;
  state.diag = null;
  if (dur < 0.35) {
    $('#micState').textContent = '短すぎます。押したまま最後まで言い切ってください';
    drawLane();
    return;
  }
  if (fps < 25) {
    $('#micState').textContent =
      `取り込みが ${Math.round(fps)}回/秒 に間引かれました。画面を表示したまま、もう一度`;
    drawLane();
    return;
  }

  const ref = medianHz(frames);
  if (!ref) {
    $('#micState').textContent = '声が取れませんでした。口を画面下端に近づけて、もう一度';
    drawLane();
    return;
  }
  state.refHz = ref;
  state.audioBuf = null;     // 前の収録の復号結果を捨てる
  state.needFreshCtx = true; // 次の再生の前に音声セッションを作り直す
  // 実機で問題が出たときに原因を切り分けるための素の数値
  state.diag = {
    frames: frames.length,
    voiced: frames.filter((f) => f.hz > 0).length,
    fps,
    prepMs: rec.timing?.first ? rec.timing.totalMs : 0,
  };
  const n = state.syls.length;
  const { segs, exact, empty, detected, adjusted } = segment(frames, n);
  if (empty) {
    $('#micState').textContent = '声が取れませんでした。口を画面下端に近づけて、もう一度';
    return;
  }
  state.fallback = !exact;
  state.seginfo = { detected, adjusted };
  state.user = state.syls.map((s, i) => {
    const curve = normalize(segs[i], ref);
    return { syl: s, curve, seg: segs[i] && { from: segs[i].from, to: segs[i].to }, verdict: judge(s.realized, curve) };
  });
  history.record(state.user); // 声調ごとの弱点を溜める（判定はしない、結論を数えるだけ）
  const okCount = state.user.filter((u) => u.verdict.ok).length;
  $('#micState').textContent = `${okCount} / ${n} 音節が一致`;
  $('#btnPlayMine').disabled = !rec.lastBlobUrl;
  $('#btnAB').disabled = !rec.lastBlobUrl;

  renderVerdicts();
  animateIn();
}

function animateIn() {
  const t0 = performance.now();
  const dur = 520;
  const tick = (t) => {
    const u = Math.min(1, (t - t0) / dur);
    state.progress = 1 - Math.pow(1 - u, 3);
    drawLane();
    if (u < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* 初回のマイク準備を明示的な手順にする（押した瞬間の待ちを隠さない） */
const prep = $('#micPrep');
function refreshPrep() { prep.hidden = rec.ready; }
prep.addEventListener('click', async () => {
  prep.dataset.state = 'working';
  prep.querySelector('.prep-t').textContent = '許可を待っています…';
  try {
    await rec.ensure();
  } catch {
    prep.dataset.state = '';
    prep.querySelector('.prep-t').textContent = 'マイクを準備する';
    prep.querySelector('.prep-s').textContent = '許可されませんでした。ブラウザの設定を確認してください';
    return;
  }
  const t = rec.timing;
  $('#micState').textContent = `準備できました（${(t.totalMs / 1000).toFixed(1)}秒）`;
  refreshPrep();
});
refreshPrep();

mic.addEventListener('pointerdown', (e) => { e.preventDefault(); startRec(); });
mic.addEventListener('pointerup', stopRec);
mic.addEventListener('pointercancel', stopRec);
mic.addEventListener('pointerleave', stopRec);
mic.addEventListener('contextmenu', (e) => e.preventDefault());

/* ── 再生系 ─────────────────────────────────────── */
$('#btnMelody').addEventListener('click', async () => {
  const ctx = getCtx();
  const base = state.refHz || 165;
  $('#btnMelody').classList.add('playing');
  const d = playToneMelody(ctx, state.syls.map((s) => s.realized), base, 0.5);
  setTimeout(() => $('#btnMelody').classList.remove('playing'), d * 1000);
});

$('#btnSpeak').addEventListener('click', async () => {
  const b = $('#btnSpeak');
  if (!zhVoice()) {
    b.querySelector('.btn-s').textContent = '中文の音声が未搭載';
  }
  b.classList.add('playing');
  await speak(currentItem().zh, { rate: 0.8 });
  b.classList.remove('playing');
});

/* ── 自分の声の再生 ───────────────────────────────
   ★<audio> ではなく Web Audio で鳴らす。理由は3つ。
     ①iOSはマイクを掴んでいる間、音の出口を受話口へ切り替える。再生前に必ず手放す。
     ②録音レベルは端末・距離で桁が変わるので、ピークを見て**持ち上げてから**鳴らす。
     ③MediaRecorder の出力は長さ情報を持たないことがあり <audio> のシークが効かない。
       復号して AudioBuffer にすれば、任意の区間を確実に鳴らせる。 */
let playSrc = null;
let playTimer = null;
state.playing = -1;

function stopMine() {
  if (playSrc) { try { playSrc.stop(); } catch { /* 無視 */ } playSrc = null; }
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
}

async function ensureBuffer() {
  if (state.audioBuf) return state.audioBuf;
  if (!rec.lastBlob) return null;
  try {
    const ctx = getCtx();
    const buf = await ctx.decodeAudioData(await rec.lastBlob.arrayBuffer());
    let peak = 0;
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i += 8) peak = Math.max(peak, Math.abs(d[i]));
    state.audioBuf = buf;
    state.audioPeak = peak;
    state.audioGain = Math.min(16, 0.92 / Math.max(0.02, peak)); // 小さい録音を持ち上げる
    return buf;
  } catch {
    state.audioBuf = null;
    return null;
  }
}

/** 録音の一部（または全体）を鳴らす。offset/dur は解析の時間軸（秒） */
async function playRecorded(offset, dur) {
  stopMine();
  rec.release(); // ★これを先にやらないと iOS は受話口から鳴らす
  // マイクを手放しても、録音中に作った AudioContext は録音モードの音声セッションを
  // 引きずることがある。収録のあと最初の再生では作り直す（生成は数ミリ秒）。
  if (state.needFreshCtx) {
    state.needFreshCtx = false;
    state.audioBuf = null;
    if (audioCtx) { try { await audioCtx.close(); } catch { /* 無視 */ } audioCtx = null; }
  }
  const buf = await ensureBuffer();
  if (!buf) return false;
  const ctx = getCtx();
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { /* 無視 */ } }

  const from = Math.max(0, offset - rec.recOffset);
  // 録音がその区間まで届いていない場合は、短い切れ端を鳴らさず失敗として返す
  if (buf.duration - from < 0.08) return false;
  const len = Math.min(dur, buf.duration - from);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = state.audioGain;
  src.connect(g).connect(ctx.destination);
  src.start(0, from, len);
  playSrc = src;
  playTimer = setTimeout(() => { state.playing = -1; drawLane(); }, len * 1000 + 60);
  return new Promise((r) => { src.onended = () => r(true); setTimeout(() => r(true), len * 1000 + 120); });
}

function playMine() {
  if (!rec.lastBlob) return Promise.resolve();
  return playRecorded(rec.recOffset, 1e3);
}

/* ── 音節ごとの聴き直し ─────────────────────────────
   「その文字がちゃんと録れているか」を耳で確かめられるようにする。 */
async function playSyllable(i) {
  const u = state.user?.[i];
  if (!u) return;
  state.playing = i;
  drawLane();

  const pad = 0.06;
  const ok = u.seg && rec.lastBlob ? await playRecorded(u.seg.from - pad, (u.seg.to - u.seg.from) + pad * 2) : false;
  if (!ok) {
    // 録音が使えない場合は、その音節の規範の旋律を鳴らす（無反応にしない）
    playToneMelody(getCtx(), [u.syl.realized], state.refHz || 165, 0.6);
    playTimer = setTimeout(() => { state.playing = -1; drawLane(); }, 700);
  }
}

/** レーンの列をタップ → その音節だけ聴き直す */
cv.addEventListener('click', (e) => {
  if (!state.syls.length) return;
  const r = cv.getBoundingClientRect();
  const i = Math.min(state.syls.length - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * state.syls.length)));
  playSyllable(i);
});
$('#verdicts').addEventListener('click', (e) => {
  const el = e.target.closest('.vd');
  if (!el) return;
  playSyllable([...$('#verdicts').children].indexOf(el));
});
$('#hanzi').addEventListener('click', (e) => {
  const el = e.target.closest('.syl');
  if (!el) return;
  playSyllable([...$('#hanzi').children].indexOf(el));
});
$('#btnPlayMine').addEventListener('click', playMine);
$('#btnAB').addEventListener('click', async () => {
  await speak(currentItem().zh, { rate: 0.8 });
  await wait(320);
  await playMine();
  await wait(320);
  await speak(currentItem().zh, { rate: 0.8 });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 遷移 ───────────────────────────────────────── */
function go(delta) {
  const items = DECKS[state.deck].items;
  let i = state.item + delta;
  if (i < 0) i = items.length - 1;
  if (i >= items.length) i = 0;
  state.item = i;
  refresh();
}
$('#prev').addEventListener('click', () => go(-1));
$('#next').addEventListener('click', () => go(1));

function refresh() {
  stopMine();
  state.playing = -1;
  build();
  renderText();
  renderVerdicts();
  $('#micState').textContent = 'マイクを使います';
  $('#btnPlayMine').disabled = true;
  $('#btnAB').disabled = true;
  requestAnimationFrame(sizeCanvas);
}

/* ── フレーズ集 ─────────────────────────────────── */
function renderList() {
  $('#deckList').innerHTML = DECKS.map((d, di) => `
    <div class="deck">
      <div class="deck-h"><span class="deck-t">${d.title}</span><span class="deck-n">${d.items.length}</span></div>
      <p class="deck-s">${d.subtitle}</p>
      ${d.items.map((it, ii) => `
        <button class="item ${it.verify === 'check' ? 'check' : ''}" data-d="${di}" data-i="${ii}">
          <span class="item-zh" lang="zh-Hant-TW">${it.zh}</span>
          <span class="item-ja">${it.ja}</span>
        </button>`).join('')}
    </div>`).join('');
  $('#deckList').querySelectorAll('.item').forEach((b) => {
    b.addEventListener('click', () => {
      state.deck = Number(b.dataset.d);
      state.item = Number(b.dataset.i);
      switchView('train');
      refresh();
    });
  });
}

/* ── 耳だけモード ───────────────────────────────── */
const ear = { playing: false, order: 'zh', rate: 0.85, gap: 1.6, i: 0 };
$('#earOrder').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  ear.order = b.dataset.v;
  $('#earOrder').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
});
$('#earRate').addEventListener('input', (e) => { ear.rate = +e.target.value; $('#rateVal').textContent = ear.rate.toFixed(2); });
$('#earGap').addEventListener('input', (e) => { ear.gap = +e.target.value; $('#gapVal').textContent = ear.gap.toFixed(1); });

$('#earPlay').addEventListener('click', async () => {
  if (ear.playing) { ear.playing = false; speechSynthesis.cancel(); $('#earPlay').textContent = `「${DECKS[state.deck].title}」を再生`;return; }
  ear.playing = true;
  $('#earPlay').textContent = '停止';
  const items = DECKS[state.deck].items;
  while (ear.playing) {
    const it = items[ear.i % items.length];
    $('#earNow').textContent = it.zh;
    setMediaSession(it);
    await speak(it.zh, { rate: ear.rate });
    if (!ear.playing) break;
    if (ear.order === 'zh-ja') { await wait(400); await speak(it.ja, { lang: 'ja-JP', rate: 1 }); }
    else if (ear.order === 'zh-gap-zh') { await wait(ear.gap * 1000); if (ear.playing) await speak(it.zh, { rate: ear.rate }); }
    await wait(ear.gap * 1000);
    ear.i++;
  }
  $('#earNow').textContent = '—';
});

function renderVoiceSel() {
  const sel = $('#voiceSel');
  if (!sel) return;
  const list = zhCandidates();
  const cur = zhVoice();
  sel.innerHTML = list.length
    ? list.map((v) => `<option value="${v.name}"${v === cur ? ' selected' : ''}>${v.name}（${v.lang}）</option>`).join('')
    : '<option>中文の音声が見つかりません</option>';
  sel.disabled = !list.length;
  const tw = list.some((v) => /^zh-(tw|hant|hk)/.test(lang0(v)));
  $('#voiceHint').textContent = !list.length
    ? 'iOSは設定 → アクセシビリティ → 読み上げコンテンツ → 声 から「中文（台湾）」を追加すると使えます。'
    : tw ? '' : '台湾の音声が見つからないため、大陸の発音で読み上げます（語彙・声調は台湾式のまま）。';
}
$('#voiceSel')?.addEventListener('change', (e) => {
  localStorage.setItem('tonescore.voice', e.target.value);
});
if (window.speechSynthesis) {
  speechSynthesis.addEventListener?.('voiceschanged', () => { loadVoices(); renderVoiceSel(); });
}

function setMediaSession(it) {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: it.zh, artist: it.ja, album: '聲調譜 TONESCORE',
  });
}

/* ── タブ ───────────────────────────────────────── */
function switchView(v) {
  ['train', 'drill', 'ear', 'list'].forEach((k) => { $(`#view-${k}`).hidden = k !== v; });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.view === v));
  if (v === 'train') requestAnimationFrame(() => { sizeCanvas(); fitHanzi(); });
  if (v === 'drill') drills.start();
  if (v === 'ear' && !ear.playing) $('#earPlay').textContent = `「${DECKS[state.deck].title}」を再生`;
}
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    if (t.dataset.view !== 'ear' && ear.playing) { ear.playing = false; speechSynthesis.cancel(); $('#earPlay').textContent = `「${DECKS[state.deck].title}」を再生`;}
    switchView(t.dataset.view);
  });
});

window.addEventListener('resize', () => requestAnimationFrame(() => { sizeCanvas(); fitHanzi(); }));

/* ── 起動 ───────────────────────────────────────── */
// 検証用フック（マイクなしで解析→描画の経路を確かめるため）
window.__tonescore = { state, analyze, drawLane, rec };

const drills = initDrills({ speak, $ });

renderList();
renderVoiceSel();
refresh();
setTimeout(() => { loadVoices(); renderVoiceSel(); }, 400); // 音声一覧は遅れて届くことがある

$('#ver').textContent = APP_VERSION;

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // ★スクリプトURLに ?v= を付けない。付けると更新のたびに別の登録になり、
  //   古い Service Worker が生き残って更新が届かなくなる。
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.update().catch(() => {});
    // 新しいSWが制御を取ったら一度だけ読み直す（更新が1回遅れるのを防ぐ）
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  }).catch(() => {});
}
