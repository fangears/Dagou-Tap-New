'use strict';
/* ============================================================
 * 游戏装配：画布与布局 / 触摸路由 / 主循环 / 启动流程 / 设置
 * ==========================================================*/
const config = require('./config.js');
const state = require('./state.js');
const utils = require('./utils.js');
const storage = require('./storage.js');
const music = require('./music.js');
const grid = require('./grid.js');
const assets = require('./assets.js');
const visuals = require('./visuals.js');
const ui = require('./ui.js');
const audioBackend = require('./audio-backend.js');
const audioEngine = require('./audio-engine.js');
const synthModule = require('./synth.js');

const { SPB, S8 } = config;

let canvas = null;
let ctx = null;
let audio = null;
let synth = null;
let schedulerTimer = 0;
let resizeTimer = 0;
let layoutPollCounter = 0;
let scrollPointerId = null;
let scrollLastY = 0;

const icons = { sfxIcons: {}, emperorIcon: null };

/* ============================================================
 * 画布与布局
 * ==========================================================*/
function setupCanvas() {
  canvas = tt.createCanvas(); // 首次调用返回屏幕画布
  updateLayout();
  ctx = canvas.getContext('2d');
}

function updateLayout() {
  const info = tt.getSystemInfoSync();
  const dpr = Math.max(1, Math.min(info.pixelRatio || 1, 2));
  state.dpr = dpr;
  state.metrics = {
    width: info.windowWidth,
    height: info.windowHeight,
    left: 0,
    top: 0,
  };
  state.landscape = info.windowWidth >= info.windowHeight;
  state.sceneUnit = state.landscape
    ? info.windowHeight / 2
    : info.windowWidth / 1.5;

  // 刘海 / 手势条安全区
  const safeArea = info.safeArea;
  const screenHeight = info.screenHeight ?? info.windowHeight;
  if (safeArea && typeof safeArea.top === 'number') {
    state.safeTop = Math.max(0, Math.round(safeArea.top));
    state.safeBottom = Math.max(0, Math.round(screenHeight - safeArea.bottom));
  } else {
    state.safeTop = 0;
    state.safeBottom = 0;
  }

  if (canvas) {
    canvas.width = Math.round(info.windowWidth * dpr);
    canvas.height = Math.round(info.windowHeight * dpr);
    if (ctx) {
      try {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      } catch (_) {
        ctx.scale(dpr, dpr);
      }
    }
  }
  visuals.resize();
}

/* 轮询布局自愈：部分环境（真机 URL 栏收缩、预览面板拖拽）不派发 resize 事件 */
function pollLayout() {
  try {
    const info = tt.getSystemInfoSync();
    if (
      info.windowWidth !== state.metrics.width ||
      info.windowHeight !== state.metrics.height ||
      Math.min(info.pixelRatio || 1, 2) !== state.dpr
    ) {
      handleLayoutResize();
    }
  } catch (_) { /* 忽略轮询失败 */ }
}

function handleLayoutResize() {
  updateLayout();
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => grid.buildGrid(), 150);
}

/* ============================================================
 * 节拍 / 视觉钩子
 * ==========================================================*/
function getAudioBeatPosition() {
  return state.started && audio && state.startTime > 0 &&
    audio.ctx.currentTime >= state.startTime
    ? (audio.ctx.currentTime - state.startTime) / SPB
    : null;
}

function openMouth(holdMs) {
  state.mouthPopped = true;
  clearTimeout(state.mouthTimer);
  state.mouthTimer = setTimeout(() => {
    if (!state.mouthVoice) {
      state.mouthPopped = false;
    }
  }, holdMs);
}

function lockMouth(voice) {
  state.mouthVoice = voice;
  clearTimeout(state.mouthTimer);
  state.mouthPopped = true;
  state.holding = true;
}

function unlockMouth(voice, holdMs) {
  if (state.mouthVoice !== voice) return;
  state.mouthVoice = null;
  state.holding = false;
  openMouth(holdMs);
}

