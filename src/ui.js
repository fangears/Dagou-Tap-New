'use strict';
/* ============================================================
 * Canvas UI：顶部控制条 / 开始遮罩 / 设置面板 / 八度切换带 / Toast
 * 对应网页版的 DOM+CSS 实现，视觉参数逐项照抄。
 * ==========================================================*/
const config = require('./config.js');
const state = require('./state.js');
const utils = require('./utils.js');
const assets = require('./assets.js');
const music = require('./music.js');

const { C } = config;

let g = null;
let gameApi = null;        // game.js 注入的回调 { toggleMusic, toggleSfx, openSettings, closeSettings, toggleSetting, selectSfx, selectSkin, shiftOctave }
let sfxIconImages = {};    // sfxId -> image（设置页小图标，复用闭嘴立绘）
let emperorIconImage = null;

/* 命中区域缓存（每帧渲染时刷新） */
const hit = {
  music: null, sfx: null, settings: null, hint: null,
  close: null, sfxCards: [], skinCards: [], settingRows: [],
  panel: null, panelScrollArea: null,
};

const SMALL = () => state.metrics.width <= 430;

function font(weight, size, serif = false) {
  return `${weight} ${size}px ${serif ? 'serif' : 'sans-serif'}`;
}

/* ---------- 基础绘制 ---------- */
function drawChamferButton(g2, rect, options) {
  const {
    edge = 'rgba(135, 131, 126, .72)',
    fill = 'rgba(255, 242, 220, .92)',
    chamfer = 10,
  } = options;

  g2.save();
  utils.traceChamferRect(g2, rect.x, rect.y, rect.w, rect.h, chamfer);
  g2.fillStyle = edge;
  g2.fill();
  utils.traceChamferRect(g2, rect.x + 2, rect.y + 2, rect.w - 4, rect.h - 4, Math.max(4, chamfer - 2));
  g2.fillStyle = fill;
  g2.fill();
  g2.restore();
}

function drawStrokeIcon(g2, x, y, size, drawPath, color, lineWidth = 2) {
  g2.save();
  g2.translate(x, y);
  g2.scale(size / 24, size / 24);
  g2.strokeStyle = color;
  g2.lineWidth = lineWidth * (24 / size);
  g2.lineCap = 'round';
  g2.lineJoin = 'round';
  drawPath(g2);
  g2.restore();
}

/* ---------- 精灵缓存：静态 UI 预烘焙为离屏画布，逐帧只做 drawImage 缩放 ---------- */
const spriteCache = new Map();

function getSprite(key, w, h, draw) {
  const dpr = state.dpr;
  const fullKey = `${key}@${Math.ceil(w * dpr)}x${Math.ceil(h * dpr)}d${dpr}`;
  let sprite = spriteCache.get(fullKey);
  if (!sprite) {
    const canvas = assets.createOffscreenCanvas(
      Math.max(1, Math.ceil(w * dpr)),
      Math.max(1, Math.ceil(h * dpr))
    );
    const sg = canvas.getContext('2d');
    try {
      sg.setTransform(dpr, 0, 0, dpr, 0, 0);
    } catch (_) {
      sg.scale(dpr, dpr);
    }
    draw(sg, w, h);
    sprite = { canvas, w, h };
    spriteCache.set(fullKey, sprite);
  }
  return sprite;
}

function drawSpriteCentered(sprite, cx, cy, scale) {
  const w = sprite.w * scale;
  const h = sprite.h * scale;
  g.drawImage(sprite.canvas, cx - w / 2, cy - h / 2, w, h);
}

/* 24×24 视窗的图标路径 */
const ICONS = {
  music(g2) {
    g2.beginPath(); g2.moveTo(9, 18); g2.lineTo(9, 5); g2.lineTo(19, 3); g2.lineTo(19, 16); g2.stroke();
    g2.beginPath(); g2.arc(6, 18, 3, 0, 7); g2.stroke();
    g2.beginPath(); g2.arc(16, 16, 3, 0, 7); g2.stroke();
  },
  speaker(g2) {
    g2.beginPath(); g2.moveTo(5, 9); g2.lineTo(5, 15); g2.lineTo(9, 15); g2.lineTo(14, 19); g2.lineTo(14, 5); g2.lineTo(9, 9); g2.closePath(); g2.stroke();
    g2.beginPath(); g2.moveTo(17, 9.5); g2.arc(17, 12, 4, -Math.PI / 2.6, Math.PI / 2.6); g2.stroke();
  },
  gear(g2) {
    g2.beginPath(); g2.arc(12, 12, 3.4, 0, 7); g2.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      g2.beginPath();
      g2.moveTo(12 + Math.cos(a) * 6.5, 12 + Math.sin(a) * 6.5);
      g2.lineTo(12 + Math.cos(a) * 9.4, 12 + Math.sin(a) * 9.4);
      g2.stroke();
    }
  },
  close(g2) {
    g2.beginPath(); g2.moveTo(6, 6); g2.lineTo(18, 18); g2.moveTo(18, 6); g2.lineTo(6, 18); g2.stroke();
  },
  slash(g2) {
    g2.beginPath(); g2.moveTo(4, 3); g2.lineTo(20, 21); g2.stroke();
  },
};

/* ---------- 顶部控制条 ---------- */
function topInset() {
  return Math.max(SMALL() ? 10 : 14, state.safeTop);
}

