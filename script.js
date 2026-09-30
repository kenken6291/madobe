/* =========================================================
   まどべ — script.js
   ※ GASのURLは config.js に書きます
   ========================================================= */
'use strict';

const GAS_URL = String(window.GAS_URL || '');
const TOKEN_KEY = 'madobe_token';
const PREFS_KEY = 'madobe_prefs';
const EMOTIONS = ['joy', 'neutral', 'sad', 'surprised'];
// 写真は「目の位置」だけ登録（口の変化は写真では表示しない）
const CALIB_KEYS = ['eyeL', 'eyeR'];
const CALIB_LABELS = ['画面の左側にある目', '画面の右側にある目'];
const PHOTO_EMOS = ['neutral', 'joy', 'sad', 'surprised'];
const PHOTO_SUBS = ['blink', 'talk'];                 // 普通の顔の「瞬き」「しゃべり」
const PHOTO_SLOTS = [...PHOTO_EMOS, ...PHOTO_SUBS];
// 目の位置を登録できる写真（瞬き写真は目を閉じているので不要）
const EYE_SLOTS = ['neutral', 'joy', 'sad', 'surprised', 'talk'];
const PER_KEYS = ['joy', 'sad', 'surprised', 'talk'];
const EMO_LABELS = {
  neutral: '普通の顔', joy: '笑顔', sad: '困り顔', surprised: '驚き顔',
  blink: '瞬き', talk: 'しゃべり'
};
const SLOT_HINTS = {
  blink: '普通の顔で「目を閉じた」写真です。まばたきのときに一瞬だけ切り替わります。',
  talk: '普通の顔で「口を開けた」写真です。しゃべっている間、普通の顔と交互に切り替わります。「普通の顔」と同じ位置・大きさで撮ってください。'
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* 無視 */ } },
  del(k) { try { localStorage.removeItem(k); } catch (_) { /* 無視 */ } }
};

// ---- 端末ごとの設定（声・表示・聞き取り） ----
const DEFAULT_PREFS = {
  tts: true,           // 返事を声で読み上げる
  handsFree: false,    // マイクを押さずに話せる（聞き取りモード）
  micAutoSend: true,   // 話し終わったら自動で送る
  stageMode: false,    // キャラクター全画面
  showCaption: true,   // 全画面時の字幕
  hideInput: false,    // 全画面時に入力欄を隠す
  browserFs: true,     // ブラウザも全画面に
  voices: {}           // キャラクターごとの声 { preset: {voiceURI, rate, pitch} }
};

function loadPrefs() {
  let p = {};
  try { p = JSON.parse(store.get(PREFS_KEY) || '{}') || {}; } catch (_) { p = {}; }
  const merged = Object.assign({}, DEFAULT_PREFS, p);
  merged.voices = Object.assign({}, p.voices || {});
  return merged;
}
const prefs = loadPrefs();
function savePrefs() { store.set(PREFS_KEY, JSON.stringify(prefs)); }

const state = {
  token: store.get(TOKEN_KEY) || '',
  user: null,
  sending: false,
  speaking: false,
  skipTyping: false,
  forcedPw: false
};

// =========================================================
// プリセットアバター（SVG）
// =========================================================

const PRESETS = {
  dog: {
    category: 'pet', label: 'いぬ',
    base: `
      <ellipse cx="54" cy="118" rx="27" ry="54" fill="#8a5a3b" transform="rotate(20 54 118)"/>
      <ellipse cx="186" cy="118" rx="27" ry="54" fill="#8a5a3b" transform="rotate(-20 186 118)"/>
      <circle cx="120" cy="126" r="78" fill="#dca46c"/>
      <ellipse cx="120" cy="68" rx="30" ry="17" fill="#e9bb88"/>
      <ellipse cx="120" cy="162" rx="44" ry="33" fill="#f6e2c8"/>
      <ellipse cx="120" cy="144" rx="12" ry="8.5" fill="#3b2a22"/>
      <ellipse cx="116" cy="141" rx="4" ry="2.4" fill="#fff" opacity=".55"/>
      <path d="M120,152 L120,159" stroke="#4a2e20" stroke-width="3" stroke-linecap="round"/>`,
    eye: { kind: 'dot', l: [92, 114], r: [148, 114] },
    brow: { y: 93, len: 10, color: '#6b4226', width: 4.5 },
    mouth: { x: 120, y: 166, line: '#4a2e20', inner: '#7a2e36', scale: 1 },
    cheeks: [[80, 150], [160, 150]]
  },
  cat: {
    category: 'pet', label: 'ねこ',
    base: `
      <path d="M48,100 L60,26 L110,64 Z" fill="#e8964a"/>
      <path d="M192,100 L180,26 L130,64 Z" fill="#e8964a"/>
      <path d="M62,86 L68,44 L96,66 Z" fill="#f7b8b8"/>
      <path d="M178,86 L172,44 L144,66 Z" fill="#f7b8b8"/>
      <ellipse cx="120" cy="132" rx="80" ry="74" fill="#f0a55a"/>
      <path d="M104,66 Q108,80 104,90 M120,62 Q124,78 120,90 M136,66 Q132,80 136,90" stroke="#c9742f" stroke-width="5" fill="none" stroke-linecap="round"/>
      <ellipse cx="120" cy="164" rx="36" ry="25" fill="#fff1e0"/>
      <path d="M112,148 L128,148 L120,157 Z" fill="#e9848f" stroke="#e9848f" stroke-width="2" stroke-linejoin="round"/>
      <g stroke="#7a4a2a" stroke-width="2" stroke-linecap="round" opacity=".55">
        <path d="M86,160 L44,152"/><path d="M86,168 L44,174"/>
        <path d="M154,160 L196,152"/><path d="M154,168 L196,174"/>
      </g>`,
    eye: { kind: 'cat', color: '#7cc36e', l: [92, 122], r: [148, 122] },
    brow: { y: 100, len: 9, color: '#b8652a', width: 4 },
    mouth: { x: 120, y: 167, line: '#6b3f25', inner: '#7a2e36', scale: .9 },
    cheeks: [[78, 152], [162, 152]]
  },
  person_f: {
    category: 'person', label: 'やさしい女性',
    base: `
      <path d="M38,126 Q36,34 120,32 Q204,34 202,126 L208,222 Q120,240 32,222 Z" fill="#5a3a2a"/>
      <path d="M44,240 Q54,198 120,196 Q186,198 196,240 Z" fill="#9cc5b4"/>
      <rect x="104" y="176" width="32" height="30" rx="10" fill="#eec3a6"/>
      <ellipse cx="55" cy="130" rx="9" ry="13" fill="#f3cdb2"/>
      <ellipse cx="185" cy="130" rx="9" ry="13" fill="#f3cdb2"/>
      <ellipse cx="120" cy="126" rx="65" ry="76" fill="#f7d9c3"/>
      <path d="M54,112 Q58,44 120,42 Q182,44 186,112 Q170,84 138,76 Q110,96 72,90 Q60,98 54,112 Z" fill="#5a3a2a"/>
      <path d="M121,132 Q116,146 123,149" stroke="#d6a488" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
    eye: { kind: 'human', color: '#6b4430', l: [96, 124], r: [144, 124] },
    brow: { y: 104, len: 11, color: '#4a3024', width: 3.4 },
    mouth: { x: 120, y: 164, line: '#b5585b', inner: '#8a3440', scale: .9 },
    cheeks: [[84, 150], [156, 150]]
  },
  person_m: {
    category: 'person', label: 'おだやかな男性',
    base: `
      <path d="M40,240 Q50,196 120,194 Q190,196 200,240 Z" fill="#6f93b8"/>
      <rect x="102" y="174" width="36" height="32" rx="10" fill="#e9bb98"/>
      <ellipse cx="58" cy="128" rx="9" ry="14" fill="#efc4a4"/>
      <ellipse cx="182" cy="128" rx="9" ry="14" fill="#efc4a4"/>
      <ellipse cx="120" cy="124" rx="62" ry="76" fill="#f3cfb3"/>
      <path d="M56,118 Q48,38 120,36 Q194,38 186,118 Q180,82 156,70 Q128,88 92,72 Q64,82 56,118 Z" fill="#3a2c24"/>
      <path d="M121,130 Q116,145 124,148" stroke="#cf9a7c" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
    eye: { kind: 'human', color: '#4a3326', l: [96, 122], r: [144, 122] },
    brow: { y: 101, len: 12, color: '#3a2c24', width: 5 },
    mouth: { x: 120, y: 163, line: '#a8605a', inner: '#7e3238', scale: 1 },
    cheeks: [[84, 148], [156, 148]]
  },
  anime_g: {
    category: 'anime', label: '元気な女の子',
    base: `
      <ellipse cx="34" cy="150" rx="24" ry="62" fill="#f08cb8" transform="rotate(8 34 150)"/>
      <ellipse cx="206" cy="150" rx="24" ry="62" fill="#f08cb8" transform="rotate(-8 206 150)"/>
      <ellipse cx="120" cy="118" rx="86" ry="84" fill="#f49ac1"/>
      <path d="M58,240 Q66,204 120,202 Q174,204 182,240 Z" fill="#ffffff" stroke="#f3b4cf" stroke-width="3"/>
      <rect x="108" y="186" width="24" height="22" rx="8" fill="#fbd9c8"/>
      <path d="M60,110 Q60,188 120,206 Q180,188 180,110 Q180,52 120,52 Q60,52 60,110 Z" fill="#ffe8dc"/>
      <path d="M52,120 Q48,38 120,34 Q192,38 188,120 L176,92 L163,114 L150,82 L133,108 L120,78 L106,108 L90,82 L78,114 L64,92 Z" fill="#f49ac1"/>
      <path d="M44,68 L26,54 L30,78 Z M44,68 L62,54 L58,78 Z" fill="#ff5d8f"/>
      <circle cx="44" cy="68" r="5" fill="#ff5d8f"/>
      <path d="M120,148 L118,152" stroke="#e7a58f" stroke-width="2" stroke-linecap="round"/>`,
    eye: { kind: 'anime', color: '#7b61d9', l: [92, 130], r: [148, 130] },
    brow: { y: 98, len: 9, color: '#d16a96', width: 3 },
    mouth: { x: 120, y: 170, line: '#c0506a', inner: '#9a3550', scale: .8 },
    cheeks: [[78, 156], [162, 156]]
  },
  anime_b: {
    category: 'anime', label: 'やさしい男の子',
    base: `
      <ellipse cx="120" cy="112" rx="80" ry="76" fill="#4d7fd1"/>
      <path d="M56,240 Q64,202 120,200 Q176,202 184,240 Z" fill="#2f4a74"/>
      <path d="M106,201 L120,222 L134,201 Z" fill="#ffffff"/>
      <rect x="107" y="184" width="26" height="22" rx="8" fill="#f6d2bd"/>
      <path d="M62,108 Q62,186 120,204 Q178,186 178,108 Q178,52 120,52 Q62,52 62,108 Z" fill="#fde3d3"/>
      <path d="M50,124 Q40,34 124,30 Q200,36 190,124 L180,96 L170,112 L160,78 L140,104 L126,70 L110,104 L92,76 L82,110 L66,90 Z" fill="#4d7fd1"/>
      <path d="M110,34 L96,10 L126,30 Z M140,36 L156,14 L150,42 Z" fill="#4d7fd1"/>
      <path d="M120,146 L118,150" stroke="#e1a58f" stroke-width="2" stroke-linecap="round"/>`,
    eye: { kind: 'anime', color: '#2aa198', l: [93, 128], r: [147, 128] },
    brow: { y: 97, len: 11, color: '#2d5aa8', width: 4 },
    mouth: { x: 120, y: 168, line: '#b0555f', inner: '#8a3240', scale: .8 },
    cheeks: [[80, 152], [160, 152]]
  }
};

