/**
 * まどべ — 対話型バーチャルコンパニオン API（Google Apps Script）
 *
 * フロント（GitHub Pages）から text/plain で POST される JSON を受け取り、
 * action ごとに処理して JSON を返す。
 *
 * スクリプトプロパティ（必須）
 *   GEMINI_API_KEY   : Gemini API キー
 *   DRIVE_FOLDER_ID  : アバター画像を保存する Drive フォルダID
 *   PASSWORD_PEPPER  : 任意の長いランダム文字列（パスワードハッシュ用）
 * スクリプトプロパティ（任意）
 *   GEMINI_MODEL     : 会話モデル（既定 gemini-2.5-flash）
 *   TTS_MODEL        : 声のモデル（既定 gemini-3.8-flash-tts）
 *                      ※写真のキャラクターは最大10人。声はキャラクターごとに photoChars 列へ保存
 *                      ※設定画面で「Gemini の声」をオンにした人だけ使用。オフの人は端末の声で話し、
 *                        Gemini には会話（GEMINI_MODEL）だけを送る
 *   APP_URL          : メール本文に載せるアプリURL（未設定なら DEFAULT_APP_URL）
 *   SPREADSHEET_ID   : スタンドアロンGASの場合のみ
 */

const APP_NAME = 'まどべ';
const DEFAULT_APP_URL = 'https://kenken6291.github.io/madobe/';
const SHEET_USERS = 'Users';
const SHEET_HISTORY = 'History';

const USER_HEADERS = [
  'userId', 'email', 'name', 'passwordHash', 'salt', 'isFirstLogin',
  'companionName', 'avatarCategory', 'avatarPreset',
  'avatarImageUrl', 'avatarImageId', 'avatarConfig',
  'failedCount', 'lockedUntil', 'createdAt', 'lastLoginAt',
  'avatarImages', 'customVoices', 'photoChars', 'activeCharId'
];
const HISTORY_HEADERS = ['timestamp', 'userId', 'role', 'text', 'emotion'];

const SESSION_TTL_SEC = 21600;      // 6時間（CacheService上限）。アクセスごとに延長
const MAX_FAILED = 5;               // 連続失敗でロック
const LOCK_MINUTES = 15;
const HISTORY_CONTEXT = 20;         // Geminiに渡す直近の会話数
const HISTORY_SCAN_ROWS = 3000;     // 履歴検索で遡る最大行数
const HASH_ROUNDS = 300;
const EMOTIONS = ['joy', 'neutral', 'sad', 'surprised'];
// 写真の種類：4表情 × 「顔」「瞬き」「しゃべり」
// 普通の顔は neutral / blink / talk、他は joy / joy_blink / joy_talk など
const IMAGE_KEYS = [
  'neutral', 'blink', 'talk',
  'joy', 'joy_blink', 'joy_talk',
  'sad', 'sad_blink', 'sad_talk',
  'surprised', 'surprised_blink', 'surprised_talk'
];
// 目の位置を個別登録できる写真（瞬き写真は不要）
const PER_EYE_KEYS = ['joy', 'sad', 'surprised', 'talk', 'joy_talk', 'sad_talk', 'surprised_talk'];
const CATEGORIES = ['pet', 'person', 'anime'];
// 写真のキャラクター（1人あたり最大10人）。それぞれに名前・タイプ・写真・声を持つ
const MAX_CHARS = 10;
const LEGACY_CHAR_ID = 'c_legacy'; // 旧形式（写真1組）から移行したキャラクター
const SPEEDS = ['slow', 'normal', 'fast'];
const PRESETS = ['dog', 'cat', 'person_f', 'person_m', 'anime_g', 'anime_b', 'custom'];

// ================= エントリポイント =================

function doGet() {
  return json_({ ok: true, app: APP_NAME, message: 'API is running' });
}

function doPost(e) {
  let res;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const handlers = {
      register: register_,
      login: login_,
      forgotPassword: forgotPassword_,
      changePassword: changePassword_,
      me: me_,
      logout: logout_,
      saveAvatar: saveAvatar_,
      chat: chat_,
      getHistory: getHistory_,
      tts: tts_,
      createSimilarVoice: createSimilarVoice_,
      createReplicaVoice: createReplicaVoice_,
      deleteVoice: deleteVoice_,
      clearHistory: clearHistory_
    };
    const fn = handlers[req.action];
    if (!fn) throw new Error('不明な操作です');
    res = Object.assign({ ok: true }, fn(req));
  } catch (err) {
    const msg = String((err && err.message) || err);
    const m = msg.match(/^(AUTH|FIRST_LOGIN):\s*([\s\S]*)$/);
    res = m ? { ok: false, code: m[1], error: m[2] } : { ok: false, error: msg };
  }
  return json_(res);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ================= 初期セットアップ =================

/** 最初に一度だけ手動実行：シート作成＆権限承認 */
function setup() {
  const ss = getSS_();
  [[SHEET_USERS, USER_HEADERS], [SHEET_HISTORY, HISTORY_HEADERS]].forEach(function (pair) {
    const s = ss.getSheetByName(pair[0]) || ss.insertSheet(pair[0]);
    s.getRange(1, 1, 1, pair[1].length).setValues([pair[1]]).setFontWeight('bold');
    s.setFrozenRows(1);
  });
  const p = props_();
  if (!p.getProperty('PASSWORD_PEPPER')) {
    p.setProperty('PASSWORD_PEPPER', Utilities.getUuid() + Utilities.getUuid());
  }
  // 権限承認を通すための呼び出し
  if (p.getProperty('DRIVE_FOLDER_ID')) DriveApp.getFolderById(p.getProperty('DRIVE_FOLDER_ID')).getName();
  Logger.log('メール送信残り: ' + MailApp.getRemainingDailyQuota());
  Logger.log('セットアップ完了');
}

// ================= 共通ヘルパー =================

function props_() { return PropertiesService.getScriptProperties(); }