function layoutHintBubble() {
  if (state.settingsSeen) return null;
  if (hintLayout && hintLayout.dpr === state.dpr) return hintLayout;
  const bubbleText = ['点击设置', '切换大狗叫音效'];
  g.font = font(750, 12);
  const bubbleW = Math.max(...bubbleText.map((t) => g.measureText(t).width)) + 26;
  const bubbleH = Math.ceil(12 * 1.55 * 2 + 17);
  hintLayout = { dpr: state.dpr, bubbleText, bubbleW, bubbleH };
  return hintLayout;
}

let hintLayout = null;
let hintSprite = null;
let hintSpriteKey = '';

function getHintSprite() {
  const layout = layoutHintBubble();
  if (!layout) return null;
  const key = `${layout.bubbleW}x${layout.bubbleH}@d${state.dpr}`;
  if (hintSprite && hintSpriteKey === key) return hintSprite;
  hintSpriteKey = key;
  hintSprite = getSprite('hint-bubble', layout.bubbleW, layout.bubbleH + 22, (sg, w, h) => {
    // 箭头
    sg.strokeStyle = C.amber;
    sg.lineWidth = 3;
    sg.lineCap = 'round';
    sg.lineJoin = 'round';
    const arrowX = w - 12;
    sg.beginPath();
    sg.moveTo(arrowX, 18);
    sg.lineTo(arrowX, 2);
    sg.lineTo(arrowX - 7, 9);
    sg.moveTo(arrowX, 2);
    sg.lineTo(arrowX + 7, 9);
    sg.stroke();
    // 气泡
    utils.traceChamferRect(sg, 0, 22, layout.bubbleW, layout.bubbleH, 10);
    sg.fillStyle = C.amber;
    sg.fill();
    sg.font = font(750, 12);
    sg.fillStyle = '#fffaf0';
    sg.textAlign = 'center';
    sg.textBaseline = 'middle';
    for (let i = 0; i < layout.bubbleText.length; i++) {
      sg.fillText(layout.bubbleText[i], layout.bubbleW / 2, 22 + 12 + i * (12 * 1.55));
    }
  });
  return hintSprite;
}

function drawControlButton(rect, { icon, label, muted, pulse }) {
  const small = SMALL();
  const key = `btn:${icon}:${small ? 'icon' : label}:${muted ? 'm' : 'n'}`;
  const sprite = getSprite(key, rect.w, rect.h, (sg, w, h) => {
    const edge = muted ? 'rgba(255, 90, 95, .68)' : 'rgba(135, 131, 126, .72)';
    const fill = muted ? 'rgba(255, 255, 255, .94)' : 'rgba(255, 242, 220, .92)';
    drawChamferButton(sg, { x: 0, y: 0, w, h }, { edge, fill });

    const iconColor = muted ? C.coral : C.gray;
    const iconSize = 20;
    sg.font = font(700, 13);
    const textW = small ? 0 : sg.measureText(label).width;
    const x = w / 2 - (iconSize + (small ? 0 : 6 + textW)) / 2;
    const y = h / 2 - iconSize / 2;
    drawStrokeIcon(sg, x, y, iconSize, ICONS[icon], iconColor);
    if (muted) drawStrokeIcon(sg, x, y, iconSize, ICONS.slash, C.coral, 2.6);
    if (!small) {
      sg.fillStyle = iconColor;
      sg.textAlign = 'left';
      sg.textBaseline = 'middle';
      sg.fillText(label, x + iconSize + 6, h / 2 + 1);
    }
  });
  drawSpriteCentered(sprite, rect.x + rect.w / 2, rect.y + rect.h / 2, 1 + pulse * 0.075);
}

function layoutTopControls() {
  const m = state.metrics;
  const inset = topInset();
  const small = SMALL();
  const btnH = 44;
  const btnW = small ? 46 : 68;
  const gap = 8;

  hit.music = { x: inset, y: inset, w: btnW, h: btnH };
  hit.sfx = { x: inset + btnW + gap, y: inset, w: btnW, h: btnH };
  hit.settings = { x: m.width - inset - btnW, y: inset, w: btnW, h: btnH };

  const layout = layoutHintBubble();
  if (!layout) {
    hit.hint = null;
    return;
  }
  hit.hint = {
    x: hit.settings.x + hit.settings.w - layout.bubbleW,
    y: hit.settings.y + hit.settings.h + 9,
    w: layout.bubbleW,
    h: layout.bubbleH + 22,
  };
}