function presetLabel(key) { return key === 'custom' ? '写真' : (PRESETS[key] ? PRESETS[key].label : ''); }

function eyeInner(kind, color) {
  switch (kind) {
    case 'dot':
      return `<circle r="9" fill="#2b1d16"/><circle cx="3" cy="-3" r="3" fill="#fff"/>`;
    case 'cat':
      return `<ellipse rx="10" ry="12" fill="${color}" stroke="#3a2a1a" stroke-width="1.5"/>
              <ellipse rx="3.2" ry="9" fill="#1b1b1b"/><circle cx="3.5" cy="-5" r="2.6" fill="#fff"/>`;
    case 'human':
      return `<ellipse rx="12" ry="8.5" fill="#fff"/>
              <circle r="6.5" fill="${color}"/><circle r="3.2" fill="#1b1411"/>
              <circle cx="2.5" cy="-2.5" r="1.8" fill="#fff"/>
              <path d="M-13,-1 Q0,-12 13,-1" stroke="#3a2a22" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
    case 'anime':
      return `<ellipse rx="15" ry="18" fill="#fff"/>
              <ellipse cy="2" rx="11" ry="14.5" fill="${color}"/>
              <ellipse cy="5" rx="6" ry="8" fill="#241a3a"/>
              <circle cx="-4" cy="-5" r="4.2" fill="#fff"/>
              <circle cx="4" cy="8" r="2" fill="#fff" opacity=".8"/>
              <path d="M-17,-8 Q0,-24 17,-10" stroke="#2a1f2e" stroke-width="4" fill="none" stroke-linecap="round"/>`;
    default:
      return '';
  }
}

function presetSVG(key) {
  const p = PRESETS[key] || PRESETS.dog;
  const hs = p.eye.kind === 'anime' ? 1.3 : 1;
  const eye = ([x, y]) => `
    <g transform="translate(${x} ${y})">
      <g class="eye-scale">
        <g class="eye-open">${eyeInner(p.eye.kind, p.eye.color)}</g>
        <path class="eye-happy" d="M${-12 * hs},${3 * hs} Q0,${-9 * hs} ${12 * hs},${3 * hs}"
              stroke="#3a2a22" stroke-width="4" fill="none" stroke-linecap="round"/>
      </g>
    </g>`;
  const brow = (x, cls) => `
    <g transform="translate(${x} ${p.brow.y})">
      <path class="brow ${cls}" d="M${-p.brow.len},2 Q0,-4 ${p.brow.len},2"
            stroke="${p.brow.color}" stroke-width="${p.brow.width}" fill="none" stroke-linecap="round"/>
    </g>`;
  const m = p.mouth;
  const mouth = `
    <g transform="translate(${m.x} ${m.y}) scale(${m.scale})">
      <path class="m m-neutral" d="M-12,0 Q0,6 12,0" stroke="${m.line}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      <g class="m m-joy">
        <path d="M-17,-3 Q0,22 17,-3 Z" fill="${m.inner}" stroke="${m.line}" stroke-width="2" stroke-linejoin="round"/>
        <ellipse cx="0" cy="5" rx="7" ry="3.5" fill="#e7777f"/>
      </g>
      <path class="m m-sad" d="M-12,5 Q0,-5 12,5" stroke="${m.line}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      <ellipse class="m m-surprised" rx="7" ry="9" fill="${m.inner}"/>
      <ellipse class="m m-talk" rx="11" ry="10" fill="${m.inner}"/>
    </g>`;
  const cheeks = p.cheeks.map(([x, y]) => `<ellipse class="cheek" cx="${x}" cy="${y}" rx="12" ry="6.5" fill="#ff8fa3"/>`).join('');
  const [lx, ly] = p.eye.l;
  const tear = `<g transform="translate(${lx + 9} ${ly + 13})"><path class="tear" d="M0,0 Q-5,8 0,12 Q5,8 0,0 Z" fill="#8fd3ff" stroke="#5bb6e8" stroke-width="1"/></g>`;

  return `<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${p.label}">
    ${p.base}${cheeks}${eye(p.eye.l)}${eye(p.eye.r)}${brow(p.eye.l[0], 'brow-l')}${brow(p.eye.r[0], 'brow-r')}${mouth}${tear}
  </svg>`;
}

// =========================================================
// 写真アバター（パーツをオーバーレイ）
// =========================================================

function defaultConfig() {
  return {
    eyeL: { x: 38, y: 42 }, eyeR: { x: 62, y: 42 }, mouth: { x: 50, y: 68 },
    lidColor: '#d9a88a', brows: false,
    perEmotion: { joy: null, sad: null, surprised: null, talk: null }
  };
}

function normalizeConfig(cfg) {
  const c = Object.assign(defaultConfig(), JSON.parse(JSON.stringify(cfg || {})));
  c.perEmotion = Object.assign({ joy: null, sad: null, surprised: null, talk: null }, c.perEmotion || {});
  return c;
}

/** 表情ごとの目・口の位置（個別指定がなければ普通の顔と同じ） */
function slotConfigOf(cfg, emo) {
  const base = normalizeConfig(cfg);
  if (emo === 'neutral') return base;
  const pe = base.perEmotion[emo];
  return Object.assign({}, base, pe || {}, { brows: false });
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function photoLayerHTML(url, c, emo, opts = {}) {
  const { lids = true, cls = 'main' } = opts;
  const d = Math.max(8, Math.hypot(c.eyeR.x - c.eyeL.x, c.eyeR.y - c.eyeL.y));
  const er = d * 0.26;
  // 上端を基準に scaleY で下ろす（1=閉じる / .38=笑顔の細め目）
  const lid = e => `<ellipse class="lid" cx="${e.x}" cy="${e.y}" rx="${er * 1.25}" ry="${er * 1.05}" fill="${escAttr(c.lidColor)}"/>`;
  const brow = (e, bcls) => c.brows ? `
    <g transform="translate(${e.x} ${e.y - er * 1.9})">
      <path class="brow ${bcls}" d="M${-er * 1.1},${er * .2} Q0,${-er * .45} ${er * 1.1},${er * .2}"
            stroke="#2e2320" stroke-width="${er * .32}" fill="none" stroke-linecap="round" opacity=".75"/>
    </g>` : '';
  const overlay = lids ? `
      <svg class="overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${lids ? lid(c.eyeL) + lid(c.eyeR) : ''}
        ${brow(c.eyeL, 'brow-l')}${brow(c.eyeR, 'brow-r')}
      </svg>` : '';
  return `<div class="photo-layer ${cls}" data-emo="${emo}">
      <img class="photo" src="${escAttr(url)}" alt="" referrerpolicy="no-referrer" draggable="false">${overlay}
    </div>`;
}

/**
 * images: { neutral, joy, sad, surprised, blink, talk }（URL。ないものは空）
 * 4表情はフェードで切り替え、瞬き・しゃべりは普通の顔の上に瞬時に重ねる
 */
function photoAvatarHTML(images, cfg) {
  const main = PHOTO_EMOS
    .filter(e => images && images[e])
    .map(e => photoLayerHTML(images[e], slotConfigOf(cfg, e), e))
    .join('');
  const n = slotConfigOf(cfg, 'neutral');
  const talk = images && images.talk
    ? photoLayerHTML(images.talk, slotConfigOf(cfg, 'talk'), 'talk', { cls: 'sub' }) : '';
  const blink = images && images.blink
    ? photoLayerHTML(images.blink, n, 'blink', { lids: false, cls: 'sub' }) : '';
  return `<div class="avatar-inner photo-wrap" role="img" aria-label="話し相手の写真">${main}${talk}${blink}</div>`;
}

function userImages(u) {
  const o = Object.assign({}, u.avatarImages || {});
  if (!o.neutral && u.avatarImageUrl) o.neutral = u.avatarImageUrl;
  return o;
}

// =========================================================
// アバター制御
// =========================================================

class AvatarView {
  constructor(el, stageEl, badgeEl) {
    this.el = el;
    this.stage = stageEl;
    this.badge = badgeEl;
    this.emotion = 'neutral';
    this._blinkT = null;
    this._flapT = null;
    this._revertT = null;
  }

  render({ preset, images, config }) {
    const isPhoto = preset === 'custom';
    this.el.classList.toggle('photo-mode', isPhoto);
    this._hasTalk = !!(isPhoto && images && images.neutral && images.talk);
    this._hasBlink = !!(isPhoto && images && images.neutral && images.blink);
    this.el.classList.toggle('has-talk', this._hasTalk);
    this.el.classList.toggle('has-blink', this._hasBlink);
    this.el.classList.remove('talk-open');
    if (isPhoto) {
      this.el.innerHTML = images && images.neutral ? photoAvatarHTML(images, config) : '';
      $$('img.photo', this.el).forEach(img => {
        img.addEventListener('error', () => {
          const m = String(img.getAttribute('src')).match(/\/d\/([\w-]+)/);
          if (m && !img.dataset.fb) {
            img.dataset.fb = '1';
            img.src = `https://drive.google.com/thumbnail?id=${m[1]}&sz=w800`;
          }
        });
      });
    } else {
      this.el.innerHTML = `<div class="avatar-inner">${presetSVG(PRESETS[preset] ? preset : 'dog')}</div>`;
    }
    this.setEmotion(this.emotion, true);
    this.startBlink();
  }

  /** 写真モード：その表情の写真があれば切り替え、なければ普通の顔で代用 */
  updatePhotoLayer(e) {
    const layers = $$('.photo-layer.main', this.el);
    if (!layers.length) return;
    const target = layers.some(l => l.dataset.emo === e) ? e : 'neutral';
    layers.forEach(l => {
      const on = l.dataset.emo === target;
      l.classList.toggle('show', on);
      l.classList.toggle('fallback', on && target !== e);
    });
    // 普通の顔（代用を含む）を表示中だけ、瞬き・しゃべり写真を使う
    this.el.classList.toggle('base-neutral', target === 'neutral');
    $$('.photo-layer.sub', this.el).forEach(l => l.classList.toggle('fallback', target !== e));
  }

  setEmotion(e, silent = false) {
    if (!EMOTIONS.includes(e)) e = 'neutral';
    clearTimeout(this._revertT);
    this.el.classList.remove('emo-joy', 'emo-neutral', 'emo-sad', 'emo-surprised');
    void this.el.offsetWidth;
    this.el.classList.add('emo-' + e);
    this.emotion = e;
    this.updatePhotoLayer(e);
    if (this.stage) this.stage.dataset.emo = e;
    const marks = { joy: '✨', sad: '💧', surprised: '❗' };
    if (this.badge && !silent && marks[e]) {
      this.badge.textContent = marks[e];
      this.badge.classList.remove('pop');
      void this.badge.offsetWidth;
      this.badge.classList.add('pop');
    }
  }

  revertLater(ms = 12000) {
    clearTimeout(this._revertT);
    this._revertT = setTimeout(() => this.setEmotion('neutral', true), ms);
  }

  startBlink() {
    clearTimeout(this._blinkT);
    const loop = () => {
      this._blinkT = setTimeout(async () => {
        await this.blink();
        if (Math.random() < 0.2) { await sleep(170); await this.blink(); }
        loop();
      }, 2200 + Math.random() * 3800);
    };
    loop();
  }

  async blink() {
    this.el.classList.add('blink');
    await sleep(130);
    this.el.classList.remove('blink');
  }

  stop() {
    clearTimeout(this._blinkT);
    clearTimeout(this._revertT);
    this.stopTalking();
  }

  setMouth(v) {
    this.el.style.setProperty('--mouth', Math.max(0.08, Math.min(1, v)).toFixed(2));
    // しゃべり写真があれば、口が大きく開くタイミングで切り替える
    if (this._hasTalk) this.el.classList.toggle('talk-open', v > 0.45 && this.el.classList.contains('talking'));
  }

  startTalking() { this.el.classList.add('talking'); this.setMouth(0.2); }

  stopTalking() {
    clearInterval(this._flapT);
    this._flapT = null;
    this.el.classList.remove('talking');
    this.el.classList.remove('talk-open');
    this.setMouth(0.2);
  }

  /** 音声読み上げ中の口パク */
  startFlap() {
    this.startTalking();
    clearInterval(this._flapT);
    this._flapT = setInterval(() => this.setMouth(0.15 + Math.random() * 0.85), 120);
  }

  /** 1文字ごとの口の開き（母音でおおまかに判定） */
  mouthFor(ch) {
    let v;
    if (/[。、！？!?,.…\s　ー〜「」『』（）()]/.test(ch)) v = 0.1;
    else if (/[あかさたなはまやらわがざだばぱぁゃアカサタナハマヤラワガザダバパァャ]/.test(ch)) v = 1;
    else if (/[おこそとのほもよろごぞどぼぽぉょオコソトノホモヨロゴゾドボポォョ]/.test(ch)) v = 0.8;
    else if (/[えけせてねへめれげぜでべぺぇエケセテネヘメレゲゼデベペェ]/.test(ch)) v = 0.6;
    else if (/[いきしちにひみりぎじぢびぴぃイキシチニヒミリギジヂビピィうくすつぬふむゆるぐずづぶぷぅゅウクスツヌフムユルグズヅブプゥュんンっッ]/.test(ch)) v = 0.35;
    else v = 0.35 + Math.random() * 0.6;
    this.setMouth(v);
  }
}

