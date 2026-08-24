// 聲調譜 — ロジックの検証（実行: node tests/check.mjs）
// 音声入出力は含まない。データ整合・注音変換・変調・判定・区間分割だけを見る。
import assert from 'node:assert/strict';
import { DECKS, syllables, isPunct } from '../js/data/phrases.js';
import { toBopomofo, toPinyinMarked, splitTone } from '../js/bopomofo.js';
import { applySandhi, contour, judge } from '../js/tones.js';
import { segment, normalize, medianHz, detect, smoothTrack, decideVoicing, trimEdges, rejectOutliers, syllableNuclei } from '../js/pitch.js';

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok', name); };

console.log('\n[0] 版の整合（配信物の取り違え防止）');
// ★新しいHTML＋古いJSの組み合わせで起動不能になった事故（2026-08-18）の再発防止。
//   index.html の ?v= / sw.js の VERSION / app.js の APP_VERSION / import先の ?v= を突き合わせる。
{
  const { readFileSync } = await import('node:fs');
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const html = read('../index.html'), sw = read('../sw.js'), app = read('../js/app.js');
  const appVer = app.match(/APP_VERSION = '(v\d+)'/)[1];
  const swVer = sw.match(/VERSION = '(v\d+)'/)[1];
  const n = appVer.slice(1);
  t(`index.html / sw.js / app.js の版が揃っている（${appVer}）`, () => {
    assert.equal(swVer, appVer, `sw.js=${swVer} app.js=${appVer}`);
    const htmlVers = [...new Set(html.match(/\?v=\d+/g) || [])];
    assert.deepEqual(htmlVers, [`?v=${n}`], `index.html の ?v= が不揃い: ${htmlVers.join(',')}`);
  });
  t('app.js の import 先すべてに版が付いている', () => {
    const imports = app.match(/from '\.\/[^']+'/g) || [];
    for (const im of imports) {
      assert.ok(im.includes(`?v=${n}`), `版が付いていない import: ${im}`);
    }
  });
  t('sw.js の ASSETS が import 先と同じURLを指している', () => {
    for (const f of ['tones.js', 'pitch.js', 'bopomofo.js', 'data/phrases.js']) {
      assert.ok(sw.includes(`./js/${f}?v=${n}`), `sw.js の ASSETS に ./js/${f}?v=${n} がない`);
    }
  });
}

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

// ★実機報告（2026-08-18）「発音の最後がどうやっても上に跳ね上がる」の回帰テスト。
//   指を離す瞬間の音（タップ音・声の減衰）で周期推定が短い側へ飛ぶ。
t('末尾の跳ね上がりで第四声の判定がひっくり返らない', () => {
  const n = 24;
  const withSpike = Array.from({ length: n }, (_, i) => {
    const u = i / (n - 1);
    return { t: u, st: i >= n - 2 ? 9 : 6 - 12 * u }; // 最後の2フレームだけ跳ね上がる
  });
  const clean = withSpike.map((p, i) => ({ ...p, st: i >= n - 2 ? 6 - 12 * (i / (n - 1)) : p.st }));
  assert.ok(judge(4, clean).ok, '跳ね上がりなしで落ちていると判定されない');
  assert.ok(judge(4, withSpike).ok, `跳ね上がりで判定が壊れた: ${judge(4, withSpike).label}`);
});
t('末尾の跳ね上がりで第一声が「平らでない」と言われない', () => {
  const n = 24;
  const c = Array.from({ length: n }, (_, i) => ({ t: i / (n - 1), st: i >= n - 2 ? 9 : 6 }));
  assert.ok(judge(1, c).ok, judge(1, c).label);
});
t('1フレームだけの飛びで判定が動かない（中央値で見る）', () => {
  const n = 24;
  const c = Array.from({ length: n }, (_, i) => ({ t: i / (n - 1), st: i === 3 ? -9 : 6 }));
  assert.ok(judge(1, c).ok, judge(1, c).label);
});

console.log('\n[9] 収録の端と外れ値');
t('押し始めと離し際を無声にする', () => {
  const f = Array.from({ length: 50 }, (_, i) => ({ t: i * 0.02, hz: 200, rms: 0.05 }));
  const r = trimEdges(f); // 既定 頭0.04秒 / 尾0.12秒
  assert.equal(r[0].hz, 0, '頭が残っている');
  assert.equal(r[1].hz, 0);
  assert.ok(r[10].hz > 0, '中央まで削っている');
  assert.equal(r[r.length - 1].hz, 0, '尾が残っている');
  assert.equal(r[r.length - 5].hz, 0, '尾の削りが足りない');
});
t('中央値から7半音以上外れたF0を捨てる', () => {
  const f = [200, 205, 400, 198, 202].map((hz, i) => ({ t: i * 0.02, hz, rms: 0.05 }));
  const r = rejectOutliers(f);
  assert.equal(r[2].hz, 0, 'オクターブ上の飛びが残っている');
  assert.ok(r[0].hz > 0 && r[4].hz > 0, '正常なフレームまで捨てている');
});