function drawTopControls(beatPosition) {
  const phase = Number.isFinite(beatPosition)
    ? ((beatPosition % 1) + 1) % 1
    : 0;
  const pulse = Number.isFinite(beatPosition) ? Math.pow(1 - phase, 4.5) : 0;
  let musicPulse = 0;
  let sfxPulse = 0;
  if (!state.bgmMuted && !state.sfxMuted) {
    const beatIndex = Math.floor(beatPosition ?? 0);
    if (((beatIndex % 2) + 2) % 2 === 0) musicPulse = pulse;
    else sfxPulse = pulse;
  } else if (!state.bgmMuted) musicPulse = pulse;
  else if (!state.sfxMuted) sfxPulse = pulse;

  const visible = state.controlsVisible;
  const settingsPinned = !state.settingsSeen;

  g.save();
  if (!visible) g.globalAlpha = 0;
  if (visible || settingsPinned) {
    if (visible) {
      drawControlButton(hit.music, { icon: 'music', label: '音乐', muted: state.bgmMuted, pulse: musicPulse });
      drawControlButton(hit.sfx, { icon: 'speaker', label: '音效', muted: state.sfxMuted, pulse: sfxPulse });
    }
    // 设置按钮：有未读红点时常驻
    const pinned = !visible && settingsPinned;
    if (visible || pinned) {
      if (pinned) g.globalAlpha = 1;
      drawControlButton(hit.settings, { icon: 'gear', label: '设置', muted: false, pulse });

      // 未读红点（八边形）：无论顶栏是否隐藏都要完整可见
      const dot = { x: hit.settings.x + hit.settings.w - 5, y: hit.settings.y - 5, w: 15, h: 15 };
      g.save();
      g.globalAlpha = 1;
      g.translate(dot.x + dot.w / 2, dot.y + dot.h / 2);
      g.scale(1 + pulse * 0.4, 1 + pulse * 0.4);
      utils.traceChamferRectPercent(g, -dot.w / 2, -dot.h / 2, dot.w, dot.h, 0.32, 0.68);
      g.fillStyle = 'rgba(255, 250, 240, .96)';
      g.fill();
      utils.traceChamferRectPercent(g, -4.5, -4.5, 9, 9, 0.32, 0.68);
      g.fillStyle = C.coral;
      g.fill();
      g.restore();
    }
  }
  g.restore();

  // 新手引导气泡（精灵化：bob 只改绘制位置）
  const hintSprite = getHintSprite();
  if (hit.hint && hintSprite && (visible || settingsPinned)) {
    const bob = Math.sin((Date.now() / 1000) * (Math.PI * 2 / 1.5)) >= 0 ? -4 : 0;
    g.drawImage(
      hintSprite.canvas,
      hit.hint.x,
      hit.hint.y + bob,
      hintSprite.w,
      hintSprite.h
    );
  }
}

/* ---------- 开始遮罩 ---------- */
function drawOverlay() {
  let alpha = 1;
  if (state.started && state.overlayHideSince) {
    alpha = 1 - utils.clamp01((Date.now() - state.overlayHideSince) / 500);
    if (alpha <= 0) { state.overlayGone = true; return; }
  }
  const m = state.metrics;
  const vmin = Math.min(m.width, m.height) / 100;

  g.save();
  g.globalAlpha = alpha;
  g.fillStyle = 'rgba(255, 242, 220, .9)';
  g.fillRect(0, 0, m.width, m.height);

  const titleSize = Math.max(34, Math.min(72, 8 * vmin));
  g.font = font(900, titleSize);
  g.textBaseline = 'middle';
  const gap = 2.2 * vmin;
  const ls = titleSize * 0.18;
  const fullText = '大狗嚼';
  let total = 0;
  const widths = [...fullText].map((ch) => {
    const w = g.measureText(ch).width;
    total += w + ls;
    return w;
  });
  total -= ls;
  let cursor = m.width / 2 - total / 2;
  g.textAlign = 'left';
  [...fullText].forEach((ch, i) => {
    g.fillStyle = i === fullText.length - 1 ? C.gray : C.amber;
    g.fillText(ch, cursor, m.height / 2 - gap);
    cursor += widths[i] + ls;
  });

  const subSize = Math.max(13, Math.min(18, 2.4 * vmin));
  const pulseT = (Date.now() / 1000) % 1.6;
  const subAlpha = 1 - 0.65 * utils.smooth(utils.clamp01(Math.abs(pulseT / 1.6 - 0.5) * 2));
  g.globalAlpha = alpha * subAlpha;
  g.font = font(400, subSize);
  g.fillStyle = C.gray;
  utils.fillSpacedText(g, '点 击 任 意 位 置 开 始', m.width / 2, m.height / 2 + titleSize * 0.75 + gap, subSize * 0.5, 'center');
  g.restore();
}

/* ---------- 八度切换带 ---------- */
function octaveBands() {
  if (!music.octaveControlsEnabled(state.performanceSettings)) return null;
  const m = state.metrics;
  if (m.width >= m.height) {
    const w = Math.max(30, Math.min(42, m.width * 0.036));
    return {
      landscape: true,
      down: { x: 0, y: 0, w, h: m.height },
      up: { x: m.width - w, y: 0, w, h: m.height },
    };
  }
  // 竖屏上下横带：高度计入刘海/手势条安全区
  const baseH = Math.max(30, Math.min(40, m.height * 0.045));
  return {
    landscape: false,
    up: { x: 0, y: 0, w: m.width, h: baseH + state.safeTop },
    down: { x: 0, y: m.height - baseH - state.safeBottom, w: m.width, h: baseH + state.safeBottom },
  };
}