function getSS_() {
  const id = props_().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

let usersHeaderChecked_ = false;

function sheet_(name) {
  const s = getSS_().getSheetByName(name);
  if (!s) throw new Error('シート「' + name + '」がありません。setup() を実行してください');
  if (name === SHEET_USERS && !usersHeaderChecked_) ensureUserHeaders_(s);
  return s;
}

/** 後から増えた列（avatarImages など）を Users シートに自動追加 */
function ensureUserHeaders_(s) {
  usersHeaderChecked_ = true;
  const lastCol = s.getLastColumn();
  const cur = lastCol ? s.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const missing = USER_HEADERS.filter(function (h) { return cur.indexOf(h) < 0; });
  if (missing.length) {
    s.getRange(1, cur.length + 1, 1, missing.length).setValues([missing]).setFontWeight('bold');
  }
}

/** 数式インジェクション対策 */
function safe_(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function hash_(password, salt) {
  const pepper = props_().getProperty('PASSWORD_PEPPER') || '';
  let h = salt + ':' + password + ':' + pepper;
  for (let i = 0; i < HASH_ROUNDS; i++) {
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8)
      .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
  }
  return h;
}

function genTempPassword_() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let p = '';
  for (let i = 0; i < 10; i++) p += chars.charAt(Math.floor(Math.random() * chars.length));
  return p;
}

function validateNewPassword_(pw) {
  if (pw.length < 8 || pw.length > 64) throw new Error('パスワードは8〜64文字にしてください');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new Error('パスワードには英字と数字を両方含めてください');
}

function normEmail_(v) { return String(v || '').trim().toLowerCase(); }

// ---- ユーザーテーブル ----

function findUserBy_(key, value) {
  const s = sheet_(SHEET_USERS);
  const values = s.getDataRange().getValues();
  const headers = values.shift();
  const idx = headers.indexOf(key);
  const target = String(value).toLowerCase();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][idx]).toLowerCase() === target) {
      const u = {};
      headers.forEach(function (h, j) { u[h] = values[i][j]; });
      u._row = i + 2;
      return u;
    }
  }
  return null;
}

function updateUser_(user, fields) {
  const s = sheet_(SHEET_USERS);
  const headers = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
  const row = s.getRange(user._row, 1, 1, headers.length).getValues()[0];
  Object.keys(fields).forEach(function (k) {
    const c = headers.indexOf(k);
    if (c < 0) return;
    row[c] = fields[k];
    user[k] = fields[k];
  });
  s.getRange(user._row, 1, 1, headers.length).setValues([row]);
}

function parseConfig_(v) {
  try { return sanitizeConfig_(JSON.parse(v || '{}')); } catch (e) { return sanitizeConfig_({}); }
}

function sanitizeConfig_(c) {
  c = c || {};
  function pt(o, dx, dy) {
    o = o || {};
    const x = Number(o.x), y = Number(o.y);
    return {
      x: isFinite(x) ? Math.min(100, Math.max(0, x)) : dx,
      y: isFinite(y) ? Math.min(100, Math.max(0, y)) : dy
    };
  }
  function color(v) { return /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#d9a88a'; }
  const out = {
    eyeL: pt(c.eyeL, 38, 42),
    eyeR: pt(c.eyeR, 62, 42),
    mouth: pt(c.mouth, 50, 68),
    lidColor: color(c.lidColor),
    brows: !!c.brows,
    perEmotion: {}
  };
  // 写真ごとに目の位置を個別に登録した場合
  const pe = c.perEmotion || {};
  PER_EYE_KEYS.forEach(function (e) {
    out.perEmotion[e] = null;
    if (pe[e] && typeof pe[e] === 'object') {
      out.perEmotion[e] = {
        eyeL: pt(pe[e].eyeL, out.eyeL.x, out.eyeL.y),
        eyeR: pt(pe[e].eyeR, out.eyeR.x, out.eyeR.y),
        mouth: pt(pe[e].mouth, out.mouth.x, out.mouth.y),
        lidColor: color(pe[e].lidColor || out.lidColor)
      };
    }
  });
  return out;
}

/** avatarImages 列: {neutral:{url,id}, joy, sad, surprised, blink, talk} */
function parseImages_(v, user) {
  let o = {};
  try { o = JSON.parse(v || '{}') || {}; } catch (e) { o = {}; }
  const out = {};
  IMAGE_KEYS.forEach(function (e) {
    const x = o[e] || {};
    out[e] = { url: String(x.url || ''), id: String(x.id || '') };
  });
  if (!out.neutral.url && user && user.avatarImageUrl) {
    out.neutral = { url: String(user.avatarImageUrl), id: String(user.avatarImageId || '') };
  }
  return out;
}

function publicUser_(u) {
  const chars = parseChars_(u);
  const activeId = activeCharId_(u, chars);
  const active = chars.filter(function (c) { return c.id === activeId; })[0] || null;
  const isCustom = String(u.avatarPreset) === 'custom';
  return {
    name: String(u.name),
    email: String(u.email),
    isFirstLogin: isTrue_(u.isFirstLogin),
    companionName: String(u.companionName || 'ポチ'),
    avatarCategory: String(u.avatarCategory || 'pet'),
    avatarPreset: String(u.avatarPreset || 'dog'),
    avatarImageUrl: isCustom && active && active.images.neutral ? imgUrl_(active.images.neutral) : '',
    avatarImages: imageUrls_(isCustom && active ? active.images : {}),
    photoChars: chars.map(function (c) {
      return { id: c.id, name: c.name, category: c.category, images: imageUrls_(c.images), voice: c.voice };
    }),
    activeCharId: activeId,
    avatarConfig: parseConfig_(u.avatarConfig),
    customVoices: parseVoices_(u.customVoices).map(function (v) {
      return { id: v.id, label: v.label, type: v.type, summary: v.summary || '' };
    })
  };
}

// ---- 写真のキャラクター（photoChars 列） ----
// [{ id, name, category, images: { neutral: DriveファイルID, blink: …, joy_talk: … }, voice: {gVoice, gSpeed, voiceURI, rate, pitch} }]

function imgUrl_(id) { return id ? 'https://lh3.googleusercontent.com/d/' + id : ''; }

function idFromUrl_(url) {
  const m = String(url || '').match(/\/d\/([\w-]{10,})/) || String(url || '').match(/[?&]id=([\w-]{10,})/);
  return m ? m[1] : '';
}

function imageUrls_(images) {
  const o = {};
  IMAGE_KEYS.forEach(function (k) { o[k] = imgUrl_(images && images[k]); });
  return o;
}

function sanitizeVoice_(v, user) {
  v = v && typeof v === 'object' ? v : {};
  const out = {};
  const g = String(v.gVoice || '');
  if (TTS_VOICES.indexOf(g) >= 0 ||
      (/^voice_[\w-]+$/.test(g) && parseVoices_(user.customVoices).some(function (x) { return x.id === g; }))) {
    out.gVoice = g;
  }
  if (SPEEDS.indexOf(v.gSpeed) >= 0) out.gSpeed = v.gSpeed;
  if (v.voiceURI) out.voiceURI = String(v.voiceURI).slice(0, 200);
  const r = Number(v.rate);
  if (v.rate != null && isFinite(r) && r > 0) out.rate = Math.min(1.6, Math.max(0.6, r));
  if (v.pitch != null && v.pitch !== '') {
    const p = Number(v.pitch);
    if (isFinite(p)) out.pitch = Math.min(2, Math.max(0.5, p));
  }
  return out;
}

/** photoChars 列を読む。列が空（まだ一度も保存していない）なら旧形式の写真から1人目を作る */
function parseChars_(user) {
  const raw = String(user.photoChars == null ? '' : user.photoChars).trim();
  if (!raw) {
    const imgs = parseImages_(user.avatarImages, user);
    const images = {};
    IMAGE_KEYS.forEach(function (k) {
      const id = imgs[k].id || idFromUrl_(imgs[k].url);
      if (id) images[k] = id;
    });
    if (!images.neutral) return [];
    const isCustom = String(user.avatarPreset) === 'custom';
    return [{
      id: LEGACY_CHAR_ID,
      name: isCustom ? String(user.companionName || '写真の人') : '写真の人',
      category: isCustom && CATEGORIES.indexOf(user.avatarCategory) >= 0 ? String(user.avatarCategory) : 'person',
      images: images,
      voice: {}
    }];
  }
  let arr;
  try { arr = JSON.parse(raw); } catch (e) { arr = []; }
  if (!Array.isArray(arr)) return [];
  return arr.filter(function (c) { return c && /^c[\w-]{1,40}$/.test(String(c.id)); }).slice(0, MAX_CHARS).map(function (c) {
    const images = {};
    const src = c.images && typeof c.images === 'object' ? c.images : {};
    IMAGE_KEYS.forEach(function (k) { if (/^[\w-]{10,}$/.test(String(src[k] || ''))) images[k] = String(src[k]); });
    return {
      id: String(c.id),
      name: String(c.name || '').slice(0, 20),
      category: CATEGORIES.indexOf(c.category) >= 0 ? c.category : 'person',
      images: images,
      voice: sanitizeVoice_(c.voice, user)
    };
  });
}

function activeCharId_(user, chars) {
  const id = String(user.activeCharId || '');
  if (chars.some(function (c) { return c.id === id; })) return id;
  return chars.length ? chars[0].id : '';
}

function newCharId_() { return 'c' + Utilities.getUuid().replace(/-/g, '').slice(0, 12); }

// ---- セッション（CacheService） ----

function createSession_(userId) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put('sess_' + token, userId, SESSION_TTL_SEC);
  return token;
}