const mainAvatar = new AvatarView($('#avatar'), $('#stage'), $('#emoBadge'));
const previewAvatar = new AvatarView($('#previewAvatar'), $('#previewStage'), null);

// =========================================================
// API
// =========================================================

function gasUrlMissing() { return !GAS_URL || GAS_URL.includes('XXXX'); }

async function api(action, data = {}) {
  if (gasUrlMissing()) throw new Error('config.js の GAS_URL を設定してください');
  let json;
  try {
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, token: state.token }, data))
    });
    json = await res.json();
  } catch (_) {
    throw new Error('通信できませんでした。電波の良いところでもう一度お試しください');
  }
  if (!json.ok) {
    if (json.code === 'AUTH') forceLogout(json.error);
    if (json.code === 'FIRST_LOGIN') openPwModal(true);
    throw new Error(json.error || 'エラーが発生しました');
  }
  return json;
}

// =========================================================
// UI ヘルパー
// =========================================================

function setMsg(el, text, type = '') {
  el.textContent = text || '';
  el.className = 'form-msg' + (type ? ' ' + type : '');
}

let toastT = null;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2600);
}

async function withBusy(btn, fn, msgEl) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add('busy');
  try {
    return await fn();
  } catch (err) {
    if (msgEl) setMsg(msgEl, err.message, 'error'); else toast(err.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
  }
}