function drawOctaveBand(rect, direction, currentOctave, contentCY) {
  const target = currentOctave + direction;
  const available = target >= config.PIANO_OCTAVE_MIN && target <= config.PIANO_OCTAVE_MAX;
  const landscape = state.metrics.width >= state.metrics.height;
  const currentLabel = `C${currentOctave}`;
  const targetLabel = available ? `C${target}` : (direction < 0 ? 'MIN' : 'MAX');
  const arrow = landscape ? (direction < 0 ? '←' : '→') : (direction < 0 ? '↓' : '↑');

  g.save();
  if (!available) g.globalAlpha = 0.34;
  g.fillStyle = 'rgba(255, 250, 240, .54)';
  g.fillRect(rect.x, rect.y, rect.w, rect.h);
  g.strokeStyle = 'rgba(135, 131, 126, .16)';
  g.lineWidth = 1;
  g.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

  const cx = rect.x + rect.w / 2;
  const cy = contentCY ?? rect.y + rect.h / 2;
  const vertical = landscape;
  g.font = font(650, 11);
  g.textAlign = 'center';
  g.textBaseline = 'middle';

  const parts = [
    { text: currentLabel, color: 'rgba(111, 106, 99, .72)' },
    { text: arrow, color: 'rgba(255, 180, 0, .62)', font: font(800, 13) },
    { text: targetLabel, color: 'rgba(181, 126, 0, .68)' },
  ];
  let offset = -(vertical ? 34 : 46) / 2;
  for (const part of parts) {
    g.font = part.font ?? font(650, 11);
    g.fillStyle = part.color;
    if (vertical) {
      g.fillText(part.text, cx, cy + offset + 6);
      offset += 17;
    } else {
      const w = g.measureText(part.text).width;
      g.fillText(part.text, cx + offset + w / 2, cy);
      offset += w + 6;
    }
  }
  g.restore();
}

function drawOctaveControls() {
  const bands = octaveBands();
  if (!bands) return null;
  const current = music.effectivePianoOctaveStart(state.performanceSettings);
  if (bands.landscape) {
    drawOctaveBand(bands.up, 1, current);
    drawOctaveBand(bands.down, -1, current);
  } else {
    // 竖屏：文字避开安全区，居中在可视部分
    const upSafeH = bands.up.h - state.safeTop;
    drawOctaveBand(bands.up, 1, current, state.safeTop + upSafeH / 2);
    drawOctaveBand(bands.down, -1, current, bands.down.y + (bands.down.h - state.safeBottom) / 2);
  }
  return bands;
}

/* ============================================================
 * 设置面板
 * ==========================================================*/
const SETTING_ROWS = [
  { key: 'pianoMode', name: '钢琴模式', desc: '开放一个八度的音阶' },
  { key: 'octaveSwitching', name: '八度切换', desc: '在屏幕边缘切换 C3–C6 起始八度', requiresPiano: true },
  { key: 'rhythmSnap', name: '强化节奏', desc: '启用节奏吸附' },
  { key: 'showGrid', name: '显示网格', desc: '显示按键的网格' },
];

function panelMetrics() {
  const m = state.metrics;
  const pad = SMALL() ? 14 : 22;
  const width = Math.min(384, m.width - pad * 2);
  const innerPadX = SMALL() ? 13 : 16;
  const maxContentH = Math.min(740, m.height - 44);
  return { pad, width, innerPadX, maxContentH };
}

function layoutSettings() {
  const { width, innerPadX } = panelMetrics();
  const contentW = width - innerPadX * 2;
  const items = [];
  let y = 14;

  // 头部
  items.push({ type: 'head', y, h: 36 });
  y += 36 + 10;

  // 作者
  items.push({ type: 'label', y, h: 18, text: '作者 · CREATOR' });
  y += 18;
  items.push({ type: 'author', y, h: 50, w: contentW });
  y += 50 + 10;

  // 音效
  items.push({ type: 'label', y, h: 18, text: '音效 · SOUND' });
  y += 18;
  const cols = contentW < 330 ? 2 : 4;
  const cardH = 78;
  const cardW = (contentW - (cols - 1) * 10) / cols;
  const sfxIds = ['dagou', 'dingdong', 'hajimi', 'villager'];
  const sfxCards = sfxIds.map((sfxId, i) => {
    const col = i % cols;
    const row = (i / cols) | 0;
    return {
      type: 'sfxCard', y: y + row * (cardH + 10), h: cardH,
      x: innerPadX + col * (cardW + 10), w: cardW, sfxId,
    };
  });
  const sfxRows = Math.ceil(sfxIds.length / cols);
  for (const card of sfxCards) items.push(card);
  y += sfxRows * (cardH + 10) - 10;

  // 哈基米皮肤切换（选中哈基米时展开）
  if (state.selectedSfxId === 'hajimi') {
    y += 10;
    items.push({ type: 'label', y, h: 18, text: '哈基米形象 · SKIN' });
    y += 18;
    const skinCardH = 48;
    const skinCardW = (contentW - 10) / 2;
    items.push({
      type: 'skinCard', y, h: skinCardH, x: innerPadX, w: skinCardW,
      skin: 'classic', name: '原皮', hint: '默认形象',
    });
    items.push({
      type: 'skinCard', y, h: skinCardH, x: innerPadX + skinCardW + 10, w: skinCardW,
      skin: 'emperor', name: '帝皇', hint: '已解锁',
    });
    y += skinCardH;
  }

  // 免责声明
  y += 8;
  const noteLines = ['非官方 Minecraft 内容，', '未获 Mojang 或 Microsoft 认可或关联。'];
  items.push({ type: 'note', y, h: 7 + noteLines.length * 13.5 + 7, lines: noteLines });
  y += 7 + noteLines.length * 13.5 + 7 + 10;

  // 演奏
  items.push({ type: 'label', y, h: 18, text: '演奏 · PERFORMANCE' });
  y += 18;
  hit.settingRows = [];
  for (const row of SETTING_ROWS) {
    if (row.requiresPiano && !state.performanceSettings.pianoMode) continue;
    items.push({ type: 'settingRow', y, h: 50, x: innerPadX, w: contentW, row });
    y += 50 + 6;
  }
  items.push({ type: 'status', y, h: 20 });
  y += 20;
  const contentH = y + 16;

  const { maxContentH } = panelMetrics();
  const panelH = Math.min(contentH, maxContentH);
  const m = state.metrics;
  const panel = {
    x: (m.width - width) / 2,
    y: (m.height - panelH) / 2,
    w: width,
    h: panelH,
    contentH,
    innerPadX,
    items,
  };
  hit.panel = panel;
  hit.panelScrollArea = panel;

  // 命中区域（随滚动偏移；x 转为屏幕绝对坐标）
  hit.close = { x: panel.x + width - innerPadX - 40, y: panel.y + 14, w: 40, h: 36 };
  hit.sfxCards = items.filter((i) => i.type === 'sfxCard')
    .map((i) => ({ ...i, screenX: panel.x + i.x, screenY: panel.y + i.y - state.settingsScroll }));
  hit.skinCards = items.filter((i) => i.type === 'skinCard')
    .map((i) => ({ ...i, screenX: panel.x + i.x, screenY: panel.y + i.y - state.settingsScroll }));
  hit.settingRows = items.filter((i) => i.type === 'settingRow')
    .map((i) => ({ ...i, screenX: panel.x + i.x, screenY: panel.y + i.y - state.settingsScroll }));
  return panel;
}

