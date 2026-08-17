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

function detect(buf, sampleRate) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < RMS_GATE) return { hz: 0, rms };

  const minLag = Math.floor(sampleRate / MAX_HZ);
  const maxLag = Math.min(Math.floor(sampleRate / MIN_HZ), Math.floor(buf.length / 2));
  let bestLag = -1, bestCorr = 0;
  let prev = 0, rising = false;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0, d1 = 0, d2 = 0;
    for (let i = 0; i + lag < buf.length; i++) {
      num += buf[i] * buf[i + lag];
      d1 += buf[i] * buf[i];
      d2 += buf[i + lag] * buf[i + lag];
    }
    const corr = num / (Math.sqrt(d1 * d2) || 1);
    // 最初の谷を越えてから探す（オクターブ下の誤検出を避ける）
    if (!rising && corr < prev) rising = true;
    if (rising && corr > bestCorr) { bestCorr = corr; bestLag = lag; }
    prev = corr;
  }
  if (bestLag < 0 || bestCorr < CLARITY) return { hz: 0, rms };

  // 放物線補間でラグを精密化
  const y = (l) => {
    let num = 0, d1 = 0, d2 = 0;
    for (let i = 0; i + l < buf.length; i++) {
      num += buf[i] * buf[i + l]; d1 += buf[i] * buf[i]; d2 += buf[i + l] * buf[i + l];
    }
    return num / (Math.sqrt(d1 * d2) || 1);
  };
  const y0 = y(bestLag - 1), y1 = bestCorr, y2 = y(bestLag + 1);
  const denom = 2 * (2 * y1 - y0 - y2);
  const shift = denom !== 0 ? (y2 - y0) / denom : 0;
  return { hz: sampleRate / (bestLag + shift), rms };
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