function barkKick() {
  state.barkPopVel = Math.min(
    state.barkPopVel + config.BARK_KICK,
    config.BARK_KICK_MAX
  );
}

/* ---------- 村民受击 ---------- */
function resetVillagerHitState() {
  state.villagerHitGeneration++;
  clearTimeout(state.villagerHitResetTimer);
  clearTimeout(state.villagerHitFadeTimer);
  state.villagerHitResetTimer = 0;
  state.villagerHitFadeTimer = 0;
  state.villagerHitCombo = 0;
  state.villagerHitStrength = 0;
  state.villagerHitUi = { mode: 'hidden', value: 0, since: 0 };
  visuals.resetVillagerHitVisual();
}

function triggerVillagerHit(zi, sfxId) {
  if (sfxId !== 'villager' || state.selectedSfxId !== 'villager') return;

  clearTimeout(state.villagerHitResetTimer);
  clearTimeout(state.villagerHitFadeTimer);
  state.villagerHitCombo++;
  state.villagerHitStrength = Math.min(state.villagerHitCombo, 8);
  const column = zi % state.cols;
  const relativeColumn = (column + 0.5) / state.cols;
  state.villagerHitDirection = relativeColumn === 0.5
    ? (state.villagerHitCombo % 2 === 0 ? -1 : 1)
    : (relativeColumn < 0.5 ? 1 : -1);
  const direction = state.villagerHitDirection;
  const generation = ++state.villagerHitGeneration;

  const offset = 10 + state.villagerHitStrength * 1.25;
  visuals.setKnockback(
    direction,
    direction * offset,
    -direction * Math.min(4, 1.5 + state.villagerHitStrength * 0.25)
  );
  visuals.setFlash();
  visuals.spawnVillagerHitParticles(direction, state.villagerHitStrength);

  state.villagerHitUi = {
    mode: 'visible',
    value: state.villagerHitCombo,
    since: Date.now(),
  };

  state.villagerHitResetTimer = setTimeout(() => {
    if (generation !== state.villagerHitGeneration) return;
    state.villagerHitCombo = 0;
    state.villagerHitUi = {
      mode: 'fading',
      value: state.villagerHitUi.value,
      since: Date.now(),
    };
    state.villagerHitFadeTimer = setTimeout(() => {
      if (generation !== state.villagerHitGeneration) return;
      state.villagerHitUi = { mode: 'hidden', value: 0, since: 0 };
    }, 180);
  }, config.VILLAGER_COMBO_RESET_MS);
}

/* ---------- 顶部控制显隐 ---------- */
function showControls() {
  if (state.pointers.size > 0 || state.holding) return;
  state.controlsVisible = true;
}

function hideControlsUntilIdle() {
  state.controlsVisible = false;
  clearTimeout(state.controlsIdleTimer);
  state.controlsIdleTimer = setTimeout(showControls, config.CONTROLS_IDLE_MS);
}

function accelerateControlsReveal() {
  if (state.controlsVisible || state.pointers.size > 0 || state.holding) return;
  clearTimeout(state.controlsIdleTimer);
  state.controlsIdleTimer = setTimeout(showControls, config.CONTROLS_HOVER_IDLE_MS);
}

/* ============================================================
 * 演奏设置
 * ==========================================================*/
function readSettingsFromStorage() {
  const keys = config.STORAGE_KEYS;
  const settings = { ...config.DEFAULT_PERFORMANCE_SETTINGS };
  const pianoMode = storage.get(keys.pianoMode);
  if (pianoMode === '1') settings.pianoMode = true;
  else if (pianoMode === '0') settings.pianoMode = false;
  const octaveSwitching = storage.get(keys.octaveSwitching);
  if (octaveSwitching === '1') settings.octaveSwitching = true;
  else if (octaveSwitching === '0') settings.octaveSwitching = false;
  const rhythmSnap = storage.get(keys.rhythmSnap);
  if (rhythmSnap === '1') settings.rhythmSnap = true;
  else if (rhythmSnap === '0') settings.rhythmSnap = false;
  const showGrid = storage.get(keys.showGrid);
  if (showGrid === '1') settings.showGrid = true;
  else if (showGrid === '0') settings.showGrid = false;
  settings.pianoOctaveStart = music.normalizePianoOctaveStart(
    Number(storage.get(keys.pianoOctaveStart))
  );
  return settings;
}