/* ============================================================
 * 设置面板离屏缓存：文本密集的内容层预渲染成一张离屏画布，
 * 仅在 panelVersion 变化（切换音效/皮肤/开关/打开面板）时重绘；
 * 逐帧只做一次 drawImage 源偏移（滚动 = 位块搬移），不再逐帧排版文本。
 * ==========================================================*/
let panelCacheCanvas = null;
let panelCacheVersion = -1;
let panelCacheW = 0;
let panelCacheH = 0;

function drawSettingSwitch(g2, x, y, checked) {
  const w = 46, h = 26;
  g2.save();
  g2.translate(x, y);
  utils.traceChamferRect(g2, 0, 0, w, h, 9);
  g2.fillStyle = checked ? C.amber : 'rgba(135, 131, 126, .38)';
  g2.fill();
  const knobX = checked ? 4 + 20 : 4;
  utils.traceChamferRect(g2, knobX, 4, 18, 18, 6);
  g2.fillStyle = '#fffaf0';
  g2.fill();
  utils.traceChamferRectPercent(g2, knobX + 6, 10, 6, 6, 0.32, 0.68);
  g2.fillStyle = checked ? 'rgba(255, 180, 0, .9)' : 'rgba(135, 131, 126, .5)';
  g2.fill();
  g2.restore();
}

function drawChamferedImage(g2, image, x, y, size, chamfer) {
  g2.save();
  utils.traceChamferRect(g2, x, y, size, size, chamfer);
  g2.clip();
  const ratio = Math.max(size / image.width, size / image.height);
  const w = image.width * ratio;
  const h = image.height * ratio;
  g2.drawImage(image, x + (size - w) / 2, y + (size - h) / 2, w, h);
  g2.restore();
}

