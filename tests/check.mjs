// 聲調譜 — ロジックの検証（実行: node tests/check.mjs）
// 音声入出力は含まない。データ整合・注音変換・変調・判定・区間分割だけを見る。
import assert from 'node:assert/strict';
import { DECKS, syllables, isPunct } from '../js/data/phrases.js';
import { toBopomofo, toPinyinMarked, splitTone } from '../js/bopomofo.js';
import { applySandhi, contour, judge } from '../js/tones.js';
import { segment, normalize, medianHz } from '../js/pitch.js';

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

console.log('\n[7] 音節展開');
t('句読点はピンインを消費しない', () => {
  const s = syllables({ zh: '謝謝，麻煩你了。', pinyin: 'xie4 xie5 ma2 fan5 ni3 le5' });
  assert.equal(s.filter((x) => !x.punct).length, 6);
  assert.equal(s.filter((x) => x.punct).length, 2);
});

console.log(`\n${pass} 件すべて通過\n`);
