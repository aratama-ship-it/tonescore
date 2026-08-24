// 台湾華語フレーズ（繁体字）。注音はピンインから自動生成するので、ここではピンインを正とする。
//
// verify フィールド：
//   'ok'   … 台湾で一般に使われる表現として信頼度が高い
//   'check'… 意味は通るが、台湾での自然さ・現場での言い方は現地確認が望ましい
// ★ 'check' の項目は画面上でも「未確認」と表示する。確定事実として扱わない。
//
// pinyin は漢字1字＝1音節で空白区切り。句読点は漢字数に数えない。

export const DECKS = [
  {
    id: 'local',
    title: '現地で使う',
    subtitle: '店・移動・値段。まず口が回ればいい順',
    items: [
      { zh: '不好意思，請問一下。', pinyin: 'bu4 hao3 yi4 si5 qing3 wen4 yi2 xia4', ja: 'すみません、ちょっとお尋ねします。', note: '台湾では「對不起」より「不好意思」が日常的。呼びかけの定型。', verify: 'ok' },
      { zh: '這個多少錢？', pinyin: 'zhe4 ge5 duo1 shao3 qian2', ja: 'これはいくらですか？', verify: 'ok' },
      { zh: '這裡可以刷卡嗎？', pinyin: 'zhe4 li3 ke3 yi3 shua1 ka3 ma5', ja: 'ここはカードが使えますか？', note: '刷卡＝カード払い。', verify: 'ok' },
      { zh: '悠遊卡可以加值嗎？', pinyin: 'you1 you2 ka3 ke3 yi3 jia1 zhi2 ma5', ja: '悠遊カードにチャージできますか？', note: '加值＝チャージ（大陸の「充值」に相当）。', verify: 'ok' },
      { zh: '捷運站怎麼走？', pinyin: 'jie2 yun4 zhan4 zen3 me5 zou3', ja: 'MRTの駅はどう行きますか？', note: '捷運＝MRT。台湾の言い方。', verify: 'ok' },
      { zh: '我要一杯珍珠奶茶，微糖微冰。', pinyin: 'wo3 yao4 yi4 bei1 zhen1 zhu1 nai3 cha2 wei1 tang2 wei1 bing1', ja: 'タピオカミルクティーを一つ、甘さ少なめ・氷少なめで。', note: '糖度と氷は 無糖／微糖／半糖、去冰／微冰 で指定する。', verify: 'ok' },
      { zh: '內用還是外帶？', pinyin: 'nei4 yong4 hai2 shi4 wai4 dai4', ja: '店内ですか、持ち帰りですか？', note: '店員側のセリフ。聞き取り用。台湾は「外帶」。', verify: 'ok' },
      { zh: '需要袋子嗎？', pinyin: 'xu1 yao4 dai4 zi5 ma5', ja: '袋は要りますか？', note: '店員側のセリフ。台湾はレジ袋が有料。', verify: 'ok' },
      { zh: '可以說慢一點嗎？', pinyin: 'ke3 yi3 shuo1 man4 yi4 dian3 ma5', ja: 'もう少しゆっくり話してもらえますか？', verify: 'ok' },
      { zh: '謝謝，麻煩你了。', pinyin: 'xie4 xie5 ma2 fan5 ni3 le5', ja: 'ありがとう、お手数でした。', verify: 'ok' },
    ],
  },
  {
    id: 'greet',
    title: '挨拶・自己紹介',
    subtitle: '初対面で使う定番',
    items: [
      { zh: '你叫什麼名字？', pinyin: 'ni3 jiao4 shen2 me5 ming2 zi5', ja: 'お名前は何ですか？', verify: 'ok' },
      { zh: '我從日本來。', pinyin: 'wo3 cong2 ri4 ben3 lai2', ja: '私は日本から来ました。', verify: 'ok' },
      { zh: '很高興認識你。', pinyin: 'hen3 gao1 xing4 ren4 shi5 ni3', ja: 'お会いできて嬉しいです。', verify: 'ok' },
      { zh: '你會說英文嗎？', pinyin: 'ni3 hui4 shuo1 ying1 wen2 ma5', ja: '英語は話せますか？', verify: 'ok' },
      { zh: '我在學中文。', pinyin: 'wo3 zai4 xue2 zhong1 wen2', ja: '中国語を勉強しています。', verify: 'ok' },
      { zh: '沒關係。', pinyin: 'mei2 guan1 xi5', ja: '大丈夫です、気にしないでください。', verify: 'ok' },
    ],
  },
  {
    id: 'transit',
    title: '移動・交通',
    subtitle: '駅・バス・タクシーで',
    items: [
      { zh: '請問火車站怎麼走？', pinyin: 'qing3 wen4 huo3 che1 zhan4 zen3 me5 zou3', ja: 'すみません、駅へはどう行きますか？', verify: 'ok' },
      { zh: '到這裡多少錢？', pinyin: 'dao4 zhe4 li3 duo1 shao3 qian2', ja: 'ここまでいくらですか？', note: 'タクシーで行き先を告げた後に。', verify: 'ok' },
      { zh: '請幫我叫計程車。', pinyin: 'qing3 bang1 wo3 jiao4 ji4 cheng2 che1', ja: 'タクシーを呼んでください。', note: '計程車＝タクシー。台湾の言い方（大陸は「出租車」）。', verify: 'ok' },
      { zh: '這班公車有到台北車站嗎？', pinyin: 'zhe4 ban1 gong1 che1 you3 dao4 tai2 bei3 che1 zhan4 ma5', ja: 'このバスは台北駅に行きますか？', note: '公車＝バス。台湾の言い方（大陸は「公交車」）。', verify: 'ok' },
      { zh: '高鐵票要在哪裡買？', pinyin: 'gao1 tie3 piao4 yao4 zai4 na3 li3 mai3', ja: '高速鉄道の切符はどこで買えますか？', note: '高鐵＝台湾高速鉄道（THSR）の呼び方。', verify: 'ok' },
      { zh: '下一站是哪裡？', pinyin: 'xia4 yi2 zhan4 shi4 na3 li3', ja: '次の駅はどこですか？', verify: 'ok' },
    ],
  },
  {
    id: 'shop',
    title: '買い物・食事',
    subtitle: '「現地で使う」の続き',
    items: [
      { zh: '可以試穿嗎？', pinyin: 'ke3 yi3 shi4 chuan1 ma5', ja: '試着してもいいですか？', verify: 'ok' },
      { zh: '有沒有比較便宜的？', pinyin: 'you3 mei2 you3 bi3 jiao4 pian2 yi2 de5', ja: 'もう少し安いのはありますか？', verify: 'ok' },
      { zh: '我要外帶。', pinyin: 'wo3 yao4 wai4 dai4', ja: '持ち帰りでお願いします。', verify: 'ok' },
      { zh: '可以幫我打包嗎？', pinyin: 'ke3 yi3 bang1 wo3 da3 bao1 ma5', ja: '持ち帰り用に包んでもらえますか？', verify: 'ok' },
      { zh: '這個會辣嗎？', pinyin: 'zhe4 ge5 hui4 la4 ma5', ja: 'これは辛いですか？', verify: 'ok' },
      { zh: '這個可以退嗎？', pinyin: 'zhe4 ge5 ke3 yi3 tui4 ma5', ja: 'これは返品できますか？', verify: 'check' },
    ],
  },
  {
    id: 'trouble',
    title: '体調・困った時',
    subtitle: 'もしもの時に',
    items: [
      { zh: '我肚子痛。', pinyin: 'wo3 du4 zi5 tong4', ja: 'お腹が痛いです。', verify: 'ok' },
      { zh: '附近有藥局嗎？', pinyin: 'fu4 jin4 you3 yao4 ju2 ma5', ja: '近くに薬局はありますか？', note: '藥局＝薬局。「藥房」とも言うが「藥局」が一般的。', verify: 'ok' },
      { zh: '我需要幫忙。', pinyin: 'wo3 xu1 yao4 bang1 mang2', ja: '助けが必要です。', verify: 'ok' },
      { zh: '我的手機不見了。', pinyin: 'wo3 de5 shou3 ji1 bu2 jian4 le5', ja: '携帯電話がなくなりました。', note: '不見了＝無くなった。「不」は後ろが四声なので二声化（bu2）。', verify: 'ok' },
      { zh: '我迷路了。', pinyin: 'wo3 mi2 lu4 le5', ja: '道に迷いました。', verify: 'ok' },
      { zh: '請叫救護車。', pinyin: 'qing3 jiao4 jiu4 hu4 che1', ja: '救急車を呼んでください。', verify: 'ok' },
    ],
  },
  {
    id: 'reaction',
    title: '気持ち・相槌',
    subtitle: '会話の間を埋める一言',
    items: [
      { zh: '真的假的？', pinyin: 'zhen1 de5 jia3 de5', ja: '本当ですか？（驚いた時の口語）', note: '台湾でよく聞く口語表現。', verify: 'ok' },
      { zh: '太好了！', pinyin: 'tai4 hao3 le5', ja: 'よかったです！', verify: 'ok' },
      { zh: '我懂了。', pinyin: 'wo3 dong3 le5', ja: 'わかりました。', verify: 'ok' },
      { zh: '等一下。', pinyin: 'deng3 yi2 xia4', ja: 'ちょっと待ってください。', verify: 'ok' },
      { zh: '沒問題。', pinyin: 'mei2 wen4 ti2', ja: '問題ありません。', verify: 'ok' },
      { zh: '加油！', pinyin: 'jia1 you2', ja: '頑張って！（応援の掛け声）', verify: 'ok' },
    ],
  },
  {
    id: 'stage',
    title: '仕事・公演',
    subtitle: '現場で本当に必要になる質問だけ',
    items: [
      { zh: '我表演扯鈴。', pinyin: 'wo3 biao3 yan3 che3 ling2', ja: '私はディアボロを演じます。', note: '扯鈴＝台湾でのディアボロの標準語。大陸の「抖空竹」とは別語。台湾では民俗芸能として広く知られている。', verify: 'ok' },
      { zh: '我是雜技演員。', pinyin: 'wo3 shi4 za2 ji4 yan3 yuan2', ja: '私はサーカスのアーティストです。', note: '雜技＝アクロバット/サーカス芸。台湾では「特技」と言う場面もある。自己紹介でどちらが自然かは現地確認。', verify: 'check' },
      { zh: '天花板有多高？', pinyin: 'tian1 hua1 ban3 you3 duo1 gao1', ja: '天井の高さはどれくらいですか？', note: '投げ技の可否を決める最重要の質問。', verify: 'ok' },
      { zh: '這個地板會滑嗎？', pinyin: 'zhe4 ge5 di4 ban3 hui4 hua2 ma5', ja: 'この床は滑りますか？', verify: 'ok' },
      { zh: '彩排幾點開始？', pinyin: 'cai3 pai2 ji3 dian3 kai1 shi3', ja: 'リハーサルは何時から始まりますか？', note: '彩排＝リハーサル。', verify: 'ok' },
      { zh: '我需要三十分鐘暖身。', pinyin: 'wo3 xu1 yao4 san1 shi2 fen1 zhong1 nuan3 shen1', ja: 'ウォームアップに30分必要です。', note: '暖身＝ウォームアップ。', verify: 'ok' },
      { zh: '音樂可以再大聲一點嗎？', pinyin: 'yin1 yue4 ke3 yi3 zai4 da4 sheng1 yi4 dian3 ma5', ja: '音楽をもう少し大きくできますか？', verify: 'ok' },
      { zh: '燈光可以打亮一點嗎？', pinyin: 'deng1 guang1 ke3 yi3 da3 liang4 yi4 dian3 ma5', ja: '照明をもう少し明るくできますか？', note: '照明の指示は現場ごとに言い回しの癖がある。要現地確認。', verify: 'check' },
      { zh: '我的道具在這個箱子裡。', pinyin: 'wo3 de5 dao4 ju4 zai4 zhe4 ge5 xiang1 zi5 li3', ja: '私の道具はこの箱の中です。', verify: 'ok' },
    ],
  },
  {
    id: 'tone',
    title: '声調だけの素振り',
    subtitle: '意味を捨てて、形だけ体に入れる',
    items: [
      { zh: '媽麻馬罵', pinyin: 'ma1 ma2 ma3 ma4', ja: '（母・麻・馬・罵る）四声の型', note: '意味より形。1→2→3→4 を一息で。', verify: 'ok' },
      { zh: '八拔把爸', pinyin: 'ba1 ba2 ba3 ba4', ja: '（八・抜く・持つ・父）四声の型', verify: 'ok' },
      { zh: '你好', pinyin: 'ni3 hao3', ja: 'こんにちは（三声＋三声＝変調）', note: '3+3 は前が2声で実現される。実際は「ní hǎo」に近い。', verify: 'ok' },
      { zh: '我也很好', pinyin: 'wo3 ye3 hen3 hao3', ja: '私も元気です（三声の連続）', note: '三声が連続する時の変調をまとめて確認できる。', verify: 'ok' },
      { zh: '謝謝', pinyin: 'xie4 xie5', ja: 'ありがとう（四声＋軽声）', verify: 'ok' },
    ],
  },
];

const PUNCT = /[，。？！、：；「」（）,.?!]/;
export const isPunct = (ch) => PUNCT.test(ch);

/** フレーズを音節単位へ展開（句読点は音節に数えない） */
export function syllables(item) {
  const py = item.pinyin.trim().split(/\s+/);
  const out = [];
  let k = 0;
  for (const ch of Array.from(item.zh)) {
    if (isPunct(ch)) { out.push({ char: ch, punct: true }); continue; }
    out.push({ char: ch, py: py[k] ?? '', punct: false });
    k++;
  }
  if (k !== py.length) {
    console.warn('[phrases] 漢字数とピンイン数が不一致:', item.zh, k, py.length);
  }
  return out;
}