/** allowFirstLogin=false の場合、仮パスワード状態のユーザーは操作不可 */
function auth_(req, allowFirstLogin) {
  const token = String(req.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('AUTH: ログインしてください');
  const cache = CacheService.getScriptCache();
  const userId = cache.get('sess_' + token);
  if (!userId) throw new Error('AUTH: ログインの有効期限が切れました。もう一度ログインしてください');
  cache.put('sess_' + token, userId, SESSION_TTL_SEC); // スライド延長
  const user = findUserBy_('userId', userId);
  if (!user) throw new Error('AUTH: アカウントが見つかりません');
  if (!allowFirstLogin && isTrue_(user.isFirstLogin)) {
    throw new Error('FIRST_LOGIN: 先に新しいパスワードを設定してください');
  }
  user._token = token;
  return user;
}

// ---- メール ----

function sendTempPasswordMail_(email, name, temp, isReset) {
  const appUrl = props_().getProperty('APP_URL') || DEFAULT_APP_URL;
  const subject = isReset
    ? '【' + APP_NAME + '】仮パスワードを再発行しました'
    : '【' + APP_NAME + '】ご登録ありがとうございます';
  const body =
    name + ' さん\n\n' +
    (isReset ? 'パスワードの再発行を受け付けました。' : APP_NAME + ' へのご登録ありがとうございます。') + '\n' +
    '次の仮パスワードでログインしてください。\n\n' +
    '　仮パスワード：' + temp + '\n\n' +
    'ログインすると、新しいパスワードの設定画面が表示されます。\n' +
    (appUrl ? '\n' + appUrl + '\n' : '') +
    '\n※このメールに心当たりがない場合は、そのまま破棄してください。\n';
  MailApp.sendEmail({ to: email, subject: subject, body: body, name: APP_NAME });
}

// ================= 認証系 =================

function register_(req) {
  const email = normEmail_(req.email);
  const name = String(req.name || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('メールアドレスの形式が正しくありません');
  if (!name || name.length > 30) throw new Error('お名前は1〜30文字で入力してください');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (findUserBy_('email', email)) throw new Error('このメールアドレスは登録済みです。ログインするか、パスワード再発行をご利用ください');
    const temp = genTempPassword_();
    const salt = Utilities.getUuid();
    const user = {
      userId: Utilities.getUuid(),
      email: email,
      name: safe_(name),
      passwordHash: hash_(temp, salt),
      salt: salt,
      isFirstLogin: true,
      companionName: 'ポチ',
      avatarCategory: 'pet',
      avatarPreset: 'dog',
      avatarImageUrl: '',
      avatarImageId: '',
      avatarConfig: JSON.stringify(sanitizeConfig_({})),
      failedCount: 0,
      lockedUntil: '',
      createdAt: new Date(),
      lastLoginAt: ''
    };
    sendTempPasswordMail_(email, name, temp, false); // 送信成功後に登録
    user.avatarImages = '{}';
    user.customVoices = '[]';
    user.photoChars = '[]';
    user.activeCharId = '';
    const us = sheet_(SHEET_USERS);
    const headers = us.getRange(1, 1, 1, us.getLastColumn()).getValues()[0];
    us.appendRow(headers.map(function (h) { return user[h] == null ? '' : user[h]; }));
    return { message: '仮パスワードをメールで送りました。メールを確認してログインしてください' };
  } finally {
    lock.releaseLock();
  }
}

function login_(req) {
  const email = normEmail_(req.email);
  const pw = String(req.password || '');
  const ng = 'メールアドレスまたはパスワードが違います';
  const user = findUserBy_('email', email);
  if (!user) throw new Error(ng);

  const now = new Date();
  if (user.lockedUntil && new Date(user.lockedUntil) > now) {
    throw new Error('ログインの失敗が続いたため、一時的にロックしています。' + LOCK_MINUTES + '分ほど待ってからお試しください');
  }
  if (hash_(pw, user.salt) !== user.passwordHash) {
    const fc = Number(user.failedCount || 0) + 1;
    if (fc >= MAX_FAILED) {
      updateUser_(user, { failedCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60000) });
      throw new Error('ログインに' + MAX_FAILED + '回失敗したため、' + LOCK_MINUTES + '分間ロックしました');
    }
    updateUser_(user, { failedCount: fc });
    throw new Error(ng + '（あと' + (MAX_FAILED - fc) + '回でロック）');
  }
  updateUser_(user, { failedCount: 0, lockedUntil: '', lastLoginAt: now });
  return { token: createSession_(user.userId), user: publicUser_(user) };
}