function initPwToggles() {
  $$('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('on', show);
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'パスワードを隠す' : 'パスワードを表示');
    });
  });
}

function resetPwFields(root) {
  $$('.pw-wrap input', root).forEach(i => { i.type = 'password'; i.value = ''; });
  $$('.pw-toggle', root).forEach(b => {
    b.classList.remove('on');
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', 'パスワードを表示');
  });
}

function openModal(id) { $('#' + id).classList.add('open'); Listener.abort(); }
function closeModal(id) { $('#' + id).classList.remove('open'); Listener.schedule(600); }

const isFinePointer = () => window.matchMedia('(pointer: fine)').matches;

function defaultStatus() { return prefs.handsFree ? '話しかけてください' : 'そばにいます'; }

function setStatus(t) {
  $('#statusLabel').textContent = t;
  const pill = $('#stagePill');
  pill.textContent = t;
  pill.classList.toggle('listening', t.startsWith('聞いて'));
}

// =========================================================
// 声（読み上げ）
// =========================================================

const TTS_OK = 'speechSynthesis' in window;
let VOICES = [];
const MALE_HINT = /ichiro|keita|otoya|hattori|daichi|naoki|takumi|kenji|shin|男性|male/i;

function refreshVoices() {
  if (!TTS_OK) return;
  VOICES = speechSynthesis.getVoices();
  if ($('#settingsModal').classList.contains('open') && draft.tab === 'voice') renderVoicePanel();
}

function jaVoices() { return VOICES.filter(v => /^ja/i.test(v.lang)); }

function autoVoice(preset) {
  const ja = jaVoices();
  if (!ja.length) return null;
  const male = preset === 'person_m' || preset === 'anime_b';
  const pool = ja.filter(v => MALE_HINT.test(v.name) === male);
  const list = pool.length ? pool : ja;
  return list.find(v => /natural|online/i.test(v.name)) || list.find(v => /google/i.test(v.name)) || list[0];
}

function defaultPitch(preset, category) {
  if (preset === 'person_m' || preset === 'anime_b') return 0.95;
  if (preset === 'person_f') return 1.1;
  if (preset === 'anime_g') return 1.3;
  if (preset === 'dog' || preset === 'cat') return 1.4;
  if (preset === 'custom') return category === 'pet' ? 1.4 : category === 'anime' ? 1.25 : 1.05;
  return 1.1;
}

function voiceSettingFor(voices, preset) {
  return Object.assign({ voiceURI: '', rate: 1, pitch: null }, voices[preset] || {});
}

function resolveVoice(voices, preset, category) {
  const s = voiceSettingFor(voices, preset);
  const chosen = s.voiceURI ? VOICES.find(v => v.voiceURI === s.voiceURI) : null;
  return {
    voice: chosen || autoVoice(preset),
    rate: Number(s.rate) || 1,
    pitch: s.pitch == null ? defaultPitch(preset, category) : Number(s.pitch)
  };
}

function curPreset() { return state.user ? state.user.avatarPreset : 'dog'; }
function curCategory() { return state.user ? state.user.avatarCategory : 'pet'; }

function cleanForSpeech(t) {
  return String(t).replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, '').trim();
}

let speakToken = 0;
function speak(text, opts) {
  return new Promise(resolve => {
    if (!TTS_OK) return resolve();
    const my = ++speakToken;
    const t = cleanForSpeech(text);
    if (!t) return resolve();
    const o = opts || { voices: prefs.voices, preset: curPreset(), category: curCategory() };
    const r = resolveVoice(o.voices, o.preset, o.category);
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(t);
    if (r.voice) { u.voice = r.voice; u.lang = r.voice.lang; } else { u.lang = 'ja-JP'; }
    u.rate = r.rate;
    u.pitch = r.pitch;
    let finished = false;
    const done = () => { if (!finished) { finished = true; clearTimeout(timer); resolve(); } };
    const timer = setTimeout(done, (t.length * 400) / r.rate + 5000);
    u.onend = done;
    u.onerror = done;
    setTimeout(() => { if (my === speakToken) speechSynthesis.speak(u); else done(); }, 60);
  });
}

function stopSpeaking() {
  speakToken++;
  if (TTS_OK) speechSynthesis.cancel();
}

// =========================================================
// 聞き取り（音声入力・聞き取りモード）
// =========================================================

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

const Listener = {
  rec: null,
  restartT: null,
  errCount: 0,

  canAuto() {
    return prefs.handsFree && state.user && !state.user.isFirstLogin &&
      !state.sending && !state.speaking && !document.hidden &&
      !$('.modal.open') && !$('#mainScreen').classList.contains('hidden');
  },

  /** 聞き取りモードのとき、少し待ってから聞き取りを再開 */
  schedule(ms = 600) {
    clearTimeout(this.restartT);
    if (!SR || !prefs.handsFree) return;
    this.restartT = setTimeout(() => {
      if (this.canAuto() && !this.rec) this.start();
    }, ms);
  },

  start() {
    if (!SR || this.rec) return;
    if (state.speaking) { state.skipTyping = true; stopSpeaking(); }
    clearTimeout(this.restartT);
    const rec = new SR();
    this.rec = rec;
    rec.lang = 'ja-JP';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    const ta = $('#chatText');
    const base = ta.value.trim() ? ta.value.trim() + ' ' : '';
    let finalText = '';
    let heardAny = false;

    rec.onresult = e => {
      let fin = '', inter = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript; else inter += r[0].transcript;
      }
      finalText = fin;
      const shown = (fin + inter).trim();
      if (shown && !heardAny) { heardAny = true; $('#captionBot').textContent = ''; }
      ta.value = base + shown;
      autoGrow();
      showHeard(shown);
      this.errCount = 0;
    };

    rec.onerror = e => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        prefs.handsFree = false;
        savePrefs();
        updateToggles();
        toast('マイクが使えません。ブラウザのマイクの許可を確認してください');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        this.errCount++;
        if (this.errCount >= 4 && prefs.handsFree) {
          prefs.handsFree = false;
          savePrefs();
          updateToggles();
          toast('聞き取りがうまくいかないため、聞き取りモードを止めました');
        }
      }
    };

    rec.onend = () => {
      this.rec = null;
      updateMicUi();
      const heard = finalText.trim();
      if (heard && (prefs.handsFree || prefs.micAutoSend)) {
        sendMessage((base + heard).trim());
        return;
      }
      if (!state.sending && !state.speaking) setStatus(defaultStatus());
      this.schedule(400);
    };

    try {
      rec.start();
    } catch (_) {
      this.rec = null;
      return;
    }
    updateMicUi();
    setStatus('聞いています…');
  },

  stop() {
    clearTimeout(this.restartT);
    if (this.rec) { try { this.rec.stop(); } catch (_) { /* 無視 */ } }
  },

  /** 送信せずに即座に止める */
  abort() {
    clearTimeout(this.restartT);
    if (this.rec) {
      const r = this.rec;
      this.rec = null;
      r.onend = null; r.onresult = null; r.onerror = null;
      try { r.abort(); } catch (_) { /* 無視 */ }
      updateMicUi();
      if (!state.sending && !state.speaking && state.user) setStatus(defaultStatus());
    }
  }
};

function updateMicUi() {
  const on = !!Listener.rec;
  const mic = $('#micBtn');
  mic.classList.toggle('rec', on);
  mic.setAttribute('aria-label', on ? '聞き取りを止める' : '声で入力');
  $('#handsFreeBtn').classList.toggle('listening', on && prefs.handsFree);
}

function showHeard(text) {
  $('#captionYou').textContent = text ? '🗣 ' + text : '';
}

// =========================================================
// 画面切り替え
// =========================================================

function showAuth() {
  $('#bootScreen').classList.add('hidden');
  $('#mainScreen').classList.add('hidden');
  $('#authScreen').classList.remove('hidden');
  mainAvatar.stop();
}

