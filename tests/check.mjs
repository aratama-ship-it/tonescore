// 聲調譜 — ロジックの検証（実行: node tests/check.mjs）
// 音声入出力は含まない。データ整合・注音変換・変調・判定・区間分割だけを見る。
import assert from 'node:assert/strict';
import { DECKS, syllables, isPunct } from '../js/data/phrases.js';
import { toBopomofo, toPinyinMarked, splitTone } from '../js/bopomofo.js';
import { applySandhi, contour, judge } from '../js/tones.js';
import { segment, normalize, medianHz, detect, smoothTrack } from '../js/pitch.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok', name); };

console.log('\n[1] フレーズデータの整合');
t('全項目で漢字数とピンイン数が一致する', () => {
  for (const d of DECKS) {
    for (const it of d.items) {
      const chars = Array.from(it.zh).filter((c) => !isPunct(c)).length;
      const py = it.pinyin.trim().split(/\s+/).length;
      assert.equal(chars, py, `${it.zh}: 漢字${chars} vs ピンイン${py}`);
    }
  }
});
t('全ピンインが声調数字つきで解釈できる', () => {
  for (const d of DECKS) {
    for (const it of d.items) {
      for (const p of it.pinyin.trim().split(/\s+/)) {
        assert.ok(!splitTone(p).invalid, `${it.zh} の ${p} が不正`);
      }
    }
  }
});
t('全音節が注音へ変換され、未変換のラテン文字が残らない', () => {
  for (const d of DECKS) {
    for (const it of d.items) {
      for (const p of it.pinyin.trim().split(/\s+/)) {
        const b = toBopomofo(p);
        assert.ok(!/[a-z]/i.test(b), `${p} → ${b} に未変換が残っている`);
      }
    }
  }
});
t('verify は ok / check のみ', () => {
  for (const d of DECKS) for (const it of d.items) assert.ok(['ok', 'check'].includes(it.verify), it.zh);
});

console.log('\n[2] 注音変換');
t('既知の音節が正しく変換される', () => {
  const cases = {
    zhe4: 'ㄓㄜˋ', ge5: '˙ㄍㄜ', duo1: 'ㄉㄨㄛ', shao3: 'ㄕㄠˇ', qian2: 'ㄑㄧㄢˊ',
    bu4: 'ㄅㄨˋ', hao3: 'ㄏㄠˇ', yi4: 'ㄧˋ', si5: '˙ㄙ', qing3: 'ㄑㄧㄥˇ', wen4: 'ㄨㄣˋ',
    xia4: 'ㄒㄧㄚˋ', wo3: 'ㄨㄛˇ', yao4: 'ㄧㄠˋ', you1: 'ㄧㄡ', jie2: 'ㄐㄧㄝˊ',
    yun4: 'ㄩㄣˋ', xu1: 'ㄒㄩ', ju4: 'ㄐㄩˋ', yue4: 'ㄩㄝˋ', yuan2: 'ㄩㄢˊ',
    zhi2: 'ㄓˊ', shi2: 'ㄕˊ', ri4: 'ㄖˋ', zi5: '˙ㄗ', ci4: 'ㄘˋ', er4: 'ㄦˋ',
    hui4: 'ㄏㄨㄟˋ', zhong1: 'ㄓㄨㄥ', iong: 'iong', liang4: 'ㄌㄧㄤˋ', niu2: 'ㄋㄧㄡˊ',
    lun2: 'ㄌㄨㄣˊ', gui1: 'ㄍㄨㄟ', xiong2: 'ㄒㄩㄥˊ', weng1: 'ㄨㄥ', wu3: 'ㄨˇ',
  };
  for (const [k, v] of Object.entries(cases)) {
    if (k === 'iong') continue; // 声調数字なしは対象外
    assert.equal(toBopomofo(k), v, `${k} → ${toBopomofo(k)}（期待 ${v}）`);
  }
});
t('ピンインの声調記号表示', () => {
  assert.equal(toPinyinMarked('hao3'), 'hǎo');
  assert.equal(toPinyinMarked('xie4'), 'xiè');
  assert.equal(toPinyinMarked('nv3'), 'nǚ');
  assert.equal(toPinyinMarked('jiu4'), 'jiù');
});