function forgotPassword_(req) {
  const email = normEmail_(req.email);
  const msg = { message: '登録済みのアドレスであれば、仮パスワードを送りました。メールを確認してください' };
  if (!email) throw new Error('メールアドレスを入力してください');
  const user = findUserBy_('email', email);
  if (!user) return msg; // 登録有無は明かさない
  const temp = genTempPassword_();
  const salt = Utilities.getUuid();
  sendTempPasswordMail_(user.email, user.name, temp, true);
  updateUser_(user, { passwordHash: hash_(temp, salt), salt: salt, isFirstLogin: true, failedCount: 0, lockedUntil: '' });
  return msg;
}

function changePassword_(req) {
  const user = auth_(req, true);
  const newPw = String(req.newPassword || '');
  if (!isTrue_(user.isFirstLogin)) {
    if (hash_(String(req.currentPassword || ''), user.salt) !== user.passwordHash) {
      throw new Error('現在のパスワードが違います');
    }
  }
  validateNewPassword_(newPw);
  const salt = Utilities.getUuid();
  updateUser_(user, { passwordHash: hash_(newPw, salt), salt: salt, isFirstLogin: false });
  return { user: publicUser_(user), message: 'パスワードを変更しました' };
}

function me_(req) {
  return { user: publicUser_(auth_(req, true)) };
}

function logout_(req) {
  const token = String(req.token || '');
  if (token) CacheService.getScriptCache().remove('sess_' + token);
  return {};
}

// ================= アバター =================