async function showMain() {
  $('#bootScreen').classList.add('hidden');
  $('#authScreen').classList.add('hidden');
  $('#mainScreen').classList.remove('hidden');
  applyUser();
  applyView();
  setStatus(defaultStatus());
  if (state.user.isFirstLogin) {
    $('#chatLog').innerHTML = '';
    openPwModal(true);
  } else {
    await loadHistory();
  }
}

function applyUser() {
  const u = state.user;
  $('#companionNameLabel').textContent = u.companionName;
  document.title = `${u.companionName} — まどべ`;
  mainAvatar.render({ preset: u.avatarPreset, images: userImages(u), config: u.avatarConfig });
}

function forceLogout(message) {
  Listener.abort();
  stopSpeaking();
  state.token = '';
  state.user = null;
  store.del(TOKEN_KEY);
  $('#pwModal').classList.remove('open');
  $('#settingsModal').classList.remove('open');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  showAuth();
  if (message) setMsg($('#authMsg'), message, 'error');
}

// =========================================================
// 全画面・トグル
// =========================================================

function applyView() {
  const app = $('#mainScreen');
  app.classList.toggle('stage-mode', !!prefs.stageMode);
  app.classList.toggle('show-caption', !!prefs.showCaption);
  app.classList.toggle('hide-input', !!prefs.hideInput);
  updateToggles();
}

function setStageMode(on, fromUserAction) {
  prefs.stageMode = on;
  savePrefs();
  applyView();
  if (fromUserAction && prefs.browserFs) {
    const el = document.documentElement;
    if (on && !document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
  scrollChat();
}

function updateToggles() {
  const set = (id, on, label) => {
    const b = $(id);
    b.setAttribute('aria-pressed', String(!!on));
    b.title = label;
    b.setAttribute('aria-label', label);
  };
  set('#ttsBtn', prefs.tts, prefs.tts ? '声で返事：オン' : '声で返事：オフ');
  set('#handsFreeBtn', prefs.handsFree, prefs.handsFree ? '聞き取りモード：オン' : '聞き取りモード：オフ');
  set('#stageBtn', prefs.stageMode, prefs.stageMode ? '全画面をやめる' : 'キャラクターを全画面にする');
  $('#ttsBtn').classList.toggle('hidden', !TTS_OK);
  $('#handsFreeBtn').classList.toggle('hidden', !SR);
  $('#micBtn').classList.toggle('hidden', !SR);
  updateMicUi();
}

// =========================================================
// 認証
// =========================================================

function switchTab(name) {
  $$('.tab').forEach(t => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  $$('.auth-form').forEach(f => f.classList.toggle('hidden', f.dataset.panel !== name));
  setMsg($('#authMsg'), '');
}

function bindAuth() {
  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.goto === 'forgot') $('#forgotEmail').value = $('#loginEmail').value;
    switchTab(b.dataset.goto);
  }));

  $('#loginForm').addEventListener('submit', e => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim();
    const password = $('#loginPassword').value;
    if (!email || !password) return setMsg($('#authMsg'), 'メールアドレスとパスワードを入力してください', 'error');
    withBusy(e.submitter || $('#loginForm button[type=submit]'), async () => {
      setMsg($('#authMsg'), '');
      const r = await api('login', { email, password });
      state.token = r.token;
      state.user = r.user;
      store.set(TOKEN_KEY, r.token);
      resetPwFields($('#loginForm'));
      await showMain();
    }, $('#authMsg'));
  });

  $('#registerForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#regName').value.trim();
    const email = $('#regEmail').value.trim();
    if (!name || !email) return setMsg($('#authMsg'), 'お名前とメールアドレスを入力してください', 'error');
    withBusy(e.submitter || $('#registerForm button[type=submit]'), async () => {
      const r = await api('register', { name, email });
      $('#loginEmail').value = email;
      $('#regName').value = '';
      $('#regEmail').value = '';
      switchTab('login');
      setMsg($('#authMsg'), r.message, 'ok');
    }, $('#authMsg'));
  });

  $('#forgotForm').addEventListener('submit', e => {
    e.preventDefault();
    const email = $('#forgotEmail').value.trim();
    if (!email) return setMsg($('#authMsg'), 'メールアドレスを入力してください', 'error');
    withBusy(e.submitter || $('#forgotForm button[type=submit]'), async () => {
      const r = await api('forgotPassword', { email });
      $('#loginEmail').value = email;
      switchTab('login');
      setMsg($('#authMsg'), r.message, 'ok');
    }, $('#authMsg'));
  });
}

// ---- パスワード設定モーダル ----

function openPwModal(forced) {
  state.forcedPw = !!forced;
  resetPwFields($('#pwModal'));
  setMsg($('#pwMsg'), '');
  $('#pwTitle').textContent = forced ? '新しいパスワードを設定' : 'パスワードを変更';
  $('#pwLead').classList.toggle('hidden', !forced);
  $('#pwCurrentField').classList.toggle('hidden', forced);
  $('#pwCancel').classList.toggle('hidden', forced);
  openModal('pwModal');
  setTimeout(() => (forced ? $('#pwNew') : $('#pwCurrent')).focus(), 50);
}

function bindPwModal() {
  $('#pwCancel').addEventListener('click', () => { if (!state.forcedPw) closeModal('pwModal'); });

  $('#pwForm').addEventListener('submit', e => {
    e.preventDefault();
    const cur = $('#pwCurrent').value;
    const pw = $('#pwNew').value;
    const pw2 = $('#pwNew2').value;
    const msg = $('#pwMsg');
    if (!state.forcedPw && !cur) return setMsg(msg, '今のパスワードを入力してください', 'error');
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
      return setMsg(msg, '8文字以上で、英字と数字を両方入れてください', 'error');
    }
    if (pw !== pw2) return setMsg(msg, '確認用のパスワードが一致しません', 'error');

    withBusy($('#pwSubmit'), async () => {
      const r = await api('changePassword', { currentPassword: cur, newPassword: pw });
      const wasForced = state.forcedPw;
      state.user = r.user;
      state.forcedPw = false;
      closeModal('pwModal');
      resetPwFields($('#pwModal'));
      toast('パスワードを保存しました');
      if (wasForced) await loadHistory();
    }, msg);
  });

  $('#pwModal').addEventListener('click', e => {
    if (e.target.id === 'pwModal' && !state.forcedPw) closeModal('pwModal');
  });
}

// =========================================================
// 会話
// =========================================================

function scrollChat() {
  const log = $('#chatLog');
  log.scrollTop = log.scrollHeight;
}

function addMessage(role, text) {
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  $('#chatLog').appendChild(wrap);
  scrollChat();
  return bubble;
}

function addTyping() {
  const wrap = document.createElement('div');
  wrap.className = 'msg model typing';
  wrap.innerHTML = '<div class="bubble" aria-label="考えています"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>';
  $('#chatLog').appendChild(wrap);
  scrollChat();
  return wrap;
}

async function typewriter(targets, text, lips, rate = 1) {
  if (lips) mainAvatar.startTalking();
  const base = prefs.tts && TTS_OK ? 150 / rate : 55;
  for (const ch of [...text]) {
    if (state.skipTyping) { targets.forEach(t => { t.textContent = text; }); break; }
    targets.forEach(t => { t.textContent += ch; });
    if (lips) mainAvatar.mouthFor(ch);
    scrollChat();
    await sleep(/[。！？!?\n]/.test(ch) ? base * 3 : /[、,…]/.test(ch) ? base * 2 : base);
  }
  if (lips) mainAvatar.stopTalking();
  scrollChat();
}

async function presentReply(text, emotion) {
  state.skipTyping = false;
  state.speaking = true;
  mainAvatar.setEmotion(emotion);
  const bubble = addMessage('model', '');
  const cap = $('#captionBot');
  cap.textContent = '';
  setStatus('話しています');
  try {
    if (prefs.tts && TTS_OK) {
      const { rate } = resolveVoice(prefs.voices, curPreset(), curCategory());
      const spoken = speak(text);
      mainAvatar.startFlap();
      await typewriter([bubble, cap], text, false, rate);
      await spoken;
    } else {
      await typewriter([bubble, cap], text, true);
    }
  } finally {
    mainAvatar.stopTalking();
    state.speaking = false;
    state.skipTyping = false;
    mainAvatar.revertLater();
    if (!state.sending) setStatus(defaultStatus());
    Listener.schedule(500);
  }
}

