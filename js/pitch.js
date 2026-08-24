// マイク入力から基本周波数(F0)を実測する。
// 手法：正規化自己相関（ACF / NSDF系）。声のF0帯 70–420Hz に限定して探索する。
// 話者の絶対音高は比較に使わない。各収録の中央値を 0 半音として正規化する。

const MIN_HZ = 70;
const MAX_HZ = 420;
// ★しきい値は iPhone 実機の実測で決めた値。机上の値に戻さないこと。
//   2026-08-18 1回目: CLARITY 0.62 / RMS_GATE 0.012 → 有声率3%（ほぼ全部捨てていた）
//   2026-08-18 2回目: CLARITY 0.45 / RMS_GATE 0.005 → 有声率28〜42%（まだ半分近く落ちる）
//   → 音量の絶対値で切るのをやめ、**その収録の最大音量に対する相対値**で有声を決める
//     （decideVoicing）。マイクの入力レベルは端末・距離・声量で桁が変わるため。
const CLARITY = 0.38;    // 相関のしきい値。これ未満は周期性なしとみなす
const RMS_FLOOR = 0.0015; // 完全な無音。これ未満は計算もしない
const SAMPLE_MS = 16;   // 取り込み間隔（約62回/秒）

export class PitchRecorder {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.buf = null;
    this.frames = [];
    this.running = false;
    this.recorder = null;
    this.timer = null;
    this.recOffset = 0; // 解析の t=0 と、録音音声の 0秒 とのズレ（秒）
    this.granted = false; // 一度でもマイクの許可が取れたか
    this.lastBlob = null;
    this.chunks = [];
    this.lastBlobUrl = null;
  }

  /**
   * マイクと解析グラフを用意する。所要時間を this.timing に記録する（体感を推測で語らないため）。
   * ★AudioContext の生成と resume はユーザー操作と同じタスクの中で始める（iOSの制約）。
   *   ただし resume は await しない。許可ダイアログを出している間に裏で進ませる。
   */
  async ensure() {
    const t0 = performance.now();
    const first = !this.granted;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});

    let permMs = 0;
    if (!this.stream) {
      // 読み上げが鳴っていると、iOSではオーディオセッションの奪い合いで待たされる
      try { window.speechSynthesis?.cancel?.(); } catch { /* 無視 */ }
      const tp = performance.now();
      // ノイズ抑制はピッチを崩すので切る。自動ゲインは音量を稼ぐため入れる
      // （実機で入力が小さく、有声判定が落ちていたため 2026-08-18 に true へ変更）。
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
      permMs = performance.now() - tp;
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.buf = new Float32Array(this.analyser.fftSize);
      src.connect(this.analyser);
    }
    if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch { /* 無視 */ } }
    this.granted = true;
    this.timing = { first, permMs: Math.round(permMs), totalMs: Math.round(performance.now() - t0) };
    return this.ctx;
  }

  /** 許可が取れているか（準備ボタンを出すかの判定。手放していてもtrue） */
  get ready() { return this.granted; }

  /**
   * マイクを手放す。
   * ★iOSは**マイクを掴んでいる間、音の出口を受話口（耳に当てる小さいスピーカー）に切り替える**。
   *   録音した声を聞き返すときに音量を最大にしても小さくしか鳴らないのはこれが原因。
   *   再生の前に必ず手放す。次に録音するときは ensure() が取り直す（許可は残る）。
   */
  release() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* 無視 */ } });
      this.stream = null;
      this.analyser = null;
    }
  }

  /** @param onFrame 収録中の状態を返すコールバック（UIの手応え用。約100msごと） */
  start(onFrame) {
    this.frames = [];
    this.running = true;
    this.t0 = performance.now();
    let lastReport = 0;
    // ★音声の取り込みは requestAnimationFrame ではなくタイマーで回す。
    //   rAF は「描画」の都合で止まる／間引かれる：タブが非表示だと発火せず、
    //   iPhone の低電力モードでは30fpsに落ちてサンプル密度が半分になる。
    //   声調の形を追うのに描画の都合を持ち込まない。
    const tick = () => {
      if (!this.running) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      const { hz, rms, clarity } = detect(this.buf, this.ctx.sampleRate);
      const now = performance.now();
      this.frames.push({ t: (now - this.t0) / 1000, hz, rms, clarity });
      if (onFrame && now - lastReport > 55) { // 実況を描くので短め
        lastReport = now;
        const v = this.frames.filter((f) => f.hz > 0).length;
        onFrame({ hz, rms, voicedRatio: v / this.frames.length, frames: this.frames.length });
      }
    };
    clearInterval(this.timer);
    this.timer = setInterval(tick, SAMPLE_MS);
    tick(); // 1フレーム目を待たない

    // 聞き比べ用の録音は「あると嬉しい」機能。MediaRecorder の起動は iOS で
    // 数百ms かかることがあるため、解析の開始を待たせないよう後回しにする。
    setTimeout(() => {
      if (!this.running) return;
      try {
        if (window.MediaRecorder && this.stream) {
          this.chunks = [];
          this.recOffset = (performance.now() - this.t0) / 1000;
          const mime = ['audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m));
          this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
          this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
          this.recorder.start();
        }
      } catch { this.recorder = null; }
    }, 0);
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = () => {
        if (this.lastBlobUrl) URL.revokeObjectURL(this.lastBlobUrl);
        this.lastBlob = new Blob(this.chunks, { type: this.chunks[0]?.type || 'audio/mp4' });
        this.lastBlobUrl = URL.createObjectURL(this.lastBlob);
      };
      this.recorder.stop();
    }
    return this.frames;
  }
}

