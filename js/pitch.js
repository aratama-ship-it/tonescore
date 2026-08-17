// マイク入力から基本周波数(F0)を実測する。
// 手法：正規化自己相関（ACF / NSDF系）。声のF0帯 70–420Hz に限定して探索する。
// 話者の絶対音高は比較に使わない。各収録の中央値を 0 半音として正規化する。

const MIN_HZ = 70;
const MAX_HZ = 420;
const CLARITY = 0.62;   // 相関のしきい値。これ未満は無声とみなす
const RMS_GATE = 0.012; // 無音ゲート

export class PitchRecorder {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.buf = null;
    this.frames = [];
    this.running = false;
    this.recorder = null;
    this.chunks = [];
    this.lastBlobUrl = null;
  }

  async ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.stream) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.buf = new Float32Array(this.analyser.fftSize);
      src.connect(this.analyser);
    }
    return this.ctx;
  }

  start() {
    this.frames = [];
    this.running = true;
    this.t0 = performance.now();
    // 聞き比べ用に音声そのものも保存する（対応環境のみ）
    try {
      if (window.MediaRecorder && this.stream) {
        this.chunks = [];
        const mime = ['audio/mp4', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m));
        this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
        this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
        this.recorder.start();
      }
    } catch { this.recorder = null; }
    const loop = () => {
      if (!this.running) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      const { hz, rms } = detect(this.buf, this.ctx.sampleRate);
      this.frames.push({ t: (performance.now() - this.t0) / 1000, hz, rms });
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.onstop = () => {
        if (this.lastBlobUrl) URL.revokeObjectURL(this.lastBlobUrl);
        this.lastBlobUrl = URL.createObjectURL(new Blob(this.chunks, { type: this.chunks[0]?.type || 'audio/mp4' }));
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
  if (rms < RMS_GATE) return { hz: 0, rms };

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
  if (maxLag <= minLag + 2) return { hz: 0, rms };

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
  if (bestCorr < CLARITY) return { hz: 0, rms };

  // ★最大値ではなく「最初の十分に高い山」を採る。
  //   ラグが大きいほど重なる区間が短くなり正規化相関が持ち上がるため、
  //   最大値を採ると周期の2倍（1オクターブ下）を掴む。実測で147Hz→73.5Hzになった。
  const TH = bestCorr * 0.86;
  let bestLag = -1;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (corr[lag] >= TH && corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1]) { bestLag = lag; break; }
  }
  if (bestLag < 0) return { hz: 0, rms };
  bestCorr = corr[bestLag];

  // 放物線補間でラグを精密化（相関は上で計算済みのものを使う）
  const y0 = corr[bestLag - 1] || bestCorr, y1 = bestCorr, y2 = corr[bestLag + 1] || bestCorr;
  const denom = 2 * (2 * y1 - y0 - y2);
  const shift = denom !== 0 ? (y2 - y0) / denom : 0;
  return { hz: sr / (bestLag + shift), rms };
}

/** 有声フレームの中央値Hz */
export function medianHz(frames) {
  const hz = frames.filter((f) => f.hz > 0).map((f) => f.hz).sort((a, b) => a - b);
  if (!hz.length) return 0;
  return hz[Math.floor(hz.length / 2)];
}

/**
 * 有声区間を音節候補へ分割する。
 * 期待音節数と一致しない場合は均等割にフォールバックし、その旨を返す（黙って推測しない）。
 */
export function segment(frames, expected) {
  const voiced = [];
  let cur = null;
  const GAP = 0.055; // これ以上の無声で区切る
  for (const f of frames) {
    if (f.hz > 0) {
      if (!cur) cur = { from: f.t, to: f.t, pts: [] };
      cur.to = f.t;
      cur.pts.push(f);
    } else if (cur && f.t - cur.to > GAP) {
      voiced.push(cur); cur = null;
    }
  }
  if (cur) voiced.push(cur);

  const segs = voiced.filter((s) => s.to - s.from > 0.045);
  if (!segs.length) return { segs: [], exact: false, empty: true };
  if (segs.length === expected) return { segs, exact: true };

  // 均等割フォールバック：全有声区間を音節数で等分する
  const from = segs[0].from, to = segs[segs.length - 1].to;
  const all = frames.filter((f) => f.hz > 0 && f.t >= from && f.t <= to);
  const step = (to - from) / expected;
  const out = [];
  for (let i = 0; i < expected; i++) {
    const a = from + step * i, b = a + step;
    const pts = all.filter((f) => f.t >= a && f.t <= (i === expected - 1 ? to + 1 : b));
    out.push({ from: a, to: b, pts });
  }
  return { segs: out, exact: false };
}

/** 区間を「0..1 の時間 × 半音（基準Hz比）」へ正規化 */
export function normalize(seg, refHz) {
  if (!seg || !seg.pts.length || !refHz) return [];
  const span = Math.max(0.001, seg.to - seg.from);
  return seg.pts
    .filter((p) => p.hz > 0)
    .map((p) => ({ t: Math.min(1, Math.max(0, (p.t - seg.from) / span)), st: 12 * Math.log2(p.hz / refHz) }));
}