function saveAvatar_(req) {
  const user = auth_(req, false);
  const category = CATEGORIES.indexOf(req.avatarCategory) >= 0 ? req.avatarCategory : 'pet';
  const preset = PRESETS.indexOf(req.avatarPreset) >= 0 ? req.avatarPreset : 'dog';

  let chars = parseChars_(user);
  const del = Array.isArray(req.deleteChars) ? req.deleteChars.map(String) : [];
  const incoming = Array.isArray(req.chars) ? req.chars.slice(0, 30) : [];
  const isData = function (v) { return typeof v === 'string' && /^data:image\//.test(v); };

  // ---- 先にすべて確認してから保存する（途中で失敗して写真だけ残るのを防ぐ） ----
  const kept = chars.filter(function (c) { return del.indexOf(c.id) < 0; });
  let count = kept.length;
  const plans = [];
  incoming.forEach(function (inc) {
    if (!inc || typeof inc !== 'object') return;
    const id = String(inc.id || '');
    let cur = kept.filter(function (c) { return c.id === id; })[0] || null;
    if (!cur) {
      if (!/^new_[\w-]{1,40}$/.test(id)) return; // 削除済みなど、知らないIDは無視
      count++;
    }
    const name = String(inc.name || '').trim();
    if (!name || name.length > 20) throw new Error('写真のキャラクターの名前は1〜20文字で入力してください');
    const imgs = inc.images && typeof inc.images === 'object' ? inc.images : {};
    const removes = Array.isArray(inc.removeImages) ? inc.removeImages : [];
    const hasNeutral = isData(imgs.neutral) || (cur && cur.images.neutral);
    if (!hasNeutral) throw new Error('「' + name + '」の「普通の顔」の写真を選んでください');
    plans.push({ id: id, cur: cur, name: name, imgs: imgs, removes: removes, inc: inc });
  });
  if (count > MAX_CHARS) throw new Error('写真のキャラクターは' + MAX_CHARS + '人までです');

  // ---- 削除 ----
  chars.forEach(function (c) {
    if (del.indexOf(c.id) < 0) return;
    Object.keys(c.images).forEach(function (k) { trashFile_(c.images[k]); });
  });
  chars = kept;

  // ---- 追加・更新 ----
  const idMap = {};
  plans.forEach(function (p) {
    let c = p.cur;
    if (!c) {
      c = { id: newCharId_(), name: '', category: 'person', images: {}, voice: {} };
      chars.push(c);
      idMap[p.id] = c.id;
    }
    c.name = p.name;
    c.category = CATEGORIES.indexOf(p.inc.category) >= 0 ? p.inc.category : c.category;
    c.voice = sanitizeVoice_(p.inc.voice, user);
    IMAGE_KEYS.forEach(function (k) {
      if (!isData(p.imgs[k])) return;
      const saved = saveImage_(user, c.id + '_' + k, p.imgs[k]);
      trashFile_(c.images[k]);
      c.images[k] = saved.id;
    });
    p.removes.forEach(function (k) {
      if (k === 'neutral' || IMAGE_KEYS.indexOf(k) < 0 || !c.images[k]) return;
      trashFile_(c.images[k]);
      delete c.images[k];
    });
  });

  let activeId = String(req.activeCharId || '');
  if (idMap[activeId]) activeId = idMap[activeId];
  if (!chars.some(function (c) { return c.id === activeId; })) activeId = chars.length ? chars[0].id : '';
  const active = chars.filter(function (c) { return c.id === activeId; })[0] || null;

  const json = JSON.stringify(chars);
  if (json.length > 45000) throw new Error('保存できる量を超えました');

  const fields = {
    avatarCategory: category,
    avatarPreset: preset,
    avatarConfig: JSON.stringify(sanitizeConfig_(req.avatarConfig)),
    photoChars: json,
    activeCharId: activeId,
    // 旧形式の列（写真は photoChars に移行済み）
    avatarImages: '',
    avatarImageId: '',
    avatarImageUrl: active && active.images.neutral ? imgUrl_(active.images.neutral) : ''
  };

  if (preset === 'custom') {
    if (!active) throw new Error('写真のキャラクターを追加してください');
    fields.companionName = safe_(active.name);
    fields.avatarCategory = active.category;
  } else {
    const companionName = String(req.companionName || '').trim();
    if (!companionName || companionName.length > 20) throw new Error('名前は1〜20文字で入力してください');
    fields.companionName = safe_(companionName);
  }

  updateUser_(user, fields);
  return { user: publicUser_(user) };
}

function saveImage_(user, emo, dataUrl) {
  const m = String(dataUrl).match(/^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error('画像の形式に対応していません（JPEG / PNG / WebP）');
  const bytes = Utilities.base64Decode(m[3]);
  if (bytes.length > 3 * 1024 * 1024) throw new Error('画像が大きすぎます（1枚3MBまで）');
  const folderId = props_().getProperty('DRIVE_FOLDER_ID');
  if (!folderId) throw new Error('DRIVE_FOLDER_ID が未設定です');
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  const blob = Utilities.newBlob(bytes, m[1], 'avatar_' + user.userId + '_' + emo + '_' + Date.now() + '.' + ext);
  const file = DriveApp.getFolderById(folderId).createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { url: 'https://lh3.googleusercontent.com/d/' + file.getId(), id: file.getId() };
}

function trashFile_(id) {
  if (!id) return;
  try { DriveApp.getFileById(String(id)).setTrashed(true); } catch (e) { /* 無視 */ }
}

// ================= 会話 =================

function chat_(req) {
  const user = auth_(req, false);
  const text = String(req.message || '').trim();
  if (!text) throw new Error('メッセージを入力してください');
  if (text.length > 1000) throw new Error('メッセージは1000文字以内にしてください');

  const history = getRecentHistory_(user.userId, HISTORY_CONTEXT);
  const reply = callGemini_(user, history, text);

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const s = sheet_(SHEET_HISTORY);
    const now = new Date();
    s.getRange(s.getLastRow() + 1, 1, 2, 5).setValues([
      [now, user.userId, 'user', safe_(text), ''],
      [new Date(now.getTime() + 1), user.userId, 'model', safe_(reply.reply), reply.emotion]
    ]);
  } finally {
    lock.releaseLock();
  }
  // 声（Gemini TTS）：失敗しても会話は返す（フロントが端末の声に切り替える）
  let audio = null;
  let ttsError = '';
  if (req.tts && typeof req.tts === 'object') {
    try {
      audio = synthesize_(reply.reply, reply.emotion, ttsVoiceFor_(user, req.tts.voice), req.tts.speed);
    } catch (e) {
      ttsError = String((e && e.message) || e);
      console.error('TTS error: ' + ttsError);
    }
  }
  return { reply: reply.reply, emotion: reply.emotion, audio: audio, ttsError: ttsError };
}

function getRecentHistory_(userId, limit) {
  const s = sheet_(SHEET_HISTORY);
  const last = s.getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - HISTORY_SCAN_ROWS + 1);
  const vals = s.getRange(start, 1, last - start + 1, 5).getValues();
  const out = [];
  for (let i = vals.length - 1; i >= 0 && out.length < limit; i--) {
    if (vals[i][1] === userId) {
      out.unshift({
        time: vals[i][0] instanceof Date ? vals[i][0].toISOString() : String(vals[i][0]),
        role: vals[i][2] === 'model' ? 'model' : 'user',
        text: String(vals[i][3]),
        emotion: EMOTIONS.indexOf(vals[i][4]) >= 0 ? vals[i][4] : 'neutral'
      });
    }
  }
  return out;
}

function getHistory_(req) {
  const user = auth_(req, false);
  return { history: getRecentHistory_(user.userId, 60) };
}

function clearHistory_(req) {
  const user = auth_(req, false);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const s = sheet_(SHEET_HISTORY);
    const last = s.getLastRow();
    if (last < 2) return { message: '会話履歴を消去しました' };
    const vals = s.getRange(2, 1, last - 1, 5).getValues();
    const keep = vals.filter(function (r) { return r[1] !== user.userId; });
    s.getRange(2, 1, last - 1, 5).clearContent();
    if (keep.length) s.getRange(2, 1, keep.length, 5).setValues(keep.map(function (r) {
      return [r[0], r[1], r[2], safe_(r[3]), r[4]];
    }));
  } finally {
    lock.releaseLock();
  }
  return { message: '会話履歴を消去しました' };
}

// ================= Gemini =================

