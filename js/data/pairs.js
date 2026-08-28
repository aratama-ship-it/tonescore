// 声調の聞き分けクイズ用ミニマルペア。
//
// ★選定基準：実在する日常語のペアのみ。創作しない。
//   声調だけが違うペアを基本とし、台湾アクセント（s/sh の曖昧化）ゆえに
//   声調が決め手になるペアは kind: 'accent' として注記を出す。
// ★pinyin は phrases.js と同じ「数字声調・音節space区切り」形式。注音は自動変換。

export const PAIRS = [
  {
    id: 'shuijiao',
    a: { zh: '睡覺', pinyin: 'shui4 jiao4', ja: '寝る' },
    b: { zh: '水餃', pinyin: 'shui3 jiao3', ja: '水餃子' },
    note: '夜市の定番ネタ。「我要水餃」のつもりが「我要睡覺（寝たい）」になる。',
  },
  {
    id: 'xiongmao',
    a: { zh: '熊貓', pinyin: 'xiong2 mao1', ja: 'パンダ' },
    b: { zh: '胸毛', pinyin: 'xiong1 mao2', ja: '胸毛' },
    note: '声調が入れ替わるだけで大惨事になる有名ペア。',
  },
  {
    id: 'maimai',
    a: { zh: '買', pinyin: 'mai3', ja: '買う' },
    b: { zh: '賣', pinyin: 'mai4', ja: '売る' },
    note: '三声と四声。商売の基本語で最も実害が出るペア。',
  },
  {
    id: 'tangtang',
    a: { zh: '湯', pinyin: 'tang1', ja: 'スープ' },
    b: { zh: '糖', pinyin: 'tang2', ja: '砂糖' },
    note: '「加湯」と「加糖」。飲食店で実際に効く。',
  },
  {
    id: 'wenwen',
    a: { zh: '問', pinyin: 'wen4', ja: '尋ねる' },
    b: { zh: '吻', pinyin: 'wen3', ja: 'キスする' },
    note: '「請問」を三声で言うと「請吻」に聞こえるという定番ネタ。',
  },
  {
    id: 'yanjing',
    a: { zh: '眼睛', pinyin: 'yan3 jing1', ja: '目' },
    b: { zh: '眼鏡', pinyin: 'yan3 jing4', ja: 'メガネ' },
    note: '台湾では「睛」を軽声にせず一声で読むのが普通。二音節目だけが違う。',
  },
  {
    id: 'laoshi',
    a: { zh: '老師', pinyin: 'lao3 shi1', ja: '先生' },
    b: { zh: '老實', pinyin: 'lao3 shi2', ja: '正直な' },
  },
  {
    id: 'xiangjiao',
    a: { zh: '香蕉', pinyin: 'xiang1 jiao1', ja: 'バナナ' },
    b: { zh: '橡膠', pinyin: 'xiang4 jiao1', ja: 'ゴム' },
    note: '一音節目だけが違う。',
  },
  {
    id: 'yuyu',
    a: { zh: '魚', pinyin: 'yu2', ja: '魚' },
    b: { zh: '雨', pinyin: 'yu3', ja: '雨' },
  },
  {
    id: 'sishi',
    kind: 'accent',
    a: { zh: '四', pinyin: 'si4', ja: '4' },
    b: { zh: '十', pinyin: 'shi2', ja: '10' },
    note: '子音も違うが、台湾では s/sh が曖昧になりがちで声調が決め手になる。値段の聞き取りで最重要。',
  },
  {
    id: 'baozi',
    kind: 'accent',
    a: { zh: '包子', pinyin: 'bao1 zi5', ja: '肉まん' },
    b: { zh: '報紙', pinyin: 'bao4 zhi3', ja: '新聞' },
    note: '台湾アクセントでは一音節目の声調（一声/四声）が一番の手がかり。',
  },
];