// F0は最大420Hzしか見ないので、12kHz相当まで間引いてから相関を取る。
// 48kHzのまま全ラグを走らせると1フレーム約85万回の積和になり、iPhoneのrAF(60fps)に間に合わない。
// 間引き後は約6万回まで落ちる。分解能は放物線補間で補う（200Hz付近で約0.1半音）。
const TARGET_SR = 12000;
let dec = null; // 間引き用バッファを使い回す

export function detect(buf, sampleRate) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < RMS_FLOOR) return { hz: 0, rms, clarity: 0 };

  const D = Math.max(1, Math.round(sampleRate / TARGET_SR));
  const sr = sampleRate / D;
  const n = Math.floor(buf.length / D);
  if (!dec || dec.length !== n) dec = new Float32Array(n);
  // D個の平均で間引く（粗いローパス兼ダウンサンプル）
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k < D; k++) s += buf[i * D + k];
    dec[i] = s / D;
  }

  const minLag = Math.floor(sr / MAX_HZ);
  const maxLag = Math.min(Math.floor(sr / MIN_HZ), n - 8);
  if (maxLag <= minLag + 2) return { hz: 0, rms, clarity: 0 };

  const corr = new Float32Array(maxLag + 2);
  let bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0, d1 = 0, d2 = 0;
    for (let i = 0; i + lag < n; i++) {
      const a = dec[i], b = dec[i + lag];
      num += a * b; d1 += a * a; d2 += b * b;
    }
    const c = num / (Math.sqrt(d1 * d2) || 1);
    corr[lag] = c;
    if (c > bestCorr) bestCorr = c;
  }
  if (bestCorr < CLARITY) return { hz: 0, rms, clarity: bestCorr };

  // ★最大値ではなく「最初の十分に高い山」を採る。
  //   ラグが大きいほど重なる区間が短くなり正規化相関が持ち上がるため、
  //   最大値を採ると周期の2倍（1オクターブ下）を掴む。実測で147Hz→73.5Hzになった。
  const TH = bestCorr * 0.86;
  let bestLag = -1, maxLagAt = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (corr[lag] === bestCorr) { maxLagAt = lag; break; }
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (corr[lag] >= TH && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) { bestLag = lag; break; }
  }
  // 実機の生音声では、雑音で山がぎざぎざになり「局所最大」条件に当てはまらないフレームが多い。
  // そこで見つからない場合は最大値の位置へ落とす（フレームを捨てない方を優先する）。
  if (bestLag < 0) bestLag = maxLagAt;
  bestCorr = corr[bestLag];

  // 放物線補間でラグを精密化（相関は上で計算済みのものを使う）
  const y0 = corr[bestLag - 1] || bestCorr, y1 = bestCorr, y2 = corr[bestLag + 1] || bestCorr;
  const denom = 2 * (2 * y1 - y0 - y2);
  const shift = denom !== 0 ? (y2 - y0) / denom : 0;
  return { hz: sr / (bestLag + shift), rms, clarity: bestCorr };
}

/**
 * 収録の端を切り落とす。
 * ★押し始めと「指を離す瞬間」は声ではない音（タップ音、声の減衰、息）が混ざり、
 *   周期推定が短い側へ飛んで**カーブの最後が跳ね上がる**（2026-08-18の実機で報告）。
 *   離し際のほうが害が大きいので厚めに落とす。
 */
export function trimEdges(frames, headSec = 0.04, tailSec = 0.12) {
  if (!frames.length) return frames;
  const end = frames[frames.length - 1].t;
  return frames.map((f) => (f.t < headSec || f.t > end - tailSec ? { ...f, hz: 0 } : f));
}

/**
 * 収録全体の中央値から大きく外れたF0を捨てる。
 * 声の高さが一息の中で1オクターブ以上動くことはない。飛んでいるなら推定を外している。
 */