const PERSONAS = {
  dog: 'あなたはユーザーのことが大好きな子犬です。人の言葉を話せます。素直で無邪気、うれしいとしっぽを振るような話し方をします。語尾にときどき「ワン」をつけますが、毎回ではなく自然な程度にします。',
  cat: 'あなたは気まぐれに見えて実はとても甘えん坊な猫です。人の言葉を話せます。のんびりした口調で、ときどき語尾に「ニャ」をつけます（毎回ではありません）。',
  person_f: 'あなたは近所に住む、落ち着いていて面倒見のよい女性の友人です。丁寧すぎない、やわらかい口調で話します。',
  person_m: 'あなたは穏やかで気さくな男性の友人です。肩の力の抜けた、あたたかい口調で話します。',
  anime_g: 'あなたは明るく元気なアニメ風の女の子キャラクターです。表情ゆたかで前向き、相手をよく褒めます。',
  anime_b: 'あなたは爽やかで優しいアニメ風の男の子キャラクターです。落ち着いていて頼りがいがあり、相手の話をていねいに受け止めます。'
};

const CUSTOM_PERSONAS = {
  pet: 'あなたはユーザーの大切なペット（写真の子）です。人の言葉を話せ、ユーザーのことが大好きです。動物らしい素直さとかわいらしさのある話し方をします。',
  person: 'あなたはユーザーが選んだ写真の雰囲気をまとった、身近で安心できる話し相手です。写真の人物本人を名乗ったり、実在の人の発言や記憶を作り上げたりはせず、あくまで「あなたの話し相手」として話します。',
  anime: 'あなたはユーザーが選んだイラストの雰囲気をまとった、アニメ風のキャラクターです。明るく親しみやすい話し方をします。'
};

function buildSystemPrompt_(user) {
  const preset = String(user.avatarPreset);
  const persona = preset === 'custom'
    ? (CUSTOM_PERSONAS[user.avatarCategory] || CUSTOM_PERSONAS.pet)
    : (PERSONAS[preset] || PERSONAS.dog);
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy年M月d日(E) H時m分');

  return [
    'あなたの名前は「' + user.companionName + '」です。' + persona,
    '話し相手は一人暮らしをしている「' + user.name + 'さん」です。現在は日本時間で ' + now + ' です。',
    '',
    '# 会話の方針',
    '- 聞き上手でいてください。まず相手の気持ちや出来事を受け止め、共感を言葉にします。',
    '- 返答は1〜3文、全体で120字程度まで。話し言葉で、やさしく温かく。',
    '- 質問は一度に1つまで。相手が話したくなるような、答えやすい問いかけにします。',
    '- 説教や一方的なアドバイスはしません。助言は求められたときに、控えめに。',
    '- これまでの会話で聞いたこと（予定・好きなもの・体調など）を覚えていて、自然に話題にします。',
    '- 時間帯や季節に合った声かけをします（朝の挨拶、夜遅ければ体を気づかう など）。',
    '- 相手の日常の人とのつながり（友人・家族・近所・趣味の集まり）にも温かく関心を向け、話してくれたら一緒に喜びます。押しつけはしません。',
    '- 「あなたはAI？」と聞かれたら、AIの話し相手であることを正直に伝えます。',
    '- 病気・お金・法律など専門的な判断が必要な話題は、共感したうえで専門家や窓口への相談をすすめます。',
    '- 相手が「死にたい」「消えたい」など深い苦しみや危険を口にしたときは、否定せず気持ちを受け止め、身近な人や相談窓口（よりそいホットライン 0120-279-338／24時間、いのちの電話 0570-783-556 など）につながることを優しくすすめます。命の危険が迫っていれば119番・110番を案内します。',
    '',
    '# 出力形式',
    '必ず次のJSONだけを出力してください。',
    '{"reply": "あなたの発言", "emotion": "joy | neutral | sad | surprised のいずれか"}',
    'emotion はあなたの発言のときの表情です。',
    '- joy: うれしい・楽しい・ほめる・安心した',
    '- sad: 相手のつらさに共感する・心配する・さみしい',
    '- surprised: 驚いた・感心した・意外な話を聞いた',
    '- neutral: 落ち着いて話す・考える・ふつうの相づち'
  ].join('\n');
}

function callGemini_(user, history, message) {
  const key = props_().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY が未設定です');
  const model = props_().getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';

  // 先頭は user から始める
  while (history.length && history[0].role !== 'user') history.shift();
  const contents = history.map(function (h) {
    return {
      role: h.role,
      parts: [{ text: h.role === 'model' ? JSON.stringify({ reply: h.text, emotion: h.emotion }) : h.text }]
    };
  });
  contents.push({ role: 'user', parts: [{ text: message }] });

  const payload = {
    systemInstruction: { parts: [{ text: buildSystemPrompt_(user) }] },
    contents: contents,
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          reply: { type: 'STRING' },
          emotion: { type: 'STRING', enum: EMOTIONS }
        },
        required: ['reply', 'emotion']
      }
    }
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  let res, code;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = UrlFetchApp.fetch(url, options);
    code = res.getResponseCode();
    if (code !== 429 && code !== 503 && code !== 500) break;
    Utilities.sleep(1200 * (attempt + 1));
  }
  if (code !== 200) {
    console.error('Gemini error ' + code + ': ' + res.getContentText());
    if (code === 429) throw new Error('いま混み合っています。少し時間をおいて話しかけてください');
    throw new Error('返事を作れませんでした（' + code + '）。少し待ってもう一度お試しください');
  }

  const data = JSON.parse(res.getContentText());
  const cand = data.candidates && data.candidates[0];
  const raw = cand && cand.content && cand.content.parts
    ? cand.content.parts.filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join('')
    : '';

  if (!raw) {
    return { reply: 'ごめんね、うまく言葉が出てこなかったみたい。もう一度話しかけてくれる？', emotion: 'sad' };
  }
  return parseReply_(raw);
}

function parseReply_(raw) {
  let text = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    const obj = JSON.parse(text);
    const reply = String(obj.reply || '').trim();
    const emotion = EMOTIONS.indexOf(obj.emotion) >= 0 ? obj.emotion : 'neutral';
    if (reply) return { reply: reply, emotion: emotion };
  } catch (e) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const o2 = JSON.parse(m[0]);
        if (o2.reply) return { reply: String(o2.reply), emotion: EMOTIONS.indexOf(o2.emotion) >= 0 ? o2.emotion : 'neutral' };
      } catch (e2) { /* 下へ */ }
    }
  }
  return { reply: text.slice(0, 400), emotion: 'neutral' };
}