console.log('\n[3] 三声の変調');
t('3+3 → 2+3', () => {
  const r = applySandhi([3, 3]);
  assert.deepEqual(r.tones, [2, 3]);
  assert.deepEqual(r.changed, [true, false]);
});
t('3が4連続 → 2,2,2,3（単純規則の近似）', () => {
  assert.deepEqual(applySandhi([3, 3, 3, 3]).tones, [2, 2, 2, 3]);
});
t('3+4 は変わらない', () => {
  assert.deepEqual(applySandhi([3, 4]).tones, [3, 4]);
});

console.log('\n[4] 規範カーブ');
t('1声は平ら、2声は上昇、4声は下降、3声は谷を持つ', () => {
  const end = (c) => c[c.length - 1].st, top = (c) => c[0].st;
  const c1 = contour(1), c2 = contour(2), c3 = contour(3), c4 = contour(4);
  assert.ok(Math.abs(end(c1) - top(c1)) < 0.01);
  assert.ok(end(c2) > top(c2) + 3);
  assert.ok(end(c4) < top(c4) - 3);
  const min3 = Math.min(...c3.map((p) => p.st));
  assert.ok(min3 < top(c3) - 1 && min3 < end(c3) - 1);
});
t('軽声は短い（時間軸が1に届かない）', () => {
  assert.ok(contour(5)[contour(5).length - 1].t < 0.6);
});

console.log('\n[5] 判定');
const synth = (from, to, n = 20, dip = false) => Array.from({ length: n }, (_, i) => {
  const u = i / (n - 1);
  const st = dip ? from - 6 * Math.sin(Math.PI * u) + (to - from) * u : from + (to - from) * u;
  return { t: u, st };
});
t('正しい形を ok と判定する', () => {
  assert.ok(judge(1, synth(6, 6)).ok, '1声');
  assert.ok(judge(2, synth(0, 6)).ok, '2声');
  assert.ok(judge(4, synth(6, -6)).ok, '4声');
  assert.ok(judge(3, synth(-3, 3, 20, true)).ok, '3声');
  assert.ok(judge(3, synth(-1, -5)).ok, '3声（台湾式の低い下降）');
});
t('違う形を ng と判定し、理由を返す', () => {
  const r = judge(2, synth(0, 0));
  assert.equal(r.ok, false);
  assert.match(r.label, /上がって/);
  assert.ok(judge(4, synth(0, 3)).ok === false);
  assert.ok(judge(1, synth(-6, 6)).ok === false);
  assert.equal(judge(2, []).ok, false);
});

console.log('\n[6] 区間分割');
const frames = [];
{
  // 3つの有声区間（各0.25秒）を0.12秒の無声で区切る
  let t0 = 0;
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < 15; i++) { frames.push({ t: t0, hz: 200 + s * 10, rms: 0.1 }); t0 += 1 / 60; }
    for (let i = 0; i < 9; i++) { frames.push({ t: t0, hz: 0, rms: 0.001 }); t0 += 1 / 60; }
  }
}
t('期待数と一致すれば exact', () => {
  const r = segment(frames, 3);
  assert.equal(r.segs.length, 3);
  assert.equal(r.exact, true);
});
t('一致しなければ均等割へフォールバックし、区間数は期待どおり', () => {
  const r = segment(frames, 5);
  assert.equal(r.exact, false);
  assert.equal(r.segs.length, 5);
});
t('無声のみなら empty', () => {
  assert.equal(segment([{ t: 0, hz: 0, rms: 0 }], 2).empty, true);
});
t('中央値と半音正規化', () => {
  assert.equal(medianHz(frames), 210);
  const seg = { from: 0, to: 1, pts: [{ t: 0, hz: 100 }, { t: 1, hz: 200 }] };
  const n = normalize(seg, 100);
  assert.ok(Math.abs(n[0].st - 0) < 1e-9);
  assert.ok(Math.abs(n[1].st - 12) < 1e-9); // 1オクターブ = 12半音
});