function applyPerformanceSettings(previousSettings) {
  if (
    previousSettings &&
    previousSettings.rhythmSnap !== state.performanceSettings.rhythmSnap
  ) {
    audioEngine.clearQueuedPerformanceInput();
  }

  const scaleChanged = previousSettings && (
    previousSettings.pianoMode !== state.performanceSettings.pianoMode ||
    music.effectivePianoOctaveStart(previousSettings) !==
      music.effectivePianoOctaveStart(state.performanceSettings)
  );
  if (scaleChanged) audioEngine.settleActivePerformanceInput();

  if (
    state.zones.length === 0 ||
    !previousSettings ||
    previousSettings.pianoMode !== state.performanceSettings.pianoMode ||
    music.effectivePianoOctaveStart(previousSettings) !==
      music.effectivePianoOctaveStart(state.performanceSettings)
  ) {
    grid.buildGrid();
  }
}

function replacePerformanceSettings(nextSettings) {
  const previousSettings = { ...state.performanceSettings };
  for (const key of ['pianoMode', 'octaveSwitching', 'rhythmSnap', 'showGrid']) {
    state.performanceSettings[key] = nextSettings[key] === true;
  }
  state.performanceSettings.pianoOctaveStart = music.normalizePianoOctaveStart(
    nextSettings.pianoOctaveStart
  );
  applyPerformanceSettings(previousSettings);
}

function toggleSetting(key) {
  if (!(key in state.performanceSettings)) return;
  const nextValue = !state.performanceSettings[key];
  replacePerformanceSettings({
    ...state.performanceSettings,
    [key]: nextValue,
  });
  storage.set(config.STORAGE_KEYS[key], nextValue ? '1' : '0');
  bumpPanel();
}

function shiftOctave(direction) {
  if (!music.octaveControlsEnabled(state.performanceSettings)) return;
  const currentOctave = music.normalizePianoOctaveStart(
    state.performanceSettings.pianoOctaveStart
  );
  const targetOctave = currentOctave + direction;
  if (
    targetOctave < config.PIANO_OCTAVE_MIN ||
    targetOctave > config.PIANO_OCTAVE_MAX
  ) {
    return;
  }
  const previousSettings = { ...state.performanceSettings };
  state.performanceSettings.pianoOctaveStart = targetOctave;
  applyPerformanceSettings(previousSettings);
  storage.set(config.STORAGE_KEYS.pianoOctaveStart, String(targetOctave));
}

/* ---------- 角色与皮肤 ---------- */
function bumpPanel() {
  state.panelVersion++;
}

async function selectSfx(sfxId) {
  const nextSfxId = config.SFX_SAMPLE_SETS[sfxId] ? sfxId : 'hajimi';
  if (nextSfxId === state.selectedSfxId) return;

  audioEngine.settleActivePerformanceInput();
  audioEngine.stopAllVoices();
  resetVillagerHitState();
  state.selectedSfxId = nextSfxId;
  state.hajimiAnimationEnabled = false;
  bumpPanel();
  await visuals.ensureCharacterLoaded(nextSfxId);
}

async function selectSkin(skin) {
  if (state.selectedSfxId !== 'hajimi') return;
  const useEmperor = skin === 'emperor';
  if (useEmperor === state.hajimiAnimationEnabled) return;
  state.hajimiAnimationEnabled = useEmperor;
  bumpPanel();
  if (useEmperor) {
    alignHajimiAnimationToBeat();
    try {
      await visuals.ensureEmperorAtlas();
      state.hajimiAnimationReady = true;
      alignHajimiAnimationToBeat();
    } catch (_) {
      state.hajimiAnimationEnabled = false;
      state.hajimiAnimationReady = false;
      ui.showToast('东海帝皇动画加载失败，请稍后重试。', true);
    }
  }
}