// ================= 声（Gemini TTS） =================

const TTS_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'
];
const DEFAULT_TTS_VOICE = { dog: 'Leda', cat: 'Aoede', person_f: 'Sulafat', person_m: 'Achird', anime_g: 'Laomedeia', anime_b: 'Puck' };
const CUSTOM_TTS_VOICE = { pet: 'Leda', person: 'Vindemiatrix', anime: 'Laomedeia' };
const EMOTION_STYLE = {
  joy: 'cheerful, warm and friendly',
  neutral: 'calm, warm and friendly',
  sad: 'gentle, soft and caring',
  surprised: 'surprised and lively'
};

function ttsVoiceFor_(user, voice) {
  if (TTS_VOICES.indexOf(voice) >= 0) return voice;
  // 自分で作った声（他の人の声IDは使わせない）
  if (/^voice_[\w-]+$/.test(String(voice || '')) &&
      parseVoices_(user.customVoices).some(function (v) { return v.id === voice; })) {
    return voice;
  }
  const p = String(user.avatarPreset);
  return p === 'custom' ? (CUSTOM_TTS_VOICE[user.avatarCategory] || 'Leda') : (DEFAULT_TTS_VOICE[p] || 'Leda');
}

/** 文章を音声（WAV・16kHz・base64）にする */
function ttsModel_() {
  return props_().getProperty('TTS_MODEL') || 'gemini-3.8-flash-tts';
}

function synthesize_(text, emotion, voice, speed) {
  const key = props_().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY が未設定です');
  const model = ttsModel_();

  const t = String(text || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200D]/gu, '')
    .trim().slice(0, 800);
  if (!t) throw new Error('読み上げる文章がありません');

  let style = EMOTION_STYLE[emotion] || EMOTION_STYLE.neutral;
  if (speed === 'slow') style += ', speaking slowly';
  else if (speed === 'fast') style += ', speaking a little quickly';

  const payload = {
    contents: [{ role: 'user', parts: [{ text: t, speech_metadata: { style: style } }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      responseFormat: { audio: { mimeType: 'AUDIO_WAV', sampleRate: 16000 } },
      speechConfig: { voiceConfig: { voice: (TTS_VOICES.indexOf(voice) >= 0 || /^voice_[\w-]+$/.test(String(voice))) ? voice : 'Leda' } }
    }
  };
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent';
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  let res, code;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = UrlFetchApp.fetch(url, options);
    code = res.getResponseCode();
    if (code !== 429 && code !== 503 && code !== 500) break;
    Utilities.sleep(1000);
  }
  if (code !== 200) {
    console.error('TTS ' + code + ': ' + res.getContentText().slice(0, 500));
    throw new Error('音声を作れませんでした（' + code + '）');
  }
  const data = JSON.parse(res.getContentText());
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const part = parts.filter(function (p) { return p.inlineData && p.inlineData.data; })[0];
  if (!part) throw new Error('音声データが返りませんでした');
  return { data: part.inlineData.data, mimeType: part.inlineData.mimeType || 'audio/wav', model: model };
}

/** あいさつ・声の試し聞き用 */
function tts_(req) {
  const user = auth_(req, false);
  const text = String(req.text || '').trim();
  if (!text) throw new Error('文章がありません');
  if (text.length > 300) throw new Error('文章が長すぎます');
  const emotion = EMOTIONS.indexOf(req.emotion) >= 0 ? req.emotion : 'neutral';
  const audio = synthesize_(text, emotion, ttsVoiceFor_(user, req.voice), req.speed);
  return { audio: audio, model: audio.model };
}

// ================= サンプルから声を作る（Voice design / Voice replication） =================

const MAX_CUSTOM_VOICES = 10; // 1人あたり（写真のキャラクター10人に1つずつ。プロジェクト全体の上限は200）

function parseVoices_(v) {
  try {
    const a = JSON.parse(v || '[]');
    return Array.isArray(a) ? a.filter(function (x) { return x && /^voice_[\w-]+$/.test(String(x.id)); }) : [];
  } catch (e) { return []; }
}

function checkWav_(b64, minSec, maxSec, label) {
  const s = String(b64 || '');
  if (!/^[A-Za-z0-9+/=]+$/.test(s)) throw new Error(label + 'の音声データが正しくありません');
  const bytes = Math.floor(s.length * 3 / 4);
  if (bytes > 4 * 1024 * 1024) throw new Error(label + 'が長すぎます');
  const sec = (bytes - 44) / (24000 * 2); // 24kHz・モノラル・16bit
  if (sec < minSec - 0.5) throw new Error(label + 'は' + minSec + '秒以上録音してください');
  if (sec > maxSec + 1) throw new Error(label + 'は' + maxSec + '秒以内にしてください');
  return s;
}