/* 面板内容绘制（相对面板左上角的坐标，含面板底色与关闭按钮） */
function renderPanelContent(sg, panel) {
  const { innerPadX } = panelMetrics();
  const contentX = innerPadX;
  const contentW = panel.w - innerPadX * 2;
  const closeRect = { x: panel.w - innerPadX - 40, y: 14, w: 40, h: 36 };

  // 面板外框（描边色）+ 内底
  utils.traceChamferRect(sg, 0, 0, panel.w, panel.contentH, 18);
  sg.fillStyle = 'rgba(135, 131, 126, .5)';
  sg.fill();
  utils.traceChamferRect(sg, 2, 2, panel.w - 4, panel.contentH - 4, 16);
  sg.fillStyle = 'rgba(255, 250, 240, .97)';
  sg.fill();

  sg.textBaseline = 'middle';
  for (const item of panel.items) {
    const y = item.y;
    // 卡片类元素带相对 item.x，其余直接使用内容左边距
    const ax = item.x !== undefined ? item.x : contentX;
    switch (item.type) {
      case 'head': {
        sg.font = font(900, 19);
        sg.fillStyle = C.amber;
        sg.textAlign = 'left';
        utils.fillSpacedText(sg, '设置', contentX, y + 18, 19 * 0.3, 'left');
        drawChamferButton(sg, closeRect, { chamfer: 10 });
        drawStrokeIcon(sg, closeRect.x + closeRect.w / 2 - 10, closeRect.y + closeRect.h / 2 - 10, 20, ICONS.close, C.gray);
        break;
      }
      case 'label': {
        sg.font = font(600, 10);
        sg.fillStyle = 'rgba(135, 131, 126, .78)';
        sg.textAlign = 'left';
        utils.fillSpacedText(sg, item.text, contentX, y + 9, 10 * 0.24, 'left');
        break;
      }
      case 'author': {
        const avatarSize = 50;
        sg.save();
        utils.traceChamferRect(sg, contentX, y, avatarSize, avatarSize, 14);
        sg.fillStyle = 'rgba(255, 180, 0, .65)';
        sg.fill();
        sg.restore();
        const avatarImg = sfxIconImages.hajimi;
        if (avatarImg) drawChamferedImage(sg, avatarImg, contentX + 2, y + 2, avatarSize - 4, 12);
        sg.font = font(700, 17, true);
        sg.fillStyle = C.amber;
        sg.textAlign = 'left';
        sg.fillText('马克杯MarkCup', contentX + avatarSize + 12, y + 21);
        sg.font = font(600, 10);
        sg.fillStyle = 'rgba(135, 131, 126, .78)';
        utils.fillSpacedText(sg, '原作 · BILIBILI 创作者', contentX + avatarSize + 12, y + 39, 10 * 0.18, 'left');
        break;
      }
      case 'sfxCard': {
        const sfxId = item.sfxId;
        const active = state.selectedSfxId === sfxId;
        const img = sfxIconImages[sfxId];
        const cx = ax + item.w / 2;
        drawChamferButton(
          sg,
          { x: ax, y, w: item.w, h: item.h },
          {
            edge: active ? 'rgba(255, 180, 0, .92)' : 'rgba(135, 131, 126, .45)',
            fill: active ? 'rgba(255, 244, 224, .96)' : 'rgba(255, 255, 255, .6)',
            chamfer: 12,
          }
        );
        if (img) sg.drawImage(img, cx - 21, y + 10, 42, 42);
        sg.font = font(600, 12);
        sg.fillStyle = active ? '#d88f00' : C.gray;
        sg.textAlign = 'center';
        sg.fillText(config.SFX_LABELS[sfxId], cx, y + 62);
        // NEW 角标
        if (config.NEW_ITEM_IDS.has(sfxId) && !state.newSeen[sfxId]) {
          sg.font = font(900, 8);
          const label = 'NEW';
          const badgeW = sg.measureText(label).width + 10;
          utils.traceChamferRectPercent(sg, ax + item.w - badgeW - 6, y + 6, badgeW, 13, 0.5, 0.5);
          sg.fillStyle = C.coral;
          sg.fill();
          sg.fillStyle = '#fffaf0';
          sg.textAlign = 'center';
          sg.fillText(label, ax + item.w - badgeW / 2 - 6, y + 13);
        }
        break;
      }
      case 'skinCard': {
        const active = item.skin === 'emperor' ? state.hajimiAnimationEnabled : !state.hajimiAnimationEnabled;
        drawChamferButton(
          sg,
          { x: ax, y, w: item.w, h: item.h },
          {
            edge: active ? 'rgba(255, 180, 0, .92)' : 'rgba(135, 131, 126, .45)',
            fill: active ? 'rgba(255, 244, 224, .96)' : 'rgba(255, 255, 255, .6)',
            chamfer: 10,
          }
        );
        const img = item.skin === 'emperor' ? emperorIconImage : sfxIconImages.hajimi;
        if (img) sg.drawImage(img, ax + 10, y + 7, 34, 34);
        sg.font = font(750, 12);
        sg.fillStyle = active ? '#d88f00' : '#6f6a63';
        sg.textAlign = 'left';
        sg.fillText(item.name, ax + 52, y + 18);
        sg.font = font(400, 10);
        sg.fillStyle = 'rgba(135, 131, 126, .82)';
        sg.fillText(item.hint, ax + 52, y + 33);
        break;
      }
      case 'note': {
        sg.fillStyle = 'rgba(135, 131, 126, .07)';
        sg.fillRect(contentX, y, contentW, item.h);
        sg.fillStyle = 'rgba(255, 180, 0, .58)';
        sg.fillRect(contentX, y, 3, item.h);
        sg.font = font(550, 9);
        sg.fillStyle = 'rgba(111, 106, 99, .86)';
        sg.textAlign = 'left';
        for (let i = 0; i < item.lines.length; i++) {
          sg.fillText(item.lines[i], contentX + 12, y + 13 + i * 13.5);
        }
        break;
      }
      case 'settingRow': {
        const checked = state.performanceSettings[item.row.key] === true;
        drawChamferButton(
          sg,
          { x: contentX, y, w: item.w, h: item.h },
          {
            edge: checked ? 'rgba(255, 180, 0, .78)' : 'rgba(135, 131, 126, .42)',
            fill: checked ? 'rgba(255, 244, 224, .96)' : 'rgba(255, 255, 255, .62)',
            chamfer: 12,
          }
        );
        sg.font = font(750, 13);
        sg.fillStyle = checked ? '#b57e00' : '#6f6a63';
        sg.textAlign = 'left';
        sg.fillText(item.row.name, contentX + 12, y + 19);
        sg.font = font(400, 11);
        sg.fillStyle = 'rgba(135, 131, 126, .82)';
        sg.fillText(item.row.desc, contentX + 12, y + 35);
        drawSettingSwitch(sg, contentX + item.w - 12 - 46, y + 12, checked);
        break;
      }
      case 'status': {
        sg.font = font(400, 10);
        sg.fillStyle = 'rgba(135, 131, 126, .78)';
        sg.textAlign = 'left';
        sg.fillText(config.SETTINGS_STATUS_SAVED, contentX + 2, y + 10);
        break;
      }
    }
  }
}