/* ---------- 帝皇图集帧（按音频时钟对齐节拍） ---------- */
function alignHajimiAnimationToBeat() {
  const beatPosition = getAudioBeatPosition();
  state.hajimiAnimationEpochBeat = Number.isFinite(beatPosition)
    ? Math.ceil(beatPosition - 0.03)
    : 0;
  state.hajimiAnimationFrame = -1;
}

function renderHajimiAnimationFrame(beatPosition) {
  if (!state.hajimiAnimationReady) return;
  const relativeBeat = Number.isFinite(beatPosition)
    ? beatPosition - state.hajimiAnimationEpochBeat
    : 0;
  const loopBeat = relativeBeat > 0
    ? relativeBeat % config.HAJIMI_ANIMATION_BEATS
    : 0;
  const frameIndex = Math.min(
    config.HAJIMI_ANIMATION_FRAME_COUNT - 1,
    Math.floor(loopBeat * config.HAJIMI_FRAMES_PER_BEAT)
  );
  if (frameIndex === state.hajimiAnimationFrame) return;
  state.hajimiAnimationFrame = frameIndex;
}

/* ---------- 设置面板开合 ---------- */
function markSettingsSeen() {
  if (state.settingsSeen) return;
  state.settingsSeen = true;
  storage.set(config.STORAGE_KEYS.settingsSeen, '1');
}

function markAllSfxNewSeen() {
  let changed = false;
  for (const sfxId of config.NEW_ITEM_IDS) {
    if (!state.newSeen[sfxId]) {
      state.newSeen[sfxId] = true;
      storage.set(config.STORAGE_KEYS[`${sfxId}NewSeen`], '1');
      changed = true;
    }
  }
  if (changed) bumpPanel();
}

function openSettings() {
  if (state.settingsOpen) return;
  markSettingsSeen();
  state.settingsOpen = true;
  state.settingsOpenSince = Date.now();
  state.settingsScroll = 0;
  bumpPanel();
}

function closeSettings() {
  if (!state.settingsOpen) return;
  markAllSfxNewSeen();
  state.settingsOpen = false;
}

/* ---------- 静音 ---------- */
function setBusMuted(bus, muted) {
  if (!audio || !bus) return;
  const now = audio.ctx.currentTime;
  bus.gain.cancelScheduledValues(now);
  bus.gain.setTargetAtTime(muted ? 0 : 1, now, 0.015);
}

function toggleMusic() {
  state.bgmMuted = !state.bgmMuted;
  setBusMuted(audio.bgmBus, state.bgmMuted);
}

function toggleSfx() {
  state.sfxMuted = !state.sfxMuted;
  setBusMuted(audio.sfxBus, state.sfxMuted);
  if (state.sfxMuted) state.mouthPopped = state.mouthVoice ? state.mouthPopped : false;
}

/* ============================================================
 * 分区输入（多指 + 跨格补全 + 量化队列）
 * ==========================================================*/
function resolveSfxSample(sample) {
  return config.SFX_SAMPLE_SETS[state.selectedSfxId]?.[sample] ?? sample;
}

function retuneHeldJiao(pointerId, pointerState, zi) {
  const z = state.zones[zi];
  if (!z || z.sample !== 'jiao' || !pointerState.voice) return false;
  if (!audioEngine.isRetunableSustainVoice(pointerState.voice)) return false;

  pointerState.zone = zi;
  pointerState.pendingEntryId = null;
  const entry = audioEngine.enqueueSustainRetune(zi, pointerId, pointerState.voice);
  audioEngine.commitUnsnappedInput(entry);
  return true;
}

function enterZone(pointerId, pointerState, zi) {
  if (zi === pointerState.zone) return;
  if (retuneHeldJiao(pointerId, pointerState, zi)) return;

  if (pointerState.voice) {
    audioEngine.releaseVoice(pointerState.voice, true);
    pointerState.voice = null;
  }

  pointerState.zone = zi;
  const entry = audioEngine.enqueueActivation(zi, pointerId);
  pointerState.pendingEntryId = entry.id;
  audioEngine.commitUnsnappedInput(entry);
}

