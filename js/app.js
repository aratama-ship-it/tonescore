// 聲調譜 TONESCORE — 画面の組み立てと譜面の描画
import { DECKS, syllables, isPunct } from './data/phrases.js';
import { toBopomofo, splitTone, toPinyinMarked } from './bopomofo.js';
import { contour, applySandhi, playToneMelody, judge, TONE_NAMES } from './tones.js';
import { PitchRecorder, medianHz, segment, normalize, smoothTrack } from './pitch.js';

const $ = (s) => document.querySelector(s);

// ★画面に出す動作中のバージョン。実機で「どれが動いているか」を推測しないための表示。
//   index.html の ?v= と sw.js の VERSION と必ず揃える。
const APP_VERSION = 'v5';
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
  host.innerHTML = state.syls.map((s) => `
    <span class="syl${s.sandhi ? ' sandhi' : ''}">
      <span class="han">${s.char}${s.tail ? `<span style="opacity:.4">${s.tail}</span>` : ''}</span>
      <span class="bpm">${toBopomofo(withTone(s.py, s.realized))}</span>
    </span>`).join('');

  fitHanzi();
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
  $('#note').innerHTML = notes.join('<br>');
}

const withTone = (py, tone) => py.replace(/[1-5]$/, String(tone));

/** 漢字＋注音が1行に収まるサイズへ。句読点をぶら下げた列は1.35字分として見積もる */
function fitHanzi() {
  const host = $('#hanzi');
  const w = host.clientWidth;
  if (!w) return;
  const units = state.syls.reduce((s, x) => s + (x.tail ? 1.35 : 1) + 0.34, 0); // 0.34 = 注音の幅
  const size = Math.max(16, Math.min(38, (w / units) * 0.98));
  host.querySelectorAll('.syl').forEach((el) => { el.style.fontSize = `${size}px`; });
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

function drawLane() {
  const w = cv.width / (Math.min(window.devicePixelRatio || 1, 3));
  const h = cv.height / (Math.min(window.devicePixelRatio || 1, 3));
  const n = Math.max(1, state.syls.length);
  const padY = 16;
  const y = (st) => padY + ((ST_MAX - st) / (ST_MAX * 2)) * (h - padY * 2);
  const colW = w / n;

  cx.clearRect(0, 0, w, h);

  // 五度式の水平グリッド（level 1,2,3,4,5 → -6,-3,0,+3,+6 半音）
  for (const st of [-6, -3, 0, 3, 6]) {
    cx.beginPath();
    cx.moveTo(0, y(st)); cx.lineTo(w, y(st));
    cx.strokeStyle = st === 0 ? 'rgba(236,230,220,.19)' : 'rgba(236,230,220,.075)';
    cx.lineWidth = 1;
    cx.setLineDash(st === 0 ? [] : [2, 4]);
    cx.stroke();
  }
  cx.setLineDash([]);

  // 五度式の目安（グリッド線に厳密に合わせる）
  cx.font = '400 9px -apple-system, system-ui, sans-serif';
  cx.textAlign = 'right';
  cx.fillStyle = 'rgba(236,230,220,.26)';
  [[6, '高'], [0, '中'], [-6, '低']].forEach(([st, label]) => {
    cx.fillText(label, w - 7, y(st) + 3);
  });

  // 列の仕切りと声調番号
  cx.font = '500 10px -apple-system, system-ui, sans-serif';
  cx.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      cx.beginPath();
      cx.moveTo(colW * i, 8); cx.lineTo(colW * i, h - 8);
      cx.strokeStyle = 'rgba(236,230,220,.07)';
      cx.stroke();
    }
    const s = state.syls[i];
    if (!s) continue;
    cx.fillStyle = s.sandhi ? 'rgba(224,168,60,.75)' : 'rgba(236,230,220,.32)';
    cx.fillText(`${s.realized === 5 ? '軽' : s.realized}${s.sandhi ? '←3' : ''}`, colW * (i + .5), h - 6);
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
  host.style.gridTemplateColumns = `repeat(${Math.max(1, state.syls.length)}, 1fr)`;
  if (!state.user) {
    host.innerHTML = `<p class="vd-txt" style="grid-column:1/-1;text-align:center;padding-top:12px">
      押している間だけ録音します。1フレーズを一息で。</p>`;
    return;
  }
  host.innerHTML = state.user.map((u) => `
    <div class="vd ${u.verdict.ok ? 'ok' : 'ng'}">
      <span class="vd-mark">${u.verdict.ok ? '○' : '△'}</span>
      <span class="vd-txt">${u.verdict.label}</span>
    </div>`).join('');

  const worst = state.user.find((u) => !u.verdict.ok);
  const lines = [];
  if (worst) {
    lines.push(`<b>${worst.syl.char}（${TONE_NAMES[worst.syl.realized]}）</b> ${worst.verdict.label} — ${worst.verdict.detail}`);
  } else {
    lines.push('<b>全音節が規範の形と一致しました。</b>速度を上げて崩れないか確かめる。');
  }
  const d = state.diag;
  if (d) {
    const pct = Math.round((d.voiced / d.frames) * 100);
    lines.push(`基準ピッチ ${Math.round(state.refHz)} Hz ／ 有声 ${pct}%`
      + ` ／ ${d.frames}フレーム・${Math.round(d.fps)}回/秒`
      + (d.prepMs ? ` ／ 準備 ${d.prepMs}ms` : ''));
    if (pct < 25) {
      lines.push('<b>声を拾えている割合が低い</b>。口をマイク（画面下端）に近づけ、'
        + '母音を伸ばし気味に、少し大きめの声で言うと安定する。');
    }
  } else {
    lines.push(`基準ピッチ ${Math.round(state.refHz)} Hz（この収録の中央値）`);
  }
  if (state.fallback) lines.push('音節の区切りを自動検出できず、有声区間を均等割にして表示しています。1音ずつ区切って言うと精度が上がります。');
  // ★古い診断を先に消してから差し込む。
  //   以前は挿入後に「最後の1つを残す」処理をしていたため、host.after() で先頭に入る新しい方が
  //   消えて初回の表示が残り続けていた（実機で3回連続同じ数値が出た原因）。
  document.querySelectorAll('.vd-detail').forEach((el) => el.remove());
  const box = document.createElement('p');
  box.className = 'vd-detail';
  box.innerHTML = lines.join('<br>');
  host.after(box);
}

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
  $('#micState').textContent = '録音中…';
  // 収録中に「拾えているか」をその場で見せる。実機で無音判定に落ちていても気付ける
  rec.start(({ hz, voicedRatio }) => {
    if (!holding) return;
    $('#micState').textContent = hz
      ? `録音中… ${Math.round(hz)} Hz ／ 有声 ${Math.round(voicedRatio * 100)}%`
      : `録音中… 声を拾えていません（有声 ${Math.round(voicedRatio * 100)}%）`;
  });
}