async function sendMessage(textArg) {
  const ta = $('#chatText');
  const text = String(textArg != null ? textArg : ta.value).trim();
  if (!text || state.sending) return;
  Listener.abort();
  stopSpeaking();
  mainAvatar.stopTalking();

  state.sending = true;
  $('#sendBtn').disabled = true;
  ta.value = '';
  autoGrow();
  addMessage('user', text);
  showHeard(text);
  $('#captionBot').textContent = '';
  const typing = addTyping();
  setStatus('考えています…');

  try {
    const r = await api('chat', { message: text });
    typing.remove();
    await presentReply(r.reply, r.emotion);
  } catch (err) {
    typing.remove();
    addMessage('system', err.message);
    $('#captionBot').textContent = err.message;
  } finally {
    state.sending = false;
    $('#sendBtn').disabled = false;
    setStatus(defaultStatus());
    if (isFinePointer() && !prefs.handsFree && !prefs.hideInput) ta.focus();
    Listener.schedule(500);
  }
}

function greet() {
  const u = state.user;
  const h = new Date().getHours();
  const hello = h < 5 ? 'こんばんは' : h < 11 ? 'おはよう' : h < 18 ? 'こんにちは' : 'こんばんは';
  return presentReply(`${u.name}さん、${hello}！ ${u.companionName}です。今日はどんな一日でしたか？`, 'joy');
}

async function loadHistory() {
  const log = $('#chatLog');
  log.innerHTML = '';
  const typing = addTyping();
  try {
    const r = await api('getHistory');
    typing.remove();
    if (r.history.length) {
      r.history.forEach(h => addMessage(h.role === 'model' ? 'model' : 'user', h.text));
      const last = [...r.history].reverse().find(h => h.role === 'model');
      mainAvatar.setEmotion(last ? last.emotion : 'neutral', true);
      $('#captionBot').textContent = last ? last.text : '';
      Listener.schedule(800);
    } else {
      greet();
    }
  } catch (err) {
    typing.remove();
    addMessage('system', err.message);
  }
}

function autoGrow() {
  const ta = $('#chatText');
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
}

function bindChat() {
  $('#chatForm').addEventListener('submit', e => { e.preventDefault(); sendMessage(); });
  const ta = $('#chatText');
  ta.addEventListener('input', autoGrow);
  ta.addEventListener('focus', () => Listener.abort()); // 文字入力中は聞き取りを止める
  ta.addEventListener('blur', () => Listener.schedule(1500));
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && isFinePointer()) {
      e.preventDefault();
      sendMessage();
    }
  });

  $('#micBtn').addEventListener('click', () => {
    if (Listener.rec) Listener.stop(); else Listener.start();
  });

  // 話している途中でキャラクターをタップすると止まる
  $('#stage').addEventListener('click', () => {
    if (state.speaking) {
      state.skipTyping = true;
      stopSpeaking();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Listener.abort(); else Listener.schedule(800);
  });
}

// =========================================================
// ヘッダー・メニュー
// =========================================================

function bindHeader() {
  $('#ttsBtn').addEventListener('click', () => {
    prefs.tts = !prefs.tts;
    savePrefs();
    if (!prefs.tts) stopSpeaking();
    updateToggles();
    toast(prefs.tts ? '声でお返事します' : '文字だけでお返事します');
  });

  $('#handsFreeBtn').addEventListener('click', () => {
    prefs.handsFree = !prefs.handsFree;
    savePrefs();
    updateToggles();
    if (prefs.handsFree) {
      toast('マイクを押さずに話しかけられます');
      Listener.schedule(150);
    } else {
      Listener.abort();
      toast('聞き取りを止めました');
    }
    if (!state.sending && !state.speaking && !Listener.rec) setStatus(defaultStatus());
  });

  $('#stageBtn').addEventListener('click', () => setStageMode(!prefs.stageMode, true));

  const menu = $('#menu');
  const menuBtn = $('#menuBtn');
  const closeMenu = () => { menu.classList.add('hidden'); menuBtn.setAttribute('aria-expanded', 'false'); };
  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = menu.classList.toggle('hidden') === false;
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) closeMenu(); });

  $('#menuPassword').addEventListener('click', () => { closeMenu(); openPwModal(false); });

  $('#menuClear').addEventListener('click', async () => {
    closeMenu();
    if (!confirm('これまでの会話の記録をすべて消します。よろしいですか？')) return;
    try {
      const r = await api('clearHistory');
      toast(r.message);
      $('#chatLog').innerHTML = '';
      $('#captionBot').textContent = '';
      showHeard('');
      greet();
    } catch (err) { toast(err.message); }
  });

  $('#menuLogout').addEventListener('click', () => {
    closeMenu();
    api('logout').catch(() => {});
    forceLogout('');
    setMsg($('#authMsg'), 'ログアウトしました', 'ok');
  });

  $('#settingsBtn').addEventListener('click', () => openSettings('char'));

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closeMenu();
    if ($('#settingsModal').classList.contains('open')) closeSettings();
    else if ($('#pwModal').classList.contains('open') && !state.forcedPw) closeModal('pwModal');
  });
}

// =========================================================
// 設定（キャラクター／声／表示と会話）
// =========================================================

const draft = {};
const VIEW_KEYS = ['tts', 'handsFree', 'micAutoSend', 'stageMode', 'showCaption', 'hideInput', 'browserFs'];
const VIEW_IDS = {
  tts: '#optTts', handsFree: '#optHandsFree', micAutoSend: '#optAutoSend',
  stageMode: '#optStage', showCaption: '#optCaption', hideInput: '#optHideInput', browserFs: '#optBrowserFs'
};

function openSettings(tab = 'char') {
  const u = state.user;
  stopSpeaking();
  const imgs = userImages(u);
  const photos = {};
  PHOTO_SLOTS.forEach(e => { photos[e] = { src: imgs[e] || '', data: null, ctx: null, removed: false }; });
  Object.assign(draft, {
    tab,
    companionName: u.companionName,
    category: u.avatarCategory || 'pet',
    preset: u.avatarPreset || 'dog',
    photos,
    slot: 'neutral',
    steps: (() => {
      const done = CALIB_KEYS.length;
      const o = {};
      PHOTO_SLOTS.forEach(e => { o[e] = done; });
      if (!imgs.neutral) o.neutral = 0;
      return o;
    })(),
    config: normalizeConfig(u.avatarConfig),
    voices: JSON.parse(JSON.stringify(prefs.voices || {})),
    view: VIEW_KEYS.reduce((o, k) => (o[k] = prefs[k], o), {})
  });
  $('#companionName').value = draft.companionName;
  setMsg($('#settingsMsg'), '');
  renderCategory();
  renderPresetGrid();
  renderPhotoSection();
  renderViewPanel();
  switchSettingsTab(tab);
  openModal('settingsModal');
  renderPreview();
}

function closeSettings() {
  stopSpeaking();
  previewAvatar.stop();
  closeModal('settingsModal');
}