function createInputState(lastX = 0, lastY = 0) {
  return { zone: -1, voice: null, pendingEntryId: null, lastX, lastY };
}

function beginZoneInput(inputId, zi, lastX = 0, lastY = 0) {
  const pointerState = createInputState(lastX, lastY);
  state.pointers.set(inputId, pointerState);
  enterZone(inputId, pointerState, zi);
  return pointerState;
}

function tryActivate(pointerId, x, y, pointerState) {
  if (!pointerState) {
    return beginZoneInput(pointerId, grid.zoneIndex(x, y), x, y);
  }
  for (const zi of grid.zonesAlongSegment(pointerState.lastX, pointerState.lastY, x, y)) {
    enterZone(pointerId, pointerState, zi);
  }
  pointerState.lastX = x;
  pointerState.lastY = y;
  return pointerState;
}

function endInput(inputId, musical) {
  const pointerState = state.pointers.get(inputId);
  if (pointerState && pointerState.voice) {
    if (musical) audioEngine.releaseVoice(pointerState.voice, true);
    else audioEngine.forceStopVoice(pointerState.voice);
  }
  if (!musical) audioEngine.cancelQueuedInputs(inputId);
  state.pointers.delete(inputId);
  if (state.pointers.size === 0) hideControlsUntilIdle();
}

/* ============================================================
 * 触摸路由
 * ==========================================================*/
function onTouchStart(res) {
  const touch = res.changedTouches[0];
  if (!touch) return;
  const id = touch.identifier ?? 't';
  const x = touch.clientX;
  const y = touch.clientY;

  restoreAudioIfNeeded();

  // 未开始：顶栏按钮（音乐/音效/设置）仍可交互，只有点在空白处才进入游戏
  if (!state.started || !state.buffers.da) {
    const uiResult = ui.handleTouchStart(x, y);
    if (uiResult.handled) {
      if (uiResult.action === 'music') toggleMusic();
      else if (uiResult.action === 'sfx') toggleSfx();
      else if (uiResult.action === 'settings') openSettings();
      return;
    }
    state.pointers.set(id, createInputState(x, y));
    hideControlsUntilIdle();
    void start();
    return;
  }

  const uiResult = ui.handleTouchStart(x, y);
  if (uiResult.handled) {
    if (uiResult.action === 'music') toggleMusic();
    else if (uiResult.action === 'sfx') toggleSfx();
    else if (uiResult.action === 'settings') openSettings();
    // 面板内触摸都可能演变为滚动，统一记入滚动指针
    if (state.settingsOpen) {
      scrollPointerId = id;
      scrollLastY = y;
    }
    return;
  }

  tryActivate(id, x, y, null);
}

function onTouchMove(res) {
  const touch = res.changedTouches[0];
  if (!touch) return;
  const id = touch.identifier ?? 't';
  const x = touch.clientX;
  const y = touch.clientY;

  if (scrollPointerId === id) {
    ui.handlePanelMove(y - scrollLastY);
    scrollLastY = y;
    return;
  }

  if (!state.pointers.has(id)) return;
  if (!state.started || !state.buffers.da) return;
  tryActivate(id, x, y, state.pointers.get(id));
}

function onTouchEnd(res, musical) {
  const touch = res.changedTouches[0];
  const id = touch ? (touch.identifier ?? 't') : null;
  if (id !== null && scrollPointerId === id) {
    scrollPointerId = null;
    ui.handlePanelEnd();
    return;
  }
  if (id === null) return;
  endInput(id, musical);
}

function restoreAudioIfNeeded() {
  if (audio && state.started) void audio.resume();
}

/* ============================================================
 * 启动 / 退出
 * ==========================================================*/