export function rejectOutliers(frames, maxSemitones = 7) {
  const ref = medianHz(frames);
  if (!ref) return frames;
  return frames.map((f) => {
    if (!f.hz) return f;
    const st = Math.abs(12 * Math.log2(f.hz / ref));
    return st > maxSemitones ? { ...f, hz: 0 } : f;
  });
}

/**
 * 有声/無声の判定を、収録全体を見てから決める。
 * マイクの入力レベルは端末・口との距離・声量で桁が変わるので、絶対値では切れない。
 * 「その収録で一番大きかった音の何%か」で判断する。
 */
export function decideVoicing(frames) {
  const maxRms = frames.reduce((m, f) => Math.max(m, f.rms), 0);
  if (!maxRms) return frames.map((f) => ({ ...f, hz: 0 }));
  const gate = Math.max(maxRms * 0.09, RMS_FLOOR * 2); // 最大音量の9%（約-21dB）
  return frames.map((f) => ({ ...f, hz: f.rms >= gate ? f.hz : 0 }));
}

/**
 * F0トラックの整え。実機の生音声には単発の飛びと単発の取りこぼしが混ざる。
 * ①有声の中を3点メディアンで平滑化 ②前後が有声な1フレームの穴を補間
 * ③前後が無声な孤立した有声フレームは雑音とみなして落とす
 */
export function smoothTrack(frames) {
  const hz = frames.map((f) => f.hz);
  const out = hz.slice();
  for (let i = 1; i < hz.length - 1; i++) {
    const a = hz[i - 1], b = hz[i], c = hz[i + 1];
    if (b > 0 && a > 0 && c > 0) {
      out[i] = [a, b, c].sort((x, y) => x - y)[1];           // ①
    } else if (b === 0 && a > 0 && c > 0) {
      out[i] = (a + c) / 2;                                   // ②
    } else if (b > 0 && a === 0 && c === 0) {
      out[i] = 0;                                             // ③
    }
  }
  return frames.map((f, i) => ({ ...f, hz: out[i] }));
}

/** 有声フレームの中央値Hz */
export function medianHz(frames) {
  const hz = frames.filter((f) => f.hz > 0).map((f) => f.hz).sort((a, b) => a - b);
  if (!hz.length) return 0;
  return hz[Math.floor(hz.length / 2)];
}

/**
 * 音節の核（母音）を、音量の山として数える。
 *
 * ★自然な速さで喋ると音節は繋がり、無声の切れ目は現れない。
 *   「一番音量が小さい所で割る」では当たらない（2026-08-19の実機報告）。
 *   音節はひとつにつき母音＝音量の山を1つ持つので、**山を数えて谷で割る**。
 *   山の「際立ち（prominence）」で数を合わせるため、弱い山（子音の渡り）に釣られない。
 * @returns {Array|null} 期待数ぶんの区間。山が足りなければ null（呼び出し側が別の手を使う）
 */
export function syllableNuclei(frames, expected) {
  const voiced = frames.filter((f) => f.hz > 0);
  if (voiced.length < expected * 3) return null;
  const from = voiced[0].t, to = voiced[voiced.length - 1].t;
  const win = frames.filter((f) => f.t >= from && f.t <= to);
  if (win.length < expected * 3) return null;

  // 音量を5点移動平均でならす（1フレームのゆらぎで山が乱立しないように）
  const env = win.map((_, i) => {
    let sum = 0, n = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(win.length - 1, i + 2); k++) { sum += win[k].rms; n++; }
    return sum / n;
  });

  // 局所最大と、その際立ちを dB で測る。
  // ★端にある山も数える（範囲外は -∞ として扱う）。端を無視すると、
  //   最初や最後の音節の山を取りこぼして数が合わなくなる。
  const at = (i) => (i < 0 || i >= env.length ? -Infinity : env[i]);
  const peaks = [];
  for (let i = 0; i < env.length; i++) {
    if (env[i] >= at(i - 1) && env[i] > at(i + 1)) {
      let l = env[i], r = env[i];
      for (let k = i; k >= 0 && env[k] <= env[i]; k--) l = Math.min(l, env[k]);
      for (let k = i; k < env.length && env[k] <= env[i]; k++) r = Math.min(r, env[k]);
      const base = Math.max(l, r);
      peaks.push({ i, prom: 20 * Math.log10((env[i] + 1e-9) / (base + 1e-9)) });
    }
  }
  if (peaks.length < expected) return null;

  // 際立ちの大きい順に必要数だけ採り、時間順へ戻す
  const keep = peaks.slice().sort((a, b) => b.prom - a.prom).slice(0, expected).sort((a, b) => a.i - b.i);

  // 隣り合う山の谷を境界にする
  const bounds = [0];
  for (let k = 0; k < keep.length - 1; k++) {
    let at = keep[k].i, lowest = Infinity;
    for (let i = keep[k].i; i <= keep[k + 1].i; i++) {
      if (env[i] < lowest) { lowest = env[i]; at = i; }
    }
    bounds.push(at);
  }
  bounds.push(win.length - 1);

  const segs = [];
  for (let k = 0; k < expected; k++) {
    const pts = win.slice(bounds[k], bounds[k + 1] + 1).filter((f) => f.hz > 0);
    if (pts.length < 3) return null;
    segs.push({ from: pts[0].t, to: pts[pts.length - 1].t, pts });
  }
  return segs;
}