function ensurePanelCache(panel) {
  const dpr = state.dpr;
  const wPx = Math.max(1, Math.ceil(panel.w * dpr));
  const hPx = Math.max(1, Math.ceil(panel.contentH * dpr));
  if (
    panelCacheCanvas &&
    panelCacheVersion === state.panelVersion &&
    panelCacheW === wPx &&
    panelCacheH === hPx
  ) {
    return panelCacheCanvas;
  }
  panelCacheCanvas = assets.createOffscreenCanvas(wPx, hPx);
  const pg = panelCacheCanvas.getContext('2d');
  try {
    pg.setTransform(dpr, 0, 0, dpr, 0, 0);
  } catch (_) {
    pg.scale(dpr, dpr);
  }
  renderPanelContent(pg, panel);
  panelCacheVersion = state.panelVersion;
  panelCacheW = wPx;
  panelCacheH = hPx;
  return panelCacheCanvas;
}

function drawSettings() {
  const panel = layoutSettings();
  const m = state.metrics;
  const panelCanvas = ensurePanelCache(panel);

  // 遮罩
  g.fillStyle = 'rgba(255, 242, 220, .88)';
  g.fillRect(0, 0, m.width, m.height);

  // 进入动画
  const t = utils.clamp01((Date.now() - state.settingsOpenSince) / 320);
  const k = cubicBezierCached(0.2, 0.8, 0.2, 1)(t);
  const cx = panel.x + panel.w / 2;
  const cy = panel.y + panel.h / 2;
  g.save();
  g.translate(cx, cy);
  g.scale(0.97 + 0.03 * k, 0.97 + 0.03 * k);
  g.translate(-cx, -cy + 10 * (1 - k));

  // 面板内容（缓存位图；滚动 = 源矩形偏移）
  g.save();
  utils.traceChamferRect(g, panel.x + 2, panel.y + 2, panel.w - 4, panel.h - 4, 16);
  g.clip();
  const srcY = Math.max(0, Math.round(state.settingsScroll * state.dpr));
  const destHPx = Math.min(panel.h - 4, (panelCacheH - srcY) / state.dpr);
  if (destHPx > 0) {
    g.drawImage(
      panelCacheCanvas,
      0, srcY, panelCacheW, Math.ceil(destHPx * state.dpr),
      panel.x + 2, panel.y + 2, panel.w - 4, destHPx
    );
  }
  g.restore();

  // 滚动条
  const maxScroll = Math.max(0, panel.contentH - panel.h);
  if (maxScroll > 0) {
    const trackH = panel.h - 8;
    const thumbH = Math.max(40, trackH * (panel.h / panel.contentH));
    const thumbY = panel.y + 4 + (trackH - thumbH) * (state.settingsScroll / maxScroll);
    g.fillStyle = 'rgba(255, 180, 0, .45)';
    utils.traceChamferRectPercent(g, panel.x + panel.w - 8, thumbY, 6, thumbH, 0.5, 0.5);
    g.fill();
  }

  g.restore(); // 面板动画
}

let bezierCache = null;
function cubicBezierCached(x1, y1, x2, y2) {
  if (!bezierCache) bezierCache = cubicBezierImpl(x1, y1, x2, y2);
  return bezierCache;
}
function cubicBezierImpl(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-5) break;
      const dx = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(dx) < 1e-6) break;
      t -= err / dx;
    }
    return sampleY(t);
  };
}

/* ---------- Toast ---------- */
function drawToast() {
  const toast = state.toast;
  if (!toast.visible && !toast.hidingSince) return;
  const m = state.metrics;
  const width = Math.min(420, m.width - 32);
  const x = (m.width - width) / 2;
  const bottom = Math.max(24, state.safeBottom + 16);

  let alpha = 1;
  let offsetY = 0;
  const now = Date.now();
  if (toast.visible) {
    const t = utils.clamp01((now - toast.since) / 200);
    alpha = t;
    offsetY = 12 * (1 - t);
    if (now - toast.since > config.TOAST_VISIBLE_MS) {
      toast.visible = false;
      toast.hidingSince = now;
    }
  } else if (toast.hidingSince) {
    const t = utils.clamp01((now - toast.hidingSince) / 200);
    alpha = 1 - t;
    offsetY = 12 * t;
    if (t >= 1) { toast.hidingSince = 0; return; }
  } else {
    return;
  }

  g.save();
  g.globalAlpha = alpha;
  g.font = font(650, 13);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lines = wrapText(toast.message, width - 32);
  const height = 24 + lines.length * 20;
  const y = m.height - bottom - height + offsetY;
  g.beginPath();
  if (g.roundRect) g.roundRect(x, y, width, height, 12);
  else utils.traceChamferRect(g, x, y, width, height, 12);
  g.fillStyle = 'rgba(255, 250, 240, .97)';
  g.fill();
  g.strokeStyle = toast.isError ? 'rgba(255, 90, 95, .72)' : 'rgba(255, 180, 0, .72)';
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = toast.isError ? '#9e4145' : '#6f6a63';
  for (let i = 0; i < lines.length; i++) {
    g.fillText(lines[i], m.width / 2, y + 12 + 10 + i * 20);
  }
  g.restore();
}