async function start() {
  if (state.started) return;
  state.started = true;
  hideControlsUntilIdle();

  if (!audio) {
    // 首次进入：创建音频上下文并解码采样
    audio = audioBackend.createAudioBackend();
    state.audio = audio;
    await audio.resume();
    synth = synthModule.createSynth(audio);

    audioEngine.init(audio, synth, {
      openMouth, lockMouth, unlockMouth, barkKick,
      spawnEffect: visuals.spawnEffect,
      flashZone: visuals.flashZone,
      villagerHit: triggerVillagerHit,
      endInput,
      hideControlsUntilIdle,
    });

    await audioEngine.loadSamples();
    await audioEngine.tryLoadBgmLoop();
  } else {
    // 再次进入：音频时钟在退出时被挂起冻结，恢复后节拍无缝续接
    await audio.resume();
  }

  if (audio.caps.gain) {
    const now = audio.ctx.currentTime;
    audio.master.gain.cancelScheduledValues(now);
    audio.master.gain.setValueAtTime(config.MASTER_GAIN, now);
  }

  state.startTime = audio.ctx.currentTime + 0.12;
  state.nextNoteTime = state.startTime;
  state.lastCommittedInputTime = -Infinity;
  state.inputQueue.length = 0;
  state.stepCount = 0;
  audioEngine.startBgmLoop();
  if (!schedulerTimer) {
    schedulerTimer = setInterval(audioEngine.scheduler, 25);
  }

  state.overlayHideSince = Date.now();
}

/* 回到开始页：停声 + 挂起音频时钟（节拍位置保留，可无缝续接） */
function exitGame() {
  closeSettings();
  if (!state.started) return;

  audioEngine.settleActivePerformanceInput();
  audioEngine.stopAllVoices();
  resetVillagerHitState();
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = 0;
  }
  if (audio) {
    // 双保险：主音量淡出到 0（兼容无 suspend 的实现）+ 尝试挂起时钟
    try {
      if (audio.caps.gain) {
        const now = audio.ctx.currentTime;
        audio.master.gain.cancelScheduledValues(now);
        audio.master.gain.setValueAtTime(audio.master.gain.value, now);
        audio.master.gain.linearRampToValueAtTime(0, now + 0.06);
      }
      if (typeof audio.ctx.suspend === 'function') {
        void audio.ctx.suspend();
      }
    } catch (_) { /* 忽略 */ }
  }
  clearTimeout(state.mouthTimer);
  state.mouthPopped = false;
  state.mouthVoice = null;
  state.holding = false;
  state.holdLevel = 0;
  state.started = false;
  state.overlayGone = false;
  state.overlayHideSince = 0;
  state.controlsVisible = true;
  clearTimeout(state.controlsIdleTimer);
}

/* ============================================================
 * 主循环
 * ==========================================================*/