function stopRec() {
  pressed = false;
  if (!holding) return;
  holding = false;
  mic.classList.remove('rec');
  const frames = rec.stop();
  analyze(frames);
}

function analyze(rawFrames) {
  const frames = smoothTrack(rawFrames); // 単発の飛び・穴を整える

  // ★測れていないのに判定を出さない。
  //   取り込みが間引かれると数フレームしか無いのに「0/8 音節が一致」と断定してしまう。
  //   （タブが非表示、他アプリに切り替え、極端な低電力状態などで起きる）
  const dur = frames.length ? frames[frames.length - 1].t : 0;
  const fps = dur > 0 ? frames.length / dur : 0;
  state.diag = null;
  if (dur < 0.35) {
    $('#micState').textContent = '短すぎます。押したまま最後まで言い切ってください';
    return;
  }
  if (fps < 25) {
    $('#micState').textContent =
      `取り込みが ${Math.round(fps)}回/秒 に間引かれました。画面を表示したまま、もう一度`;
    return;
  }

  const ref = medianHz(frames);
  if (!ref) {
    $('#micState').textContent = '声が取れませんでした。口を画面下端に近づけて、もう一度';
    return;
  }
  state.refHz = ref;
  // 実機で問題が出たときに原因を切り分けるための素の数値
  state.diag = {
    frames: frames.length,
    voiced: frames.filter((f) => f.hz > 0).length,
    fps,
    prepMs: rec.timing?.first ? rec.timing.totalMs : 0,
  };
  const n = state.syls.length;
  const { segs, exact, empty } = segment(frames, n);
  if (empty) {
    $('#micState').textContent = '声が取れませんでした。口を画面下端に近づけて、もう一度';
    return;
  }
  state.fallback = !exact;
  state.user = state.syls.map((s, i) => {
    const curve = normalize(segs[i], ref);
    return { syl: s, curve, verdict: judge(s.realized, curve) };
  });
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

let mineAudio = null;
function playMine() {
  if (!rec.lastBlobUrl) return Promise.resolve();
  mineAudio = new Audio(rec.lastBlobUrl);
  return new Promise((r) => { mineAudio.onended = r; mineAudio.onerror = r; mineAudio.play().catch(r); });
}
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
  build();
  renderText();
  document.querySelectorAll('.vd-detail').forEach((el) => el.remove());
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
  ['train', 'ear', 'list'].forEach((k) => { $(`#view-${k}`).hidden = k !== v; });
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.view === v));
  if (v === 'train') requestAnimationFrame(() => { sizeCanvas(); fitHanzi(); });
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