function switchSettingsTab(tab) {
  draft.tab = tab;
  $$('.stab').forEach(b => {
    const on = b.dataset.stab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  $$('[data-spanel]').forEach(p => p.classList.toggle('hidden', p.dataset.spanel !== tab));
  if (tab === 'voice') renderVoicePanel();
}

function renderCategory() {
  $$('#categorySeg button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.cat === draft.category)));
}

function renderPresetGrid() {
  const grid = $('#presetGrid');
  grid.innerHTML = '';
  Object.entries(PRESETS).filter(([, p]) => p.category === draft.category).forEach(([key, p]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'preset-tile' + (draft.preset === key ? ' selected' : '');
    b.setAttribute('aria-pressed', String(draft.preset === key));
    b.innerHTML = `<span class="thumb">${presetSVG(key)}</span><span>${p.label}</span>`;
    b.addEventListener('click', () => selectPreset(key));
    grid.appendChild(b);
  });
  const ph = document.createElement('button');
  ph.type = 'button';
  ph.className = 'preset-tile' + (draft.preset === 'custom' ? ' selected' : '');
  ph.setAttribute('aria-pressed', String(draft.preset === 'custom'));
  ph.innerHTML = '<span class="thumb photo-icon" aria-hidden="true">📷</span><span>写真を使う</span>';
  ph.addEventListener('click', () => selectPreset('custom'));
  grid.appendChild(ph);
}

function selectPreset(key) {
  draft.preset = key;
  renderPresetGrid();
  renderPhotoSection();
  renderPreview();
}

function draftImages() {
  const o = {};
  PHOTO_SLOTS.forEach(e => { if (draft.photos[e].src) o[e] = draft.photos[e].src; });
  return o;
}

/** 今選んでいる表情スロットの目・口設定（普通の顔と同じなら null） */
function slotCfg(slot) {
  if (slot === 'neutral') return draft.config;
  return PER_KEYS.includes(slot) ? draft.config.perEmotion[slot] : null;
}

function isSubSlot(slot) { return PHOTO_SUBS.includes(slot); }
function needsEyes(slot) { return EYE_SLOTS.includes(slot); }

function renderPreview() {
  const imgs = draftImages();
  const empty = draft.preset === 'custom' && !imgs.neutral;
  $('#previewEmpty').classList.toggle('hidden', !empty);
  $('#previewAvatar').classList.toggle('hidden', empty);
  if (empty) return;
  previewAvatar.render({ preset: draft.preset, images: imgs, config: draft.config });
  if (draft.preset === 'custom') previewAvatar.setEmotion(isSubSlot(draft.slot) ? 'neutral' : draft.slot, true);
}

function renderSlots() {
  const box = $('#photoSlots');
  box.innerHTML = '';
  PHOTO_SLOTS.forEach(e => {
    const ph = draft.photos[e];
    const cfg = slotCfg(e);
    const needTap = ph.src && (e === 'neutral' || cfg) && draft.steps[e] < CALIB_KEYS.length;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'photo-slot' + (draft.slot === e ? ' selected' : '');
    b.setAttribute('aria-pressed', String(draft.slot === e));
    b.innerHTML = `<span class="slot-thumb">${ph.src ? `<img src="${escAttr(ph.src)}" alt="" referrerpolicy="no-referrer">` : '＋'}</span>
      <span>${EMO_LABELS[e]}</span>${needTap ? '<span class="need">目の位置を登録</span>' : ''}`;
    b.addEventListener('click', () => {
      draft.slot = e;
      renderPhotoSection();
      if (draft.photos.neutral.src) previewAvatar.setEmotion(isSubSlot(e) ? 'neutral' : e, true);
    });
    box.appendChild(b);
  });
}

function renderPhotoSection() {
  const on = draft.preset === 'custom';
  $('#photoSection').classList.toggle('hidden', !on);
  if (!on) return;
  renderSlots();

  const s = draft.slot;
  const ph = draft.photos[s];
  const isN = s === 'neutral';
  const isSub = isSubSlot(s);
  $('#slotTitle').textContent = `${EMO_LABELS[s]}の写真` + (isN ? '（必須）' : '（なくても大丈夫です）');
  $('#slotHint').textContent = isSub
    ? SLOT_HINTS[s] + (s === 'blink' ? '（目の位置の登録はいりません）' : '')
    : '顔が真ん中に写った写真がおすすめです（正方形に切り抜きます）。写真を選んだら、両目の位置をタップして登録します。';
  $('#slotRemove').classList.toggle('hidden', isN || !ph.src);
  $('#calibArea').classList.toggle('hidden', !ph.src || !needsEyes(s));
  if (!ph.src || !needsEyes(s)) return;

  const cfg = slotCfg(s);
  $('#samePosWrap').classList.toggle('hidden', isN);
  $('#samePos').checked = !isN && !cfg;
  const needCalib = isN || !!cfg;
  $('#calibWrap').classList.toggle('hidden', !needCalib);
  $('#browWrap').classList.toggle('hidden', !isN);
  if (needCalib) {
    $('#calibImg').src = ph.src;
    $('#lidColor').value = cfg.lidColor || '#d9a88a';
  }
  $('#browToggle').checked = !!draft.config.brows;
  renderMarkers();
}

function renderMarkers() {
  const cfg = slotCfg(draft.slot);
  const step = draft.steps[draft.slot];
  CALIB_KEYS.forEach((k, i) => {
    const m = $(`.marker[data-k="${k}"]`);
    const visible = !!cfg && i < step;
    m.classList.toggle('show', visible);
    if (visible) {
      m.style.left = cfg[k].x + '%';
      m.style.top = cfg[k].y + '%';
    }
  });
  const t = $('#calibText');
  if (!cfg) { t.textContent = ''; return; }
  if (step < CALIB_KEYS.length) {
    t.textContent = `写真の「${CALIB_LABELS[step]}」の真ん中をタップしてください（${step + 1}/${CALIB_KEYS.length}）`;
    t.classList.remove('done');
  } else {
    t.textContent = `「${EMO_LABELS[draft.slot]}」の目の位置を登録しました。左の「瞬き」で確認できます。`;
    t.classList.add('done');
  }
}

function loadAndCropImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const size = 512;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve({ dataUrl: c.toDataURL('image/jpeg', 0.86), ctx });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('この画像は読み込めませんでした。JPEGかPNGでお試しください')); };
    img.src = url;
  });
}

function sampleColor(ctx, xPct, yPct) {
  const size = 512;
  const cx = Math.round(Math.min(99, Math.max(1, xPct)) / 100 * size);
  const cy = Math.round(Math.min(99, Math.max(1, yPct)) / 100 * size);
  const d = ctx.getImageData(Math.max(0, cx - 4), Math.max(0, cy - 4), 9, 9).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  return [r / n, g / n, b / n];
}

/** 目の少し上（まぶた付近）の色を拾って、まばたき用の色にする */
function autoSampleLid(slot) {
  const ctx = draft.photos[slot].ctx;
  const c = slotCfg(slot);
  if (!ctx || !c) return;
  const d = Math.hypot(c.eyeR.x - c.eyeL.x, c.eyeR.y - c.eyeL.y);
  const off = d * 0.26 * 1.6;
  const a = sampleColor(ctx, c.eyeL.x, c.eyeL.y - off);
  const b = sampleColor(ctx, c.eyeR.x, c.eyeR.y - off);
  c.lidColor = '#' + [0, 1, 2].map(i => Math.round((a[i] + b[i]) / 2).toString(16).padStart(2, '0')).join('');
  $('#lidColor').value = c.lidColor;
}

// ---- 声パネル ----

function renderVoicePanel() {
  const key = draft.preset;
  const s = voiceSettingFor(draft.voices, key);
  const name = $('#companionName').value.trim() || draft.companionName;
  $('#voiceFor').textContent = `「${name}」（${presetLabel(key)}）の声を設定します。キャラクターごとに覚えます。`;

  const sel = $('#voiceSelect');
  sel.innerHTML = '';
  const auto = autoVoice(key);
  const optAuto = document.createElement('option');
  optAuto.value = '';
  optAuto.textContent = 'おまかせ' + (auto ? `（${auto.name}）` : '');
  sel.appendChild(optAuto);
  const ja = jaVoices();
  ja.forEach(v => {
    const o = document.createElement('option');
    o.value = v.voiceURI;
    o.textContent = v.name + (v.localService ? '' : '（オンライン）');
    sel.appendChild(o);
  });
  sel.value = ja.some(v => v.voiceURI === s.voiceURI) ? s.voiceURI : '';
  $('#voiceNote').classList.toggle('hidden', ja.length > 0 || !TTS_OK);

  $('#voiceRate').value = s.rate;
  $('#rateOut').textContent = rateLabel(s.rate);
  const autoPitch = s.pitch == null;
  const p = autoPitch ? defaultPitch(key, draft.category) : Number(s.pitch);
  $('#pitchAuto').checked = autoPitch;
  $('#voicePitch').value = p;
  $('#voicePitch').disabled = autoPitch;
  $('#pitchOut').textContent = p.toFixed(2);
}

function rateLabel(r) {
  r = Number(r);
  const word = r < 0.85 ? 'ゆっくり' : r > 1.15 ? 'はやめ' : 'ふつう';
  return `${word}（${r.toFixed(2)}）`;
}

function setDraftVoice(patch) {
  const k = draft.preset;
  draft.voices[k] = Object.assign(voiceSettingFor(draft.voices, k), patch);
}

// ---- 表示と会話パネル ----

function renderViewPanel() {
  VIEW_KEYS.forEach(k => { $(VIEW_IDS[k]).checked = !!draft.view[k]; });
  const srOff = !SR;
  ['#optHandsFree', '#optAutoSend'].forEach(id => {
    $(id).disabled = srOff;
    $(id).closest('.opt').classList.toggle('disabled', srOff);
  });
  $('#optTts').disabled = !TTS_OK;
  $('#optTts').closest('.opt').classList.toggle('disabled', !TTS_OK);
  $('#srNote').classList.toggle('hidden', !srOff);
}

