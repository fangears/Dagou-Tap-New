'use strict';
/* ============================================================
 * 可变游戏状态集中放置（原版 main.js 顶部的 let 变量们）
 * ==========================================================*/
const config = require('./config.js');

const state = {
  /* 音频 */
  audio: null,            // audio-backend 创建的上下文引用
  buffers: {},            // 解码后的音效样本
  sustainLoops: {},       // WSOLA 延音纹理
  started: false,
  bgmMuted: false,
  sfxMuted: false,
  startTime: 0,
  nextNoteTime: 0,
  stepCount: 0,

  /* 演奏设置 */
  performanceSettings: { ...config.DEFAULT_PERFORMANCE_SETTINGS },

  /* 角色 / 皮肤 */
  selectedSfxId: 'hajimi',
  hajimiAnimationEnabled: false,
  hajimiAnimationReady: false,
  hajimiAnimationRequested: false,
  hajimiAnimationFrame: -1,
  hajimiAnimationEpochBeat: 0,

  /* 网格 */
  cols: 3,
  rows: 4,
  zones: [],

  /* 视觉弹簧 / 动画状态 */
  mouthTimer: 0,
  mouthPopped: false,
  mouthAlpha: 0,          // 张嘴图透明度（80ms 过渡）
  mouthVoice: null,
  barkPop: 0,
  barkPopVel: 0,
  holding: false,
  holdLevel: 0,
  jellyScale: 1,
  jellyVel: 0,
  lastTick: 0,
  beatP: 0,
  dogTransform: null,     // 每帧由主循环写入 { tx, ty, rotate, sx, sy }
  jellyTransform: null,   // 每帧由主循环写入 { tx, ty, rotate, scale }

  /* 村民连击 */
  villagerHitCombo: 0,
  villagerHitDirection: 1,
  villagerHitStrength: 0,
  villagerHitResetTimer: 0,
  villagerHitFadeTimer: 0,
  villagerHitGeneration: 0,
  villagerHitUi: { mode: 'hidden', value: 0, since: 0 },

  /* 输入 */
  inputQueue: [],
  inputVisualTimers: new Set(),
  inputVisualGeneration: 0,
  inputSerial: 0,
  lastCommittedInputTime: -Infinity,
  pointers: new Map(),

  /* UI */
  controlsIdleTimer: 0,
  controlsVisible: true,
  controlsFastReveal: false,
  settingsOpen: false,
  settingsOpenSince: 0,
  settingsScroll: 0,          // 设置面板滚动偏移 px
  overlayHideSince: 0,        // 开始遮罩淡出起点
  overlayGone: false,
  toast: {
    visible: false,
    hidingSince: 0,
    message: '',
    isError: false,
    timer: 0,
    since: 0,
  },

  /* 元数据（NEW 红点 / 已读） */
  settingsSeen: false,
  newSeen: {
    dingdong: false,
    hajimi: false,
    villager: false,
  },

  /* 布局 */
  metrics: { width: 390, height: 844, left: 0, top: 0 },
  dpr: 2,
  sceneUnit: 260,
  landscape: false,
};

module.exports = state;