console.log('\n[10] 有声判定（収録全体を見た相対値）');
const frs = (spec) => spec.map(([hz, rms], i) => ({ t: i * 0.02, hz, rms, clarity: 0.7 }));
t('小さすぎる部分を無声にする', () => {
  const r = decideVoicing(frs([[200, 0.10], [200, 0.10], [200, 0.002], [200, 0.09]]));
  assert.deepEqual(r.map((x) => x.hz > 0), [true, true, false, true]);
});
t('入力レベルが10分の1でも同じ判定になる（絶対値で切らない）', () => {
  const spec = [[200, 0.10], [200, 0.10], [200, 0.002], [200, 0.09]];
  const loud = decideVoicing(frs(spec)).map((x) => x.hz > 0);
  const quiet = decideVoicing(frs(spec.map(([hz, rms]) => [hz, rms * 0.1]))).map((x) => x.hz > 0);
  assert.deepEqual(quiet, loud);
});
t('全部が無音なら全部無声', () => {
  assert.ok(decideVoicing(frs([[0, 0], [0, 0]])).every((x) => x.hz === 0));
});

console.log('\n[11] 音節への割り当て');
// 声のかたまりを n 個作る（1つあたり 0.3秒、間に無声 gapFrames）
const speech = (n, gapFrames = 8) => {
  const out = []; let t = 0;
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < 15; i++) { out.push({ t, hz: 200, rms: 0.08, clarity: .8 }); t += 0.02; }
    for (let i = 0; i < gapFrames; i++) { out.push({ t, hz: 0, rms: 0.001, clarity: 0 }); t += 0.02; }
  }
  return out;
};
t('数が一致すればそのまま（exact）', () => {
  const r = segment(speech(4), 4);
  assert.equal(r.segs.length, 4);
  assert.equal(r.exact, true);
  assert.deepEqual(r.adjusted, { merged: 0, split: 0 });
});
t('多すぎれば間隔の狭い順に結合して音節数へ合わせる', () => {
  const r = segment(speech(6), 4);
  assert.equal(r.segs.length, 4);
  assert.equal(r.exact, false);
  assert.equal(r.adjusted.merged, 2);
});
// ★実機報告（2026-08-19）「早く喋るとズレる。1音節ずつ喋れば合うが、遅すぎて現実的でない」。
//   自然な速さでは音節が繋がり無声の切れ目が出ないので、音量の山（母音）を数えて割る。
const running = (n, gapDip = 0.25) => {
  // 無声を挟まず、音量の山が n 個ある連続発話を作る
  const out = []; let t = 0;
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < 18; i++) {
      const u = i / 17;
      const amp = 0.03 + 0.07 * Math.sin(Math.PI * u);          // 山
      out.push({ t, hz: 190 + k * 4, rms: Math.max(0.03 * gapDip, amp), clarity: .8 });
      t += 0.02;
    }
  }
  return out;
};
t('繋がった発話でも、音量の山を数えて音節数に割り当てる', () => {
  const segs = syllableNuclei(running(5), 5);
  assert.ok(segs, '山を見つけられなかった');
  assert.equal(segs.length, 5);
  for (let i = 1; i < segs.length; i++) {
    assert.ok(segs[i].from >= segs[i - 1].to, '区間が前後している');
  }
  // 各区間が、対応する山の位置に載っているか（等分ではないことの確認）
  const mid = segs.map((s) => (s.from + s.to) / 2);
  mid.forEach((m, i) => {
    const expected = (i + 0.5) * 18 * 0.02;
    assert.ok(Math.abs(m - expected) < 0.12, `${i}番目の中心が ${m.toFixed(2)}s（期待 ${expected.toFixed(2)}s）`);
  });
});
t('山が音節数より多くても、際立ちの大きい順に必要数だけ採る', () => {
  const segs = syllableNuclei(running(7), 4);
  assert.ok(segs);
  assert.equal(segs.length, 4);
});
t('山が足りなければ null を返す（別の手に任せる）', () => {
  assert.equal(syllableNuclei(running(2), 6), null);
});
t('segment() は繋がった発話で「山を数える」経路に入る', () => {
  const r = segment(running(5), 5);
  assert.equal(r.segs.length, 5);
  assert.equal(r.adjusted.nuclei, true, '山を数える経路に入っていない');
});

t('間がほぼ無く繋がっていても、音節数ぶんの区間になる', () => {
  const r = segment(speech(4, 1), 4); // 間がほぼ無く1つに繋がる
  assert.equal(r.segs.length, 4);
  r.segs.forEach((s) => assert.ok(s.pts.length >= 2, '空の区間ができている'));
  for (let i = 1; i < r.segs.length; i++) {
    assert.ok(r.segs[i].from >= r.segs[i - 1].to, '区間が前後している');
  }
});
t('区間は時間順に並び、重ならない', () => {
  const r = segment(speech(5), 3);
  for (let i = 1; i < r.segs.length; i++) {
    assert.ok(r.segs[i].from >= r.segs[i - 1].to, '区間が前後している');
  }
});
t('有声が無ければ empty', () => {
  assert.equal(segment([{ t: 0, hz: 0, rms: 0 }], 2).empty, true);
});

console.log('\n[12] 音節展開');
t('句読点はピンインを消費しない', () => {
  const s = syllables({ zh: '謝謝，麻煩你了。', pinyin: 'xie4 xie5 ma2 fan5 ni3 le5' });
  assert.equal(s.filter((x) => !x.punct).length, 6);
  assert.equal(s.filter((x) => x.punct).length, 2);
});

console.log(`\n${pass} 件すべて通過\n`);
