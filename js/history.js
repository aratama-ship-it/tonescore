// 声調ごとの弱点を溜める。
//
// ★方針：判定そのものはここでは一切しない（tones.js の judge() が正）。
//   ここは「判定の結果を記録し、数え直すだけ」。判定を変えたら履歴の意味も変わるので、
//   保存するのは判定の結論（ok / 声調 / ラベル）だけにして、数値は残さない。
//
// ★保存はこの端末のブラウザにだけ残る（localStorage）。同期はしない。
//   台湾で機内モードでも動くことを優先し、外部送信は一切しない。

const KEY = 'tonescore.history.v1';
const MAX = 2000; // 1回の発声で最大十数件。数千件あれば数ヶ月分を賄える

/** 記録の1件。判定の結論だけを持つ */
// { at: 秒(整数), tone: 1..5, ok: bool, label: '沈んでいません', char: '好' }

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch {
    return []; // 壊れていたら黙って空から始める（学習の邪魔をしない）
  }
}

function save(rows) {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows.slice(-MAX)));
  } catch {
    /* 容量超過などは無視。履歴は付加価値であって本体機能ではない */
  }
}

/**
 * 1回の発声ぶんの判定結果を記録する。
 * @param user analyze() が作る [{syl, verdict}] の配列
 * @param nowSec 記録時刻（秒）。テストから固定値を渡せるようにしている
 */
export function record(user, nowSec = Math.floor(Date.now() / 1000)) {
  if (!Array.isArray(user) || !user.length) return;
  const rows = load();
  for (const u of user) {
    if (!u?.syl || !u?.verdict) continue;
    if (u.verdict.label === '—') continue; // 声が取れなかったものは記録しない
    rows.push({
      at: nowSec,
      tone: u.syl.realized,
      ok: !!u.verdict.ok,
      label: u.verdict.label,
      char: u.syl.char,
    });
  }
  save(rows);
}

/**
 * 声調ごとの成績を数える。
 * @param rows 省略時は保存済みの全件
 * @returns [{tone, total, ok, rate}] 声調番号順
 */
export function byTone(rows = load()) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.tone)) map.set(r.tone, { tone: r.tone, total: 0, ok: 0 });
    const m = map.get(r.tone);
    m.total++;
    if (r.ok) m.ok++;
  }
  return [...map.values()]
    .map((m) => ({ ...m, rate: m.total ? m.ok / m.total : 0 }))
    .sort((a, b) => a.tone - b.tone);
}

/**
 * いま一番の弱点を1つ返す。
 * ★試行回数が少ないものを「弱点」と断定しない（3回未満は判断材料にしない）。
 *   偶然の1回で「あなたの弱点は第三声です」と言うのは推測でしかない。
 * @returns {{tone, total, ok, rate, label}|null}
 */
export function weakest(rows = load(), minTotal = 3) {
  const cands = byTone(rows).filter((m) => m.total >= minTotal && m.rate < 1);
  if (!cands.length) return null;
  cands.sort((a, b) => a.rate - b.rate || b.total - a.total);
  const w = cands[0];
  // その声調で一番よく出た指摘を添える（何が起きているかまで言う）
  const labels = new Map();
  for (const r of rows) {
    if (r.tone !== w.tone || r.ok) continue;
    labels.set(r.label, (labels.get(r.label) || 0) + 1);
  }
  const top = [...labels.entries()].sort((a, b) => b[1] - a[1])[0];
  return { ...w, label: top ? top[0] : '' };
}

/** 直近 n 件の連続した失敗数（同じ声調で何回続けて外しているか） */
export function currentStreak(tone, rows = load()) {
  let n = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].tone !== tone) continue;
    if (rows[i].ok) break;
    n++;
  }
  return n;
}

export function all() { return load(); }

export function clear() {
  try { localStorage.removeItem(KEY); } catch { /* 無視 */ }
}
