// =========================================================
// まどべ — 接続設定
// GASをデプロイしたときの「ウェブアプリURL（…/exec）」を貼り付けてください。
// このファイルを分けておくと、script.js を差し替えてもURLが消えません。
// =========================================================
window.GAS_URL = 'https://script.google.com/macros/s/AKfycbwjYc4KFNTjEqkgi6Vxjhn3WFtmOBQ3kuEniJMDgWhNa87wwABx7r_afPS7D7MZuX6Hfw/exec';

// =========================================================
// Gemini 会話モデル（設定 →「表示と会話」→「AIモデル」で選べます）
// value が API のモデルID。'' = 自動モード（汎用の最新モデル）
// 選んだモデルに該当がない（廃止・未公開・名前違い）ときは、GAS 側で汎用の最新モデルへ自動で切り替わります。
// 新しいモデルが出たら、ここに1行足すだけでOK（GAS の再デプロイは不要）
// =========================================================
window.GEMINI_MODEL_DEFAULT = '';
window.GEMINI_MODEL_OPTIONS = [
  { value: '',                  label: '自動モード（汎用の最新）' },
  { value: 'gemini-4-hydrogen', label: '4 Hydrogen（日々の暮らしをサポート）' },
  { value: 'gemini-4-neon',     label: '4 Neon（Deeper analysis）' },
  { value: 'gemini-4-carbon',   label: '4 Carbon（Code & complex work）' },
  { value: 'gemini-4-argon',    label: '4 Argon' },
  { value: 'gemini-3.8-flash',  label: '3.8 Flash' },
  { value: 'gemini-3.5-flash',  label: '3.5 Flash' }
];