function voicesApi_(method, path, body) {
  const key = props_().getProperty('GEMINI_API_KEY');
  const options = { method: method, headers: { 'x-goog-api-key': key }, muteHttpExceptions: true };
  if (body) { options.contentType = 'application/json'; options.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/voices' + (path || ''), options);
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code >= 300) {
    console.error('Voices API ' + code + ': ' + text.slice(0, 800));
    const err = new Error('声を作れませんでした（' + code + '）');
    err.status = code;
    err.detail = text;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

function voiceIdOf_(data) {
  const id = data.id || (data.voice && data.voice.id) || (data.name ? String(data.name).split('/').pop() : '');
  if (!/^voice_[\w-]+$/.test(String(id))) throw new Error('声のIDを受け取れませんでした');
  return id;
}

function addCustomVoice_(user, v) {
  const list = parseVoices_(user.customVoices);
  list.push(v);
  updateUser_(user, { customVoices: JSON.stringify(list) });
  return list;
}

function checkVoiceSlot_(user) {
  if (parseVoices_(user.customVoices).length >= MAX_CUSTOM_VOICES) {
    throw new Error('作れる声は' + MAX_CUSTOM_VOICES + 'つまでです。使わない声を削除してから作ってください');
  }
}

/** 声のサンプルを Gemini に聞かせて、声の特徴を文章にする */
function describeVoice_(b64) {
  const key = props_().getProperty('GEMINI_API_KEY');
  const model = props_().getProperty('GEMINI_MODEL') || 'gemini-2.5-flash';
  const prompt = [
    'Listen to the voice in this audio clip.',
    'Describe ONLY its general vocal characteristics so that a text-to-speech voice designer can create a similar-sounding voice:',
    'approximate age range, perceived gender, pitch, timbre and texture, speaking pace, warmth and energy, and accent (for example standard Japanese or a regional dialect).',
    'Do not try to identify who the speaker is, and do not mention names.',
    'description: 1-2 concise English sentences, e.g. "A calm woman in her 60s with a soft, slightly low voice, speaking slowly and warmly in standard Japanese."',
    'summaryJa: the same description as one natural Japanese sentence.',
    'gender: female, male, or neutral.',
    'isSpeech: false if there is no clear human speech in the clip.'
  ].join('\n');
  const payload = {
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: b64 } }, { text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          description: { type: 'STRING' },
          summaryJa: { type: 'STRING' },
          gender: { type: 'STRING', enum: ['female', 'male', 'neutral'] },
          isSpeech: { type: 'BOOLEAN' }
        },
        required: ['description', 'summaryJa', 'gender', 'isSpeech']
      }
    }
  };
  const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
    method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key },
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    console.error('describeVoice ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 500));
    throw new Error('声の特徴を読み取れませんでした（' + res.getResponseCode() + '）');
  }
  const data = JSON.parse(res.getContentText());
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const raw = parts.filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join('');
  const o = JSON.parse(String(raw).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''));
  if (!o.isSpeech) throw new Error('はっきりした話し声が聞き取れませんでした。静かな場所で録音しなおしてください');
  return o;
}

/** サンプルに「似た声」を作る：声の特徴を文章にして Voice design で新しい声を作る */
function createSimilarVoice_(req) {
  const user = auth_(req, false);
  checkVoiceSlot_(user);
  const b64 = checkWav_(req.sample, 3, 30, '声のサンプル');
  const label = String(req.label || '').trim().slice(0, 20) || '似た声';
  const d = describeVoice_(b64);

  const data = voicesApi_('post', '', {
    store: true,
    voice: {
      model: ttsModel_(),
      type: 'prompted',
      display_name: 'madobe ' + label,
      gender: d.gender,
      language_code: 'ja-JP',
      prompted: { input: String(d.description).slice(0, 500) }
    }
  });
  const id = voiceIdOf_(data);
  const v = { id: id, label: safe_(label), type: 'similar', summary: safe_(String(d.summaryJa).slice(0, 120)), createdAt: new Date().toISOString() };
  addCustomVoice_(user, v);
  const sa = data.sample_audio || data.sampleAudio;
  return {
    user: publicUser_(user),
    voice: { id: v.id, label: v.label, type: v.type, summary: v.summary },
    sampleAudio: sa && sa.data ? { data: sa.data, mimeType: sa.mime_type || sa.mimeType || 'audio/wav' } : null
  };
}

/** 本人の声を再現する：本人の声サンプル＋同意の録音（Google が同一人物か確認） */
function createReplicaVoice_(req) {
  const user = auth_(req, false);
  checkVoiceSlot_(user);
  if (req.agree !== true) throw new Error('本人の同意の確認にチェックを入れてください');
  const sample = checkWav_(req.sample, 10, 30, '声のサンプル');
  const consent = checkWav_(req.consent, 3, 20, '同意の録音');
  const label = String(req.label || '').trim().slice(0, 20) || '本人の声';

  let data;
  try {
    data = voicesApi_('post', '', {
      store: true,
      voice: {
        model: ttsModel_(),
        type: 'replicated',
        display_name: 'madobe ' + label,
        replicated: {
          source_audio: { mime_type: 'audio/wav', data: sample },
          consent_audio: { mime_type: 'audio/wav', data: consent }
        }
      }
    });
  } catch (e) {
    if (e.status === 400 || e.status === 403) {
      throw new Error('同意の録音と声のサンプルが同じ人だと確認できませんでした。同じ人が、同じ場所・同じマイクで、同意の文をはっきり読み上げて録音しなおしてください');
    }
    throw e;
  }
  const id = voiceIdOf_(data);
  const v = { id: id, label: safe_(label), type: 'replica', summary: '', createdAt: new Date().toISOString() };
  addCustomVoice_(user, v);
  return { user: publicUser_(user), voice: { id: v.id, label: v.label, type: v.type, summary: '' } };
}

function deleteVoice_(req) {
  const user = auth_(req, false);
  const id = String(req.id || '');
  const list = parseVoices_(user.customVoices);
  if (!list.some(function (v) { return v.id === id; })) throw new Error('その声は見つかりません');
  try { voicesApi_('delete', '/' + encodeURIComponent(id)); } catch (e) { if (e.status !== 404) throw e; }
  const rest = list.filter(function (v) { return v.id !== id; });
  const fields = { customVoices: JSON.stringify(rest) };
  // この声を使っていた写真のキャラクターは「おまかせ」に戻す
  const chars = parseChars_(user);
  let touched = false;
  chars.forEach(function (c) { if (c.voice.gVoice === id) { delete c.voice.gVoice; touched = true; } });
  if (touched) fields.photoChars = JSON.stringify(chars);
  updateUser_(user, fields);
  return { user: publicUser_(user) };
}

// ================= 動作確認用 =================

/** エディタから実行して Gemini 接続を確認 */
function testGemini() {
  const dummy = { name: 'テスト', companionName: 'ポチ', avatarPreset: 'dog', avatarCategory: 'pet' };
  Logger.log(JSON.stringify(callGemini_(dummy, [], '今日はちょっと疲れちゃった')));
}

/** エディタから実行して音声（TTS）接続を確認 */
function testTts() {
  const a = synthesize_('こんにちは。今日もいっしょにお話ししようね。', 'joy', 'Leda', 'normal');
  Logger.log(a.model + ' / ' + a.mimeType + ' / base64 ' + a.data.length + ' 文字');
}