function tick() {
  requestAnimationFrame(tick);
  const now = audio && state.started
    ? audio.ctx.currentTime
    : Date.now() / 1000;
  const dt = Math.min(0.05, Math.max(0.001, now - state.lastTick));
  state.lastTick = now;
  if (++layoutPollCounter >= 60) {
    layoutPollCounter = 0;
    pollLayout();
  }
  const uiBeatPosition = getAudioBeatPosition();

  if (state.hajimiAnimationEnabled && state.hajimiAnimationReady) {
    renderHajimiAnimationFrame(uiBeatPosition);
  }

  if (state.started && audio) {
    const t = audio.ctx.currentTime;
    audioEngine.updateSustainClaims(t);
    const phase = (((t - state.startTime) / SPB) % 1 + 1) % 1;
    state.beatP = Math.pow(1 - phase, 2.4);

    const sway = Math.sin(((t - state.startTime) / (SPB * 2)) * Math.PI * 2);
    const dogT = state.dogTransform;
    dogT.tx = sway * 5;
    dogT.ty = -9 * state.beatP;
    dogT.rotate = (sway * 2.4 * Math.PI) / 180;
    dogT.sx = 1 + 0.06 * state.beatP;
    dogT.sy = 1 - 0.05 * state.beatP;
  }

  /* 叫弹跳弹簧 */
  const popTarget = state.mouthPopped ? 1 : 0;
  state.barkPopVel += (popTarget - state.barkPop) * 320 * dt;
  state.barkPopVel *= Math.exp(-13 * dt);
  state.barkPopVel = Math.max(-10, Math.min(10, state.barkPopVel));
  state.barkPop += state.barkPopVel * dt;

  /* 嘴型透明度（80ms 过渡） */
  const mouthTarget = state.mouthPopped && !state.sfxMuted ? 1 : 0;
  const mouthSpeed = dt / 0.08;
  state.mouthAlpha += Math.max(-mouthSpeed, Math.min(mouthSpeed, mouthTarget - state.mouthAlpha));

  /* 长按果冻动画 */
  const holdTarget = state.holding ? 1 : 0;
  const tau = state.holding ? 1.1 : 0.22;
  state.holdLevel += (holdTarget - state.holdLevel) * (1 - Math.exp(-dt / tau));

  const scaleTarget = 1 + 0.16 * state.holdLevel;
  state.jellyVel += (scaleTarget - state.jellyScale) * 55 * dt;
  state.jellyVel *= Math.exp(-7 * dt);
  state.jellyScale += state.jellyVel * dt;

  const amp = 6 * state.holdLevel;
  const jx = (Math.sin(now * 120) + Math.sin(now * 197 + 1.7) * 0.6) * amp * 0.55;
  const jy = (Math.cos(now * 128 + 0.6) + Math.sin(now * 233 + 3.1) * 0.6) * amp * 0.55;
  const jr = (Math.sin(now * 108 + 2.2) + Math.sin(now * 181) * 0.5) * 2.4 * state.holdLevel * Math.PI / 180;
  const jellyT = state.jellyTransform;
  jellyT.tx = jx;
  jellyT.ty = jy;
  jellyT.rotate = jr;
  jellyT.scale = state.jellyScale;

  visuals.render(uiBeatPosition);
  ui.render(uiBeatPosition);
}

/* ============================================================
 * 装配入口
 * ==========================================================*/
async function loadStartupImages() {
  const loads = [];
  for (const [sfxId, set] of Object.entries(config.CHARACTER_IMAGE_SETS)) {
    loads.push(
      assets.loadImage(set.close).then((img) => { icons.sfxIcons[sfxId] = img; }).catch(() => {})
    );
  }
  loads.push(
    assets.loadImage(config.HAJIMI_ANIMATION_ICON_PATH)
      .then((img) => { icons.emperorIcon = img; })
      .catch(() => {})
  );
  await Promise.all(loads);
}

function init() {
  setupCanvas();

  /* 存档读取 */
  state.performanceSettings = readSettingsFromStorage();
  state.settingsSeen = storage.get(config.STORAGE_KEYS.settingsSeen) === '1';
  for (const sfxId of config.NEW_ITEM_IDS) {
    state.newSeen[sfxId] = storage.get(config.STORAGE_KEYS[`${sfxId}NewSeen`]) === '1';
  }

  grid.buildGrid();
  visuals.init(ctx, canvas);
  ui.init(ctx, {
    toggleMusic, toggleSfx, openSettings, closeSettings,
    toggleSetting, selectSfx, selectSkin, shiftOctave,
    accelerateControlsReveal, exitGame,
  }, icons);

  void visuals.ensureCharacterLoaded(state.selectedSfxId);
  void loadStartupImages();

  /* 触摸监听 */
  tt.onTouchStart(onTouchStart);
  tt.onTouchMove(onTouchMove);
  tt.onTouchEnd((res) => onTouchEnd(res, true));
  tt.onTouchCancel((res) => onTouchEnd(res, false));
  if (typeof tt.onWindowResize === 'function') {
    tt.onWindowResize(handleLayoutResize);
  }

  state.controlsVisible = true;
  requestAnimationFrame(tick);

  /* 测试钩子（小游戏环境无 window，自动忽略） */
  if (typeof window !== 'undefined') {
    window.__game = { state, config, grid, audioEngine: () => audioEngine, getAudio: () => audio };
  }
}

module.exports = { init };