function wrapText(text, maxWidth) {
  const chars = [...String(text)];
  const lines = [];
  let line = '';
  for (const ch of chars) {
    if (g.measureText(line + ch).width > maxWidth) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/* ============================================================
 * 命中测试与触摸路由
 * ==========================================================*/
function pointIn(px, py, rect) {
  return rect && utils.pointInRect(px, py, rect);
}

/* 返回 { handled }；handled=true 表示触摸被 UI 消费，不再落到游戏分区。
 * 面板内采用"移动优先"手势：按下仅记录候选，移动超阈值判定为滚动，
 * 抬手时未发生滚动才提交点击动作（贴合移动端原生手感）。 */
let pendingPanelTouch = null;   // { action, x, y, accumulated }
let panelScrolling = false;

function findPanelItem(x, y) {
  for (const card of hit.sfxCards) {
    if (pointIn(x, y, { x: card.screenX, y: card.screenY, w: card.w, h: card.h })) {
      return { kind: 'sfx', sfxId: card.sfxId };
    }
  }
  for (const card of hit.skinCards) {
    if (pointIn(x, y, { x: card.screenX, y: card.screenY, w: card.w, h: card.h })) {
      return { kind: 'skin', skin: card.skin };
    }
  }
  for (const row of hit.settingRows) {
    if (pointIn(x, y, { x: row.screenX, y: row.screenY, w: row.w, h: row.h })) {
      return { kind: 'setting', key: row.row.key };
    }
  }
  return null;
}

function handleTouchStart(x, y) {
  // 设置面板打开时，一切交互都在面板层
  if (state.settingsOpen) {
    const panel = hit.panel;
    if (!panel) return { handled: true };
    if (!utils.pointInRect(x, y, panel)) {
      gameApi.closeSettings();
      return { handled: true };
    }
    if (pointIn(x, y, hit.close)) {
      pendingPanelTouch = { action: () => gameApi.closeSettings(), x, y, accumulated: 0 };
      panelScrolling = false;
      return { handled: true };
    }
    const item = findPanelItem(x, y);
    pendingPanelTouch = {
      action: item ? (() => {
        if (item.kind === 'sfx') gameApi.selectSfx(item.sfxId);
        else if (item.kind === 'skin') gameApi.selectSkin(item.skin);
        else if (item.kind === 'setting') gameApi.toggleSetting(item.key);
      }) : null,
      x,
      y,
      accumulated: 0,
    };
    panelScrolling = false;
    return { handled: true };
  }

  // 顶部控制
  const settingsPinned = !state.settingsSeen;
  if (pointIn(x, y, hit.music) && state.controlsVisible) {
    return { handled: true, action: 'music' };
  }
  if (pointIn(x, y, hit.sfx) && state.controlsVisible) {
    return { handled: true, action: 'sfx' };
  }
  if (pointIn(x, y, hit.settings)) {
    if (state.controlsVisible || settingsPinned) {
      return { handled: true, action: 'settings' };
    }
    gameApi.accelerateControlsReveal();
    return { handled: true };
  }
  if (state.controlsVisible && (pointIn(x, y, hit.music) || pointIn(x, y, hit.sfx))) {
    return { handled: true };
  }
  if (hit.hint && pointIn(x, y, hit.hint)) {
    return { handled: true }; // 气泡只展示不拦截语义，但也不落到舞台
  }

  // 八度切换带
  const bands = octaveBands();
  if (bands) {
    if (pointIn(x, y, bands.up)) { gameApi.shiftOctave(1); return { handled: true }; }
    if (pointIn(x, y, bands.down)) { gameApi.shiftOctave(-1); return { handled: true }; }
  }

  return { handled: false };
}

/* 面板拖拽：返回 true 表示本次移动作为滚动消费 */
function markPanelDrag(dy) {
  const panel = hit.panel;
  if (!panel) return;
  const maxScroll = Math.max(0, panel.contentH - panel.h);
  state.settingsScroll = Math.max(0, Math.min(maxScroll, state.settingsScroll - dy));
}

function handlePanelMove(dy) {
  if (!pendingPanelTouch) return false;
  pendingPanelTouch.accumulated += dy;
  if (!panelScrolling && Math.abs(pendingPanelTouch.accumulated) > 8) {
    panelScrolling = true;
  }
  if (panelScrolling) {
    markPanelDrag(dy);
    return true;
  }
  return false;
}

function handlePanelEnd() {
  const pending = pendingPanelTouch;
  pendingPanelTouch = null;
  const wasScrolling = panelScrolling;
  panelScrolling = false;
  if (!wasScrolling && pending && pending.action) {
    pending.action();
  }
}

function render(beatPosition) {
  layoutTopControls();
  // 按 z-index 顺序绘制：overlay(10) < octave(12) < topControls(20) < settings(40) < toast(60)
  if (!state.overlayGone) drawOverlay();
  drawOctaveControls();
  drawTopControls(beatPosition);
  if (state.settingsOpen) drawSettings();
  drawToast();
}

function init(context2d, api, icons) {
  g = context2d;
  gameApi = api;
  sfxIconImages = icons.sfxIcons;
  emperorIconImage = icons.emperorIcon;
  if (typeof window !== 'undefined') window.__uiHit = hit; // 测试钩子
}

module.exports = {
  init, render, handleTouchStart, handlePanelMove, handlePanelEnd,
  octaveBands, markPanelDrag,
  showToast(message, isError) {
    clearTimeout(state.toast.timer);
    state.toast.visible = true;
    state.toast.hidingSince = 0;
    state.toast.message = message;
    state.toast.isError = isError ?? false;
    state.toast.since = Date.now();
    state.toast.timer = setTimeout(() => {
      // 到时由 drawToast 触发淡出
    }, config.TOAST_VISIBLE_MS);
  },
  markPanelDrag,
  maxScroll() {
    const panel = hit.panel;
    return panel ? Math.max(0, panel.contentH - panel.h) : 0;
  },
};