function bindSettings() {
  $$('.stab').forEach(b => b.addEventListener('click', () => switchSettingsTab(b.dataset.stab)));

  $$('#categorySeg button').forEach(b => b.addEventListener('click', () => {
    draft.category = b.dataset.cat;
    if (draft.preset !== 'custom' && PRESETS[draft.preset].category !== draft.category) {
      draft.preset = Object.keys(PRESETS).find(k => PRESETS[k].category === draft.category);
    }
    renderCategory();
    renderPresetGrid();
    renderPhotoSection();
    renderPreview();
  }));

  $('#photoInput').addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 15 * 1024 * 1024) return setMsg($('#settingsMsg'), '写真が大きすぎます（15MBまで）', 'error');
    const slot = draft.slot;
    try {
      const { dataUrl, ctx } = await loadAndCropImage(f);
      draft.photos[slot] = { src: dataUrl, data: dataUrl, ctx, removed: false };
      if (slot === 'neutral') {
        const pe = draft.config.perEmotion;
        draft.config = Object.assign(defaultConfig(), { brows: draft.config.brows, perEmotion: pe });
        draft.steps.neutral = 0;
      } else if (PER_KEYS.includes(slot)) {
        // 表情ごとに目の位置を登録する（普通の顔の位置を初期値に）
        const n = draft.config;
        draft.config.perEmotion[slot] = { eyeL: { ...n.eyeL }, eyeR: { ...n.eyeR }, mouth: { ...n.mouth }, lidColor: n.lidColor };
        draft.steps[slot] = 0;
      }
      setMsg($('#settingsMsg'), '');
      renderPhotoSection();
      renderPreview();
    } catch (err) {
      setMsg($('#settingsMsg'), err.message, 'error');
    }
  });

  $('#slotRemove').addEventListener('click', () => {
    const slot = draft.slot;
    if (slot === 'neutral') return;
    draft.photos[slot] = { src: '', data: null, ctx: null, removed: true };
    if (PER_KEYS.includes(slot)) draft.config.perEmotion[slot] = null;
    draft.steps[slot] = CALIB_KEYS.length;
    renderPhotoSection();
    renderPreview();
  });

  $('#samePos').addEventListener('change', e => {
    const slot = draft.slot;
    if (!PER_KEYS.includes(slot)) return;
    if (e.target.checked) {
      draft.config.perEmotion[slot] = null;
      draft.steps[slot] = CALIB_KEYS.length;
    } else {
      const n = draft.config;
      draft.config.perEmotion[slot] = {
        eyeL: { ...n.eyeL }, eyeR: { ...n.eyeR }, mouth: { ...n.mouth }, lidColor: n.lidColor
      };
      draft.steps[slot] = 0;
    }
    renderPhotoSection();
    renderPreview();
  });

  $('#calibBox').addEventListener('click', e => {
    const slot = draft.slot;
    const cfg = slotCfg(slot);
    if (!cfg || draft.steps[slot] >= CALIB_KEYS.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10;
    const y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10;
    cfg[CALIB_KEYS[draft.steps[slot]]] = { x, y };
    draft.steps[slot]++;
    if (draft.steps[slot] === CALIB_KEYS.length) {
      autoSampleLid(slot);
      renderSlots();
      renderPreview();
    }
    renderMarkers();
  });

  $('#calibReset').addEventListener('click', () => {
    draft.steps[draft.slot] = 0;
    renderSlots();
    renderMarkers();
  });
  $('#lidColor').addEventListener('input', e => {
    const cfg = slotCfg(draft.slot);
    if (cfg) cfg.lidColor = e.target.value;
    renderPreview();
  });
  $('#browToggle').addEventListener('change', e => { draft.config.brows = e.target.checked; renderPreview(); });

  $$('.emo-test button').forEach(b => b.addEventListener('click', async () => {
    const emo = b.dataset.emo;
    if (emo === 'blink') {
      previewAvatar.el.classList.add('blink');
      await sleep(600);
      previewAvatar.el.classList.remove('blink');
    } else if (emo === 'talk') {
      previewAvatar.startFlap();
      await sleep(1600);
      previewAvatar.stopTalking();
    } else {
      previewAvatar.setEmotion(emo);
    }
  }));

  // 声
  $('#voiceSelect').addEventListener('change', e => setDraftVoice({ voiceURI: e.target.value }));
  $('#voiceRate').addEventListener('input', e => {
    setDraftVoice({ rate: Number(e.target.value) });
    $('#rateOut').textContent = rateLabel(e.target.value);
  });
  $('#voicePitch').addEventListener('input', e => {
    setDraftVoice({ pitch: Number(e.target.value) });
    $('#pitchOut').textContent = Number(e.target.value).toFixed(2);
  });
  $('#pitchAuto').addEventListener('change', e => {
    if (e.target.checked) {
      setDraftVoice({ pitch: null });
    } else {
      setDraftVoice({ pitch: Number($('#voicePitch').value) });
    }
    renderVoicePanel();
  });
  $('#voiceTest').addEventListener('click', async () => {
    if (!TTS_OK) return setMsg($('#settingsMsg'), 'このブラウザは読み上げに対応していません', 'error');
    const name = $('#companionName').value.trim() || draft.companionName;
    previewAvatar.startFlap();
    await speak(`こんにちは、${name}です。今日もいっしょにお話ししようね。`,
      { voices: draft.voices, preset: draft.preset, category: draft.category });
    previewAvatar.stopTalking();
  });

  // 表示と会話
  VIEW_KEYS.forEach(k => $(VIEW_IDS[k]).addEventListener('change', e => { draft.view[k] = e.target.checked; }));

  $('#settingsCancel').addEventListener('click', closeSettings);
  $('#settingsModal').addEventListener('click', e => { if (e.target.id === 'settingsModal') closeSettings(); });

  $('#settingsSave').addEventListener('click', () => {
    const msg = $('#settingsMsg');
    const u = state.user;
    const name = $('#companionName').value.trim();
    if (!name) { switchSettingsTab('char'); return setMsg(msg, '名前を入力してください', 'error'); }

    const photoChanged = PHOTO_SLOTS.some(e => draft.photos[e].data || draft.photos[e].removed);
    const avatarChanged =
      name !== u.companionName || draft.category !== u.avatarCategory || draft.preset !== u.avatarPreset ||
      photoChanged || JSON.stringify(draft.config) !== JSON.stringify(normalizeConfig(u.avatarConfig));

    if (avatarChanged && draft.preset === 'custom') {
      const fail = (slot, text) => {
        switchSettingsTab('char');
        draft.slot = slot;
        renderPhotoSection();
        setMsg(msg, text, 'error');
      };
      if (!draft.photos.neutral.src) return fail('neutral', '「普通の顔」の写真を選んでください');
      const bad = EYE_SLOTS.find(e => draft.photos[e].src && slotCfg(e) && draft.steps[e] < CALIB_KEYS.length);
      if (bad) return fail(bad, `「${EMO_LABELS[bad]}」の両目の位置をタップしてください`);
    }

    withBusy($('#settingsSave'), async () => {
      if (avatarChanged) {
        const payload = {
          companionName: name,
          avatarCategory: draft.category,
          avatarPreset: draft.preset,
          avatarConfig: draft.config
        };
        if (draft.preset === 'custom') {
          const images = {};
          PHOTO_SLOTS.forEach(e => { if (draft.photos[e].data) images[e] = draft.photos[e].data; });
          if (Object.keys(images).length) payload.images = images;
          const removes = PHOTO_SLOTS.filter(e => draft.photos[e].removed);
          if (removes.length) payload.removeImages = removes;
          // 写真のない表情の個別設定は送らない
          PER_KEYS.forEach(e => { if (!draft.photos[e].src) payload.avatarConfig.perEmotion[e] = null; });
        }
        const r = await api('saveAvatar', payload);
        state.user = r.user;
        applyUser();
      }

      const wasStage = prefs.stageMode;
      prefs.voices = draft.voices;
      VIEW_KEYS.forEach(k => { prefs[k] = draft.view[k]; });
      savePrefs();
      if (!prefs.tts) stopSpeaking();
      if (!prefs.handsFree) Listener.abort();

      closeSettings();
      if (prefs.stageMode !== wasStage) setStageMode(prefs.stageMode, true); else applyView();
      setStatus(defaultStatus());

      if (avatarChanged) {
        mainAvatar.setEmotion('joy');
        mainAvatar.revertLater(4000);
        toast(`${state.user.companionName}がそばにいます`);
      } else {
        toast('設定を保存しました');
      }
    }, msg);
  });
}

// =========================================================
// 起動
// =========================================================

async function init() {
  initPwToggles();
  bindAuth();
  bindPwModal();
  bindChat();
  bindHeader();
  bindSettings();

  if (TTS_OK) {
    refreshVoices();
    speechSynthesis.addEventListener('voiceschanged', refreshVoices);
  }

  if (state.token) {
    try {
      const r = await api('me');
      state.user = r.user;
      await showMain();
      return;
    } catch (_) {
      store.del(TOKEN_KEY);
      state.token = '';
    }
  }
  showAuth();
  if (gasUrlMissing()) setMsg($('#authMsg'), 'config.js の GAS_URL を設定してください', 'error');
}

document.addEventListener('DOMContentLoaded', init);
