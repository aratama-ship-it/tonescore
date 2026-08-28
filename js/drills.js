// 聞き取りドリル（数字・声調の聞き分け）。
//
// 練習画面が「話す」の訓練なのに対し、ここは「聞く」の訓練。
// ★ドリルの本質はテンポ。正解なら短い間で自動的に次へ進み、
//   間違えたときだけ止まって聞き比べさせる（そこが学習の瞬間だから）。
//
// 成績は localStorage にだけ残す（外部送信なし）。数字はカテゴリ別、
// 聞き分けはペア別に {ok, total} を数える。

import { genPrice, genTime, parseAnswer, fmtTime } from './numbers.js?v=16';
import { PAIRS } from './data/pairs.js?v=16';
import { contour } from './tones.js?v=16';
import { splitTone, toPinyinMarked } from './bopomofo.js?v=16';

const KEY = 'tonescore.drill.v1';

function loadStats() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function bump(id, ok) {
  const s = loadStats();
  if (!s[id]) s[id] = { ok: 0, total: 0 };
  s[id].total++;
  if (ok) s[id].ok++;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 無視 */ }
  return s[id];
}

/** 声調の輪郭ミニSVG（練習画面の声調帯と同じ描き方） */
function toneSvg(pinyin) {
  return pinyin.trim().split(/\s+/).map((syl) => {
    const { tone } = splitTone(syl);
    const pts = contour(tone, 16);
    const span = tone === 5 ? 0.45 : 1;
    const W = 26, H = 20, padY = 2;
    const d = pts.map((p, i) => {
      const x = (p.t / span) * (W - 4) + 2;
      const st = Math.max(-6, Math.min(6, p.st));
      const y = padY + ((6 - st) / 12) * (H - padY * 2);
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${d}"/></svg>`;
  }).join('');
}

export function initDrills({ speak, $ }) {
  const host = $('#view-drill');
  host.innerHTML = `
    <section class="drill">
      <div class="seg drill-seg" id="drillMode" role="radiogroup">
        <button data-m="price" class="on">値段</button>
        <button data-m="time">時刻</button>
        <button data-m="pair">聞き分け</button>
      </div>
      <div id="drillBody" class="drill-body"></div>
    </section>`;

  let mode = 'price';
  const body = $('#drillBody');

  $('#drillMode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    mode = b.dataset.m;
    $('#drillMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    start();
  });

  /* ── 数字（値段・時刻） ─────────────────────── */
  let q = null;          // 現在の出題
  let typed = '';
  let session = { ok: 0, total: 0 };
  let nextTimer = null;

  function start() {
    clearTimeout(nextTimer);
    session = { ok: 0, total: 0 };
    if (mode === 'pair') startPair();
    else startNumber(true);
  }

  function startNumber(first = false) {
    clearTimeout(nextTimer);
    q = mode === 'price' ? genPrice() : genTime();
    typed = '';
    const stat = loadStats()[mode] || { ok: 0, total: 0 };
    body.innerHTML = `
      <p class="drill-hint">${mode === 'price' ? '値段を聞いて、数字で答える' : '時刻を聞いて、数字で答える（3時5分 → 305）'}</p>
      <div class="drill-row">
        <button class="btn drill-play" id="dPlay">もう一度聞く</button>
        <button class="btn drill-play" id="dSlow">ゆっくり</button>
      </div>
      <div class="drill-display" id="dDisp">&nbsp;</div>
      <p class="drill-fb" id="dFb">&nbsp;</p>
      <div class="keypad" id="dPad">
        ${[1,2,3,4,5,6,7,8,9,'⌫',0,'OK'].map((k) =>
          `<button data-k="${k}" class="${k === 'OK' ? 'pad-ok' : ''}">${k}</button>`).join('')}
      </div>
      <p class="drill-tally">この端末での成績 ${stat.ok}/${stat.total} ／ 今回 <span id="dSess">${session.ok}/${session.total}</span></p>`;

    $('#dPlay').addEventListener('click', () => speak(q.hanzi, { rate: 0.9 }));
    $('#dSlow').addEventListener('click', () => speak(q.hanzi, { rate: 0.55 }));
    $('#dPad').addEventListener('click', onPad);
    if (first) speak(q.hanzi, { rate: 0.9 });
    else setTimeout(() => speak(q.hanzi, { rate: 0.9 }), 120);
  }

  function onPad(e) {
    const b = e.target.closest('button');
    if (!b || !q) return;
    const k = b.dataset.k;
    if (k === '⌫') typed = typed.slice(0, -1);
    else if (k === 'OK') { check(); return; }
    else if (typed.length < 4) typed += k;
    renderTyped();
  }

  function renderTyped() {
    const el = $('#dDisp');
    if (!el) return;
    if (!typed) { el.innerHTML = '&nbsp;'; return; }
    el.textContent = (mode === 'time' && typed.length >= 3)
      ? `${typed.slice(0, -2)}:${typed.slice(-2)}`
      : typed;
  }

  function check() {
    const ans = parseAnswer(q.kind, typed);
    const fb = $('#dFb');
    if (ans === null) { fb.textContent = '数字を入力してから OK'; return; }
    const ok = ans === q.value;
    session.total++; if (ok) session.ok++;
    bump(mode, ok);
    const shown = q.kind === 'time' ? fmtTime(q.value) : q.value;
    fb.innerHTML = ok
      ? `<span class="fb-ok">○</span> ${q.hanzi} ＝ ${shown}`
      : `<span class="fb-ng">✗</span> 正解は ${q.hanzi} ＝ ${shown}`;
    $('#dSess').textContent = `${session.ok}/${session.total}`;
    if (ok) {
      nextTimer = setTimeout(() => startNumber(), 1100); // テンポ優先で自動的に次へ
    } else {
      speak(q.hanzi, { rate: 0.6 });                     // 間違えたらゆっくり聞かせる
      typed = '';
      renderTyped();
      nextTimer = setTimeout(() => startNumber(), 2600);
    }
  }

  /* ── 声調の聞き分け ─────────────────────────── */
  let pair = null, spoken = null, answered = false;

  function startPair() {
    clearTimeout(nextTimer);
    pair = PAIRS[Math.floor(Math.random() * PAIRS.length)];
    spoken = Math.random() < 0.5 ? 'a' : 'b';
    answered = false;
    const flip = Math.random() < 0.5; // 表示順もシャッフル
    const [L, R] = flip ? ['b', 'a'] : ['a', 'b'];
    const stat = loadStats()['pair:' + pair.id] || { ok: 0, total: 0 };

    const card = (side) => {
      const it = pair[side];
      const py = it.pinyin.trim().split(/\s+/).map(toPinyinMarked).join(' ');
      return `<button class="pcard" data-side="${side}">
        <span class="pcard-tone">${toneSvg(it.pinyin)}</span>
        <span class="pcard-zh" lang="zh-Hant-TW">${it.zh}</span>
        <span class="pcard-py">${py}</span>
        <span class="pcard-ja">${it.ja}</span>
      </button>`;
    };
    body.innerHTML = `
      <p class="drill-hint">どちらを言った？　聞こえた方をタップ</p>
      <div class="drill-row">
        <button class="btn drill-play" id="pPlay">もう一度聞く</button>
      </div>
      <div class="pcards" id="pCards">${card(L)}${card(R)}</div>
      <p class="drill-fb" id="pFb">&nbsp;</p>
      <div class="drill-row" id="pAfter" hidden>
        <button class="btn btn-sm" id="pHearA">左を聞く</button>
        <button class="btn btn-sm" id="pHearB">右を聞く</button>
        <button class="btn btn-sm" id="pNext">次へ</button>
      </div>
      <p class="drill-tally">このペア ${stat.ok}/${stat.total}${pair.note ? `<br>${pair.note}` : ''}</p>`;

    $('#pPlay').addEventListener('click', () => speak(pair[spoken].zh, { rate: 0.85 }));
    $('#pCards').addEventListener('click', onPick);
    $('#pHearA').addEventListener('click', () => speak(pair[L].zh, { rate: 0.75 }));
    $('#pHearB').addEventListener('click', () => speak(pair[R].zh, { rate: 0.75 }));
    $('#pNext').addEventListener('click', startPair);
    setTimeout(() => speak(pair[spoken].zh, { rate: 0.85 }), 150);
  }

  function onPick(e) {
    const b = e.target.closest('.pcard');
    if (!b || answered) return;
    answered = true;
    const ok = b.dataset.side === spoken;
    const stat = bump('pair:' + pair.id, ok);
    body.querySelectorAll('.pcard').forEach((c) => {
      c.classList.toggle('pcard-correct', c.dataset.side === spoken);
      if (c === b && !ok) c.classList.add('pcard-wrong');
    });
    $('#pFb').innerHTML = ok
      ? `<span class="fb-ok">○</span> ${pair[spoken].zh}（${pair[spoken].ja}）でした`
      : `<span class="fb-ng">✗</span> ${pair[spoken].zh}（${pair[spoken].ja}）でした。聞き比べてから次へ`;
    $('#pAfter').hidden = false;
    body.querySelector('.drill-tally').innerHTML =
      `このペア ${stat.ok}/${stat.total}${pair.note ? `<br>${pair.note}` : ''}`;
    if (ok) nextTimer = setTimeout(startPair, 1400);
  }

  return { start };
}
