// 声調の規範カーブ（五度式 Chao tone letters）と、旋律としての可聴化。
//
// ★重要：ここで作るカーブは「規範値」であり、実音声の実測ではない。
//   ブラウザの音声合成の出力波形は解析用に取り出せないため、模範側は理論値で描く。
//   実測されるのは利用者自身の声だけ。UI にもその旨を明記している。
//
// 五度式：1が最低、5が最高。level → 半音 = (level - 3) * 3
//   1声 55 / 2声 35 / 3声 214 / 4声 51 / 軽声 = 短く中低

const LEVELS = {
  1: [5, 5],
  2: [3, 5],
  3: [2, 1, 4],
  4: [5, 1],
  5: [3, 2.4],
};

export const TONE_NAMES = { 1: '第一声（高く平ら）', 2: '第二声（上がる）', 3: '第三声（低く沈む）', 4: '第四声（落ちる）', 5: '軽声（短く軽く）' };

export const levelToSemitone = (lv) => (lv - 3) * 3;

/** 声調番号 → 正規化時間 0..1 の {t, st} 配列（半音、話者の中央ピッチ基準） */
export function contour(tone, steps = 24) {
  const pts = LEVELS[tone] || LEVELS[1];
  const out = [];
  const span = tone === 5 ? 0.45 : 1; // 軽声は短い
  for (let i = 0; i < steps; i++) {
    const u = i / (steps - 1);
    const x = u * (pts.length - 1);
    const i0 = Math.min(Math.floor(x), pts.length - 2);
    const f = x - i0;
    // 3声の谷を滑らかに（線形だと折れて見える）
    const e = f * f * (3 - 2 * f);
    const lv = pts[i0] + (pts[i0 + 1] - pts[i0]) * e;
    out.push({ t: u * span, st: levelToSemitone(lv) });
  }
  return out;
}

/**
 * 三声連続の変調（3+3 → 前が2声で実現される）。
 * 台湾華語でも起きる基本の変調。不/一 の変調は語彙側のピンインに織り込み済み。
 * @returns {{tones:number[], changed:boolean[]}}
 */
export function applySandhi(tones) {
  const out = tones.slice();
  const changed = tones.map(() => false);
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i] === 3 && tones[i + 1] === 3) {
      out[i] = 2;
      changed[i] = true;
    }
  }
  return { tones: out, changed };
}

/** 声調を「旋律」として鳴らす。掴めていない声調は、まずハミングで捕まえる。 */
export function playToneMelody(ctx, tones, baseHz = 165, perSyl = 0.5) {
  const now = ctx.currentTime + 0.05;
  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 1400;
  osc.connect(filt).connect(master);

  let t = now;
  const hzAt = (st) => baseHz * Math.pow(2, st / 12);
  osc.frequency.setValueAtTime(hzAt(contour(tones[0])[0].st), t);
  master.gain.setValueAtTime(0.0001, t);

  tones.forEach((tone, i) => {
    const pts = contour(tone, 18);
    const dur = perSyl * (tone === 5 ? 0.55 : 1);
    master.gain.setTargetAtTime(0.16, t, 0.02);
    pts.forEach((p) => {
      osc.frequency.linearRampToValueAtTime(hzAt(p.st), t + p.t * dur);
    });
    t += dur;
    if (i < tones.length - 1) {
      master.gain.setTargetAtTime(0.0001, t - 0.04, 0.012); // 音節間を切る
      t += 0.09;
    }
  });
  master.gain.setTargetAtTime(0.0001, t, 0.03);
  osc.start(now);
  osc.stop(t + 0.3);
  return t - now;
}

/**
 * 利用者の実測カーブ（半音, 0..1 正規化）を規範と突き合わせる。
 * 判定は「形（方向）」のみ。絶対の高さは話者ごとに違うため見ない。
 * @returns {{ok:boolean, label:string, detail:string}}
 */
export function judge(tone, curve) {
  if (!curve || curve.length < 4) return { ok: false, label: '—', detail: '声が取れませんでした' };
  const st = curve.map((p) => p.st);
  const head = avg(st.slice(0, Math.max(2, Math.round(st.length * 0.2))));
  const tail = avg(st.slice(-Math.max(2, Math.round(st.length * 0.2))));
  const min = Math.min(...st);
  const max = Math.max(...st);
  const delta = tail - head;
  const range = max - min;
  const f1 = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;

  switch (tone) {
    case 1:
      if (range <= 2.6) return ok('平らに保てています', `振れ幅 ${range.toFixed(1)}半音`);
      return ng('平らになっていません', `振れ幅 ${range.toFixed(1)}半音。第一声は一本の線で伸ばす`);
    case 2:
      if (delta >= 2.2) return ok('上がっています', `${f1(delta)}半音`);
      if (delta >= 0.8) return ng('上がりが足りません', `${f1(delta)}半音。低く入って上げ切る`);
      return ng('上がっていません', `${f1(delta)}半音。始点をもっと低く取る`);
    case 3: {
      const dipOk = min <= head - 1.2 && min <= tail - 0.8;
      const lowFall = delta <= -1.5;
      if (dipOk) return ok('沈んで戻せています', `谷 ${(head - min).toFixed(1)}半音`);
      if (lowFall) return ok('低く沈んでいます（台湾でよく聞く形）', '尾を上げない三声。単独では上げると明確');
      return ng('沈んでいません', '三声はまず低く落とす。上げは最後の一瞬だけ');
    }
    case 4:
      if (delta <= -2.5) return ok('落ちています', `${f1(delta)}半音`);
      if (delta <= -1) return ng('落としが浅いです', `${f1(delta)}半音。高く入って一気に落とす`);
      return ng('落ちていません', `${f1(delta)}半音。始点を高く取る`);
    case 5:
      if (range <= 3) return ok('軽く置けています', `振れ幅 ${range.toFixed(1)}半音`);
      return ng('軽声に声調がついています', '軽声は短く・力を抜いて置くだけ');
    default:
      return { ok: false, label: '—', detail: '' };
  }
  function ok(label, detail) { return { ok: true, label, detail }; }
  function ng(label, detail) { return { ok: false, label, detail }; }
}

const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