console.log('\n[7] F0抽出（合成音での精度と速度）');
// 声に近い波形：基本波＋倍音を重ねる。48kHz / 2048サンプル = 実機と同条件
const voiceBuf = (f0, sr = 48000, n = 2048, amp = 0.25) => {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    b[i] = amp * (Math.sin(2 * Math.PI * f0 * t)
      + 0.5 * Math.sin(4 * Math.PI * f0 * t)
      + 0.25 * Math.sin(6 * Math.PI * f0 * t));
  }
  return b;
};
t('80〜400Hz を誤差1%以内で検出する', () => {
  for (const f0 of [80, 110, 147, 196, 220, 262, 330, 392]) {
    const { hz } = detect(voiceBuf(f0), 48000);
    const err = Math.abs(hz - f0) / f0;
    assert.ok(err < 0.01, `${f0}Hz → ${hz.toFixed(1)}Hz（誤差 ${(err * 100).toFixed(2)}%）`);
  }
});
t('無音は hz=0 を返す', () => {
  assert.equal(detect(new Float32Array(2048), 48000).hz, 0);
});
t('雑音（ホワイトノイズ）を有声と誤認しない', () => {
  const b = new Float32Array(2048);
  let seed = 42;
  for (let i = 0; i < b.length; i++) { seed = (seed * 1103515245 + 12345) % 2147483648; b[i] = (seed / 2147483648 - 0.5) * 0.3; }
  assert.equal(detect(b, 48000).hz, 0);
});
t('1フレームの処理が rAF の予算(16.6ms)に十分収まる', () => {
  const b = voiceBuf(200);
  detect(b, 48000); // ウォームアップ
  const t0 = performance.now();
  const N = 200;
  for (let i = 0; i < N; i++) detect(b, 48000);
  const ms = (performance.now() - t0) / N;
  console.log(`     1フレーム ${ms.toFixed(3)} ms（このMacでの実測）`);
  assert.ok(ms < 4, `1フレーム ${ms.toFixed(2)}ms は重すぎる`);
});

// iPhone実機（2026-08-18）で有声率3%しか出なかった条件を再現する回帰テスト。
// 生の音声は「小さい」「雑音が乗る」「相関の山がぎざぎざ」の3つが同時に来る。
const noisy = (f0, amp, snr) => {
  const b = voiceBuf(f0, 48000, 2048, amp);
  let seed = 7;
  for (let i = 0; i < b.length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    b[i] += (seed / 2147483648 - 0.5) * amp * 3 / snr;
  }
  return b;
};
t('小さい声（振幅0.02）でも検出できる', () => {
  for (const f0 of [110, 165, 220]) {
    const { hz } = detect(voiceBuf(f0, 48000, 2048, 0.02), 48000);
    assert.ok(Math.abs(hz - f0) / f0 < 0.02, `${f0}Hz → ${hz.toFixed(1)}Hz`);
  }
});
t('雑音混じり（SNR約10dB）でも検出でき、オクターブを外さない', () => {
  for (const f0 of [110, 165, 220, 300]) {
    const { hz } = detect(noisy(f0, 0.08, 3), 48000);
    assert.ok(Math.abs(hz - f0) / f0 < 0.05, `${f0}Hz → ${hz.toFixed(1)}Hz`);
  }
});

console.log('\n[8] F0トラックの整え');
t('単発の飛びをメディアンで潰す', () => {
  const f = [200, 202, 400, 201, 203].map((hz, i) => ({ t: i / 60, hz, rms: 0.1 }));
  const s = smoothTrack(f).map((x) => x.hz);
  assert.equal(s[2], 202, `飛びが残っている: ${s[2]}`);
});
t('前後が有声の1フレームの穴を埋める', () => {
  const f = [200, 0, 210].map((hz, i) => ({ t: i / 60, hz, rms: 0.1 }));
  assert.equal(smoothTrack(f)[1].hz, 205);
});
t('孤立した有声フレームは雑音として落とす', () => {
  const f = [0, 300, 0].map((hz, i) => ({ t: i / 60, hz, rms: 0.1 }));
  assert.equal(smoothTrack(f)[1].hz, 0);
});
t('整えても長さと時刻は変わらない', () => {
  const f = [200, 0, 210, 400, 205].map((hz, i) => ({ t: i / 60, hz, rms: 0.1 }));
  const s = smoothTrack(f);
  assert.equal(s.length, f.length);
  assert.deepEqual(s.map((x) => x.t), f.map((x) => x.t));
});

console.log('\n[9] 音節展開');
t('句読点はピンインを消費しない', () => {
  const s = syllables({ zh: '謝謝，麻煩你了。', pinyin: 'xie4 xie5 ma2 fan5 ni3 le5' });
  assert.equal(s.filter((x) => !x.punct).length, 6);
  assert.equal(s.filter((x) => x.punct).length, 2);
});

console.log(`\n${pass} 件すべて通過\n`);