/**
 * 有声区間を音節へ割り当てる。
 *
 * ★以前は「検出数が音節数と一致しなければ全体を均等割」にしていたが、
 *   実機では声が途切れて数が合わないのが普通で、ほぼ常に均等割になり、
 *   カーブが実際とは違う列に描かれていた（2026-08-18の実機で確認）。
 *   いまは実際の声のかたまりを起点に、**足りなければ長い塊を割り、多ければ近い塊を結合**して
 *   音節数へ合わせる。何をしたかは adjusted で返す（黙って推測しない）。
 */
export function segment(frames, expected) {
  const GAP = 0.09; // これ以上の無声で区切る
  const runs = [];
  let cur = null;
  for (const f of frames) {
    if (f.hz > 0) {
      if (!cur) cur = { from: f.t, to: f.t, pts: [] };
      cur.to = f.t;
      cur.pts.push(f);
    } else if (cur && f.t - cur.to > GAP) {
      runs.push(cur); cur = null;
    }
  }
  if (cur) runs.push(cur);

  let segs = runs.filter((s) => s.to - s.from >= 0.035 && s.pts.length >= 3);
  if (!segs.length) return { segs: [], exact: false, empty: true };

  const detected = segs.length;
  if (detected === expected) return { segs, exact: true, detected, adjusted: { merged: 0, split: 0 } };

  // ★足りないとき＝音節が繋がって喋られたとき。音量の山（母音）を数えて割る。
  //   自然な速さではこれが本命の経路。逆に多すぎるときは無声の切れ目という強い証拠が
  //   あるので、そちらを信じて結合する（下）。
  if (detected < expected) {
    const byNuclei = syllableNuclei(frames, expected);
    if (byNuclei) return { segs: byNuclei, exact: false, detected, adjusted: { merged: 0, split: 0, nuclei: true } };
  }

  let merged = 0, split = 0;

  // 多すぎる：間隔が最も狭い隣同士から結合していく
  while (segs.length > expected) {
    let at = 0, best = Infinity;
    for (let i = 0; i < segs.length - 1; i++) {
      const gap = segs[i + 1].from - segs[i].to;
      if (gap < best) { best = gap; at = i; }
    }
    segs.splice(at, 2, {
      from: segs[at].from,
      to: segs[at + 1].to,
      pts: segs[at].pts.concat(segs[at + 1].pts),
    });
    merged++;
  }

  // 足りない：最も長い塊を、その中で一番音量が小さい所で割る
  while (segs.length < expected) {
    let at = 0, longest = -1;
    segs.forEach((s, i) => { if (s.to - s.from > longest) { longest = s.to - s.from; at = i; } });
    const s0 = segs[at];
    if (s0.pts.length < 6) break; // これ以上割れない
    const lo = Math.floor(s0.pts.length * 0.25), hi = Math.ceil(s0.pts.length * 0.75);
    let cutAt = Math.floor(s0.pts.length / 2), minRms = Infinity;
    for (let i = lo; i < hi; i++) {
      if (s0.pts[i].rms < minRms) { minRms = s0.pts[i].rms; cutAt = i; }
    }
    const a = s0.pts.slice(0, cutAt), b = s0.pts.slice(cutAt);
    segs.splice(at, 1,
      { from: a[0].t, to: a[a.length - 1].t, pts: a },
      { from: b[0].t, to: b[b.length - 1].t, pts: b });
    split++;
  }

  return { segs, exact: detected === expected, detected, adjusted: { merged, split } };
}

/** 区間を「0..1 の時間 × 半音（基準Hz比）」へ正規化 */
export function normalize(seg, refHz) {
  if (!seg || !seg.pts.length || !refHz) return [];
  const span = Math.max(0.001, seg.to - seg.from);
  return seg.pts
    .filter((p) => p.hz > 0)
    .map((p) => ({ t: Math.min(1, Math.max(0, (p.t - seg.from) / span)), st: 12 * Math.log2(p.hz / refHz) }));
}
