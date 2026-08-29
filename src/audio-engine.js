'use strict';
/* ============================================================
 * 音频引擎：采样加载 / WSOLA 延音纹理 / voice 生命周期 /
 * 节拍调度器 / 点击量化队列（移植自网页版 main.js，算法原样保留）
 * ==========================================================*/
const config = require('./config.js');
const state = require('./state.js');
const utils = require('./utils.js');
const music = require('./music.js');
const AUDIO_B64 = require('./audio-data.js');

const { SPB, S16, S8 } = config;

/* ---------- 模块内引用（init 时注入） ---------- */
let audio = null;       // audio-backend 产物
let synth = null;       // synth.js 产物
let hooks = null;       // 视觉回调 { openMouth, barkKick, spawnEffect, villagerHit, endInput, showToast }
let bgmLoopBuffer = null;
let bgmLoopSource = null;
const liveVoices = new Set();
let voiceSerial = 0;
let activeSustainVoice = null;

function init(audioBackend, synthModule, visualHooks) {
  audio = audioBackend;
  synth = synthModule;
  hooks = visualHooks;
}

function getAudio() {
  return audio;
}

/* ---------- 采样加载 ---------- */
async function loadSamples() {
  for (const n of config.RUNTIME_SAMPLE_NAMES) {
    const encoded = AUDIO_B64[n];
    if (typeof encoded !== 'string' || encoded.length === 0) {
      throw new Error(`Missing embedded audio sample: ${n}`);
    }
    state.buffers[n] = await audio.decodeAudioData(utils.b64ToArrayBuffer(encoded));
    state.sustainLoops[n] = config.SUSTAIN_REGIONS[n]?.enabled
      ? buildSustainTexture(state.buffers[n], config.SUSTAIN_REGIONS[n])
      : null;
  }
}

/* ---------- BGM：合成不可用时尝试预渲染 loop ---------- */
async function tryLoadBgmLoop() {
  if (synth.enabled) return;
  try {
    let arrayBuffer = null;
    if (typeof tt !== 'undefined' && tt.getFileSystemManager) {
      const fsm = tt.getFileSystemManager();
      arrayBuffer = await new Promise((resolve, reject) => {
        fsm.readFile({
          filePath: 'assets/audio/bgm-loop.wav',
          success: (res) => resolve(res.data),
          fail: reject,
        });
      });
    } else {
      const res = await fetch('assets/audio/bgm-loop.wav');
      if (!res.ok) throw new Error('bgm loop not found');
      arrayBuffer = await res.arrayBuffer();
    }
    bgmLoopBuffer = await audio.decodeAudioData(arrayBuffer);
  } catch (_) {
    bgmLoopBuffer = null; // 无 BGM：游戏依然可玩
  }
}

/* ---------- WSOLA 延音纹理 ---------- */
function monoMix(source) {
  const mono = new Float32Array(source.length);
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const data = source.getChannelData(ch);
    for (let i = 0; i < data.length; i++) mono[i] += data[i];
  }
  const scale = 1 / source.numberOfChannels;
  for (let i = 0; i < mono.length; i++) mono[i] *= scale;
  return mono;
}

function bestWsolaStart(
  input,
  output,
  outputStart,
  overlapFrames,
  regionMin,
  regionMax,
  target,
  searchFrames,
  previousStart
) {
  const candidateStep = 8;
  const compareStep = 4;
  const lo = Math.max(regionMin, target - searchFrames);
  const hi = Math.min(regionMax, target + searchFrames);
  let bestStart = Math.max(regionMin, Math.min(regionMax, target));
  let bestScore = -Infinity;

  for (let start = lo; start <= hi; start += candidateStep) {
    let dot = 0, energyOut = 0, energyIn = 0;
    for (let i = 0; i < overlapFrames; i += compareStep) {
      const a = output[outputStart + i];
      const b = input[start + i];
      dot += a * b;
      energyOut += a * a;
      energyIn += b * b;
    }

    if (energyOut < 1e-9 || energyIn < 1e-9) continue;
    let score = dot / Math.sqrt(energyOut * energyIn);

    const distance = Math.abs(start - previousStart);
    if (distance < overlapFrames * 0.18) score -= 0.06;
    score -= Math.abs(Math.log(Math.sqrt(energyIn / energyOut))) * 0.04;

    if (score > bestScore) {
      bestScore = score;
      bestStart = start;
    }
  }
  return bestStart;
}

function buildSustainTexture(source, region) {
  const sr = source.sampleRate;
  const regionMin = Math.max(0, Math.round(region.regionStart * sr));
  const regionEnd = Math.min(source.length, Math.round(region.regionEnd * sr));
  const frameFrames = Math.round(region.frame * sr);
  const overlapFrames = Math.round(region.overlap * sr);
  const hopFrames = frameFrames - overlapFrames;
  const searchFrames = Math.round(region.search * sr);
  const wrapFrames = Math.round(region.wrapBlend * sr);
  const regionMax = regionEnd - frameFrames;

  if (
    regionMin >= regionMax ||
    overlapFrames <= 1 ||
    hopFrames <= 1 ||
    wrapFrames >= frameFrames
  ) {
    throw new Error('Invalid sustain region');
  }

  const requestedFrames = Math.ceil(region.textureDuration * sr);
  const workingLength = requestedFrames + frameFrames + wrapFrames;
  const channels = Array.from(
    { length: source.numberOfChannels },
    () => new Float32Array(workingLength)
  );
  const inputMono = monoMix(source);
  const outputMono = new Float32Array(workingLength);
  const releaseFrames = [];

  const entryStart = regionMax;
  const firstStart = Math.max(regionMin, entryStart - overlapFrames);
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    channels[ch].set(
      source.getChannelData(ch).subarray(firstStart, firstStart + frameFrames),
      0
    );
  }
  outputMono.set(
    inputMono.subarray(firstStart, firstStart + frameFrames),
    0
  );

  let previousStart = firstStart;
  let lastFilled = frameFrames;
  for (
    let step = 1, outputStart = hopFrames;
    outputStart + frameFrames <= workingLength;
    step++, outputStart += hopFrames
  ) {
    let candidateStart;
    if (step === 1) {
      candidateStart = entryStart;
    } else {
      const golden = (region.seed + step * 0.618033988749895) % 1;
      let target = Math.round(regionMin + golden * (regionMax - regionMin));

      if (Math.abs(target - previousStart) < overlapFrames * 0.2) {
        const span = regionMax - regionMin;
        target = Math.round(
          regionMin + ((target - regionMin + span * 0.47) % span)
        );
      }

      candidateStart = bestWsolaStart(
        inputMono,
        outputMono,
        outputStart,
        overlapFrames,
        regionMin,
        regionMax,
        target,
        searchFrames,
        previousStart
      );
    }

    for (let i = 0; i < overlapFrames; i++) {
      const p = i / (overlapFrames - 1);
      const mix = 0.5 - 0.5 * Math.cos(Math.PI * p);
      outputMono[outputStart + i] =
        outputMono[outputStart + i] * (1 - mix) +
        inputMono[candidateStart + i] * mix;

      for (let ch = 0; ch < source.numberOfChannels; ch++) {
        const output = channels[ch];
        const input = source.getChannelData(ch);
        output[outputStart + i] =
          output[outputStart + i] * (1 - mix) +
          input[candidateStart + i] * mix;
      }
    }

    outputMono.set(
      inputMono.subarray(
        candidateStart + overlapFrames,
        candidateStart + frameFrames
      ),
      outputStart + overlapFrames
    );
    for (let ch = 0; ch < source.numberOfChannels; ch++) {
      channels[ch].set(
        source.getChannelData(ch).subarray(
          candidateStart + overlapFrames,
          candidateStart + frameFrames
        ),
        outputStart + overlapFrames
      );
    }

    releaseFrames.push({
      textureFrame: outputStart + overlapFrames,
      sourceFrame: candidateStart + overlapFrames,
    });
    previousStart = candidateStart;
    lastFilled = outputStart + frameFrames;
  }

  const textureFrames = lastFilled - wrapFrames;
  const loopBuffer = audio.ctx.createBuffer(
    source.numberOfChannels,
    textureFrames,
    sr
  );
  for (let ch = 0; ch < source.numberOfChannels; ch++) {
    const input = channels[ch];
    const output = loopBuffer.getChannelData(ch);
    output.set(input.subarray(0, textureFrames));
    for (let i = 0; i < wrapFrames; i++) {
      const p = i / (wrapFrames - 1);
      const mix = 0.5 - 0.5 * Math.cos(Math.PI * p);
      const tail = input[textureFrames + i];
      const head = input[i];
      output[i] = tail * (1 - mix) + head * mix;
    }
  }

  const validReleaseFrames = releaseFrames.filter(
    point =>
      point.textureFrame >= wrapFrames &&
      point.textureFrame < textureFrames
  );
  if (wrapFrames < hopFrames) {
    validReleaseFrames.push({
      textureFrame: wrapFrames,
      sourceFrame: firstStart + wrapFrames,
    });
    validReleaseFrames.sort((a, b) => a.textureFrame - b.textureFrame);
  }
  const attackPoint = region.preferFrameEntry
    ? validReleaseFrames.find(point => point.textureFrame >= frameFrames)
    : validReleaseFrames[0];
  if (!attackPoint) throw new Error('Sustain texture has no release points');

  return {
    buffer: loopBuffer,
    attackOffset: attackPoint.textureFrame / sr,
    tailOffset: attackPoint.sourceFrame / sr,
    releasePoints: validReleaseFrames.map(point => ({
      textureOffset: point.textureFrame / sr,
      sourceOffset: point.sourceFrame / sr,
    })),
  };
}

/* ---------- 变调 ---------- */
function barkPlaybackRate(sample, pitchTier, fixedTargetMidi, pianoOctaveStart) {
  const octaveReference = Number.isFinite(fixedTargetMidi)
    ? config.BARK_PIANO_SOURCE_MIDI[sample]?.[
        music.normalizePianoOctaveStart(pianoOctaveStart)
      ]
    : undefined;
  const sourceMidi = Number.isFinite(fixedTargetMidi)
    ? (octaveReference ?? config.BARK_SOURCE_MIDI[sample])
    : (config.BARK_NORMAL_SOURCE_MIDI[sample] ?? config.BARK_SOURCE_MIDI[sample]);
  const targetMidi = Number.isFinite(fixedTargetMidi)
    ? fixedTargetMidi
    : config.BARK_TARGET_MIDI[sample]?.[pitchTier];
  if (!Number.isFinite(sourceMidi) || !Number.isFinite(targetMidi)) {
    throw new Error(`No fixed pitch target for ${sample}, tier ${pitchTier}`);
  }
  return Math.pow(2, (targetMidi - sourceMidi) / 12);
}

/* ---------- voice 生命周期 ---------- */
function safeStop(source, when) {
  if (!source) return;
  try { source.stop(when === undefined ? audio.ctx.currentTime : when); } catch (_) { }
}

function cleanupVoice(voice) {
  if (!voice || voice.cleaned) return;
  voice.cleaned = true;
  clearTimeout(voice.cleanupTimer);
  liveVoices.delete(voice);

  if (activeSustainVoice === voice) activeSustainVoice = null;
  if (state.mouthVoice === voice) hooks.unlockMouth(voice, 0);

  for (const node of [
    voice.drySource, voice.dryGain,
    voice.loopSource, voice.loopGain,
    voice.tailSource, voice.tailGain,
  ]) {
    if (!node) continue;
    try { node.disconnect(); } catch (_) { }
  }
}

function createTailSource(voice, boundary, sourceOffset) {
  const ctx = audio.ctx;
  const source = ctx.createBufferSource();
  const gain = ctx.createGain();
  source.buffer = voice.sourceBuffer;
  source.playbackRate.setValueAtTime(voice.rate, boundary);
  gain.gain.setValueAtTime(voice.sampleGain, boundary);
  source.connect(gain);
  gain.connect(audio.sfxBus);
  source.start(boundary, sourceOffset);

  voice.tailSource = source;
  voice.tailGain = gain;
  voice.tailEndAt =
    boundary + (voice.sourceBuffer.duration - sourceOffset) / voice.rate;
  source.onended = () => cleanupVoice(voice);
}

function playPressVoice(name, rate, when) {
  const ctx = audio.ctx;
  const sourceBuffer = state.buffers[name];
  const sustain = state.sustainLoops[name];
  const sampleGain = config.SFX_SAMPLE_GAIN[name] ?? 1;

  if (!sustain) {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = sourceBuffer;
    source.playbackRate.setValueAtTime(rate, when);
    gain.gain.setValueAtTime(sampleGain, when);
    source.connect(gain);
    gain.connect(audio.sfxBus);
    source.onended = () => {
      try { source.disconnect(); } catch (_) { }
      try { gain.disconnect(); } catch (_) { }
    };
    source.start(when);
    return null;
  }

  const handoffAt = when + sustain.tailOffset / rate;

  const drySource = ctx.createBufferSource();
  const dryGain = ctx.createGain();
  drySource.buffer = sourceBuffer;
  drySource.playbackRate.setValueAtTime(rate, when);
  dryGain.gain.setValueAtTime(sampleGain, when);
  dryGain.gain.setValueAtTime(0, handoffAt);
  drySource.connect(dryGain);
  dryGain.connect(audio.sfxBus);

  const loopSource = ctx.createBufferSource();
  const loopGain = ctx.createGain();
  loopSource.buffer = sustain.buffer;
  loopSource.loop = true;
  loopSource.playbackRate.setValueAtTime(rate, handoffAt);
  loopGain.gain.setValueAtTime(sampleGain, handoffAt);
  loopSource.connect(loopGain);
  loopGain.connect(audio.sfxBus);

  const voice = {
    id: ++voiceSerial,
    name,
    rate,
    sampleGain,
    when,
    handoffAt,
    visualEndAt: when + 0.28,
    sourceBuffer,
    sustain,
    drySource,
    dryGain,
    loopSource,
    loopGain,
    tailSource: null,
    tailGain: null,
    tailEndAt: 0,
    rateTimeline: [{ time: handoffAt, rate }],
    held: true,
    claimed: false,
    released: false,
    stopped: false,
    cleaned: false,
    mode: 'pending',
    cleanupTimer: 0,
  };

  liveVoices.add(voice);
  drySource.onended = () => {
    if (voice.mode === 'short') cleanupVoice(voice);
  };

  drySource.start(when);
  loopSource.start(handoffAt, sustain.attackOffset);
  return voice;
}

function texturePositionAt(voice, now) {
  const start = voice.handoffAt;
  if (now <= start) return voice.sustain.attackOffset;

  let position = voice.sustain.attackOffset;
  let cursor = start;
  let rate = voice.rateTimeline[0].rate;
  for (let i = 1; i < voice.rateTimeline.length; i++) {
    const event = voice.rateTimeline[i];
    if (event.time >= now) break;
    position += (event.time - cursor) * rate;
    cursor = event.time;
    rate = event.rate;
  }
  return position + (now - cursor) * rate;
}

function textureRateAt(voice, now) {
  let rate = voice.rateTimeline[0].rate;
  for (let i = 1; i < voice.rateTimeline.length; i++) {
    const event = voice.rateTimeline[i];
    if (event.time > now) break;
    rate = event.rate;
  }
  return rate;
}

function isRetunableSustainVoice(voice) {
  return Boolean(
    voice &&
    (
      voice.name === 'jiao' ||
      voice.name === 'mi' ||
      voice.name === 'dingdongji_ji' ||
      voice.name === 'villager_hmmm'
    ) &&
    voice.mode === 'sustain' &&
    voice.held &&
    !voice.released &&
    !voice.stopped &&
    !voice.cleaned
  );
}

function retuneSustainVoice(voice, rate, when) {
  if (!isRetunableSustainVoice(voice)) return false;

  const now = audio.ctx.currentTime;
  const changeAt = Math.max(now, voice.handoffAt, when ?? now);
  const playbackRate = voice.loopSource.playbackRate;
  playbackRate.cancelScheduledValues(changeAt);
  playbackRate.setValueAtTime(rate, changeAt);

  voice.rateTimeline = voice.rateTimeline.filter(event => event.time < changeAt);
  voice.rateTimeline.push({ time: changeAt, rate });
  voice.rate = rate;
  return true;
}

function nextTextureRelease(voice, now) {
  const sustain = voice.sustain;
  const duration = sustain.buffer.duration;
  const absolutePosition = texturePositionAt(voice, now);
  const rate = textureRateAt(voice, now);
  const minimumPosition =
    absolutePosition + config.RELEASE_SCHEDULE_LEAD * rate;
  let best = null;

  for (const point of sustain.releasePoints) {
    const turns = Math.max(
      0,
      Math.ceil((minimumPosition - point.textureOffset) / duration - 1e-7)
    );
    const targetPosition = point.textureOffset + turns * duration;
    if (!best || targetPosition < best.targetPosition) {
      best = { ...point, targetPosition };
    }
  }

  if (!best) throw new Error('Sustain texture has no release point');
  return {
    boundary: now + (best.targetPosition - absolutePosition) / rate,
    sourceOffset: best.sourceOffset,
  };
}

function claimSustainVoice(voice) {
  if (!voice || !voice.held || voice.released || voice.claimed) return;

  const previous = activeSustainVoice;
  if (previous && previous !== voice) releaseVoice(previous, true);

  voice.claimed = true;
  voice.mode = 'sustain';
  activeSustainVoice = voice;
  hooks.lockMouth(voice);
}

function updateSustainClaims(audioNow) {
  const due = [];
  for (const voice of liveVoices) {
    if (
      voice.held &&
      !voice.released &&
      !voice.claimed &&
      audioNow + config.SUSTAIN_CLAIM_LEAD >= voice.handoffAt
    ) {
      due.push(voice);
    }
  }

  due.sort((a, b) => a.id - b.id);
  for (const voice of due) claimSustainVoice(voice);
}

function releaseVoice(voice, musical = true) {
  if (!voice || voice.released || voice.stopped || voice.cleaned) return;

  const now = audio.ctx.currentTime;
  voice.held = false;
  voice.released = true;

  if (activeSustainVoice === voice) activeSustainVoice = null;

  if (!musical) {
    forceStopVoice(voice);
    return;
  }

  if (now < voice.handoffAt) {
    voice.mode = 'short';
    voice.dryGain.gain.cancelScheduledValues(now);
    voice.dryGain.gain.setValueAtTime(voice.sampleGain, now);
    safeStop(voice.loopSource, now);

    if (state.mouthVoice === voice) {
      const remainMs = Math.max(0, (voice.visualEndAt - now) * 1000);
      hooks.unlockMouth(voice, remainMs);
    }
    return;
  }

  voice.mode = 'tail';
  const releaseRate = textureRateAt(voice, now);
  voice.loopSource.playbackRate.cancelScheduledValues(now);
  voice.loopSource.playbackRate.setValueAtTime(releaseRate, now);
  voice.rateTimeline = voice.rateTimeline.filter(event => event.time <= now);
  voice.rate = releaseRate;
  const release = nextTextureRelease(voice, now);

  voice.loopGain.gain.setValueAtTime(0, release.boundary);
  safeStop(voice.loopSource, release.boundary + 0.01);
  createTailSource(voice, release.boundary, release.sourceOffset);

  const remainMs = Math.max(0, (voice.tailEndAt - now) * 1000);
  if (state.mouthVoice === voice) hooks.unlockMouth(voice, remainMs);
  else hooks.openMouth(remainMs);
}

function fadeGain(gainNode, now, stopAt) {
  if (!gainNode) return;
  const param = gainNode.gain;
  const value = Math.max(0, param.value);
  param.cancelScheduledValues(now);
  param.setValueAtTime(value, now);
  param.linearRampToValueAtTime(0, stopAt);
}

function forceStopVoice(voice) {
  if (!voice || voice.stopped || voice.cleaned) return;

  const now = audio.ctx.currentTime;
  const stopAt = now + config.EMERGENCY_FADE;
  voice.held = false;
  voice.released = true;
  voice.stopped = true;
  voice.mode = 'stopped';

  if (activeSustainVoice === voice) activeSustainVoice = null;
  fadeGain(voice.dryGain, now, stopAt);
  fadeGain(voice.loopGain, now, stopAt);
  fadeGain(voice.tailGain, now, stopAt);
  safeStop(voice.drySource, stopAt);
  safeStop(voice.loopSource, stopAt);
  safeStop(voice.tailSource, stopAt);

  if (state.mouthVoice === voice) hooks.unlockMouth(voice, config.EMERGENCY_FADE * 1000);
  voice.cleanupTimer = setTimeout(
    () => cleanupVoice(voice),
    (config.EMERGENCY_FADE + 0.05) * 1000
  );
}

function stopAllVoices() {
  for (const voice of [...liveVoices]) forceStopVoice(voice);
}

/* ---------- 调度器 ---------- */
function quantize(unit) {
  const now = audio.ctx.currentTime;
  const k = Math.ceil((now + 0.02 - state.startTime) / unit);
  let t = state.startTime + k * unit;
  if (t < now) t += unit;
  return t;
}

function scheduler() {
  const horizon = audio.ctx.currentTime + config.INPUT_LOOKAHEAD;
  while (state.nextNoteTime < horizon) {
    scheduleStep(state.stepCount, state.nextNoteTime);
    state.nextNoteTime += S16;
    state.stepCount = (state.stepCount + 1) % 64;
  }
  scheduleQueuedInputs(audio.ctx.currentTime + config.INPUT_QUEUE_LOOKAHEAD);
}

function scheduleStep(s, t) {
  if (synth.enabled) {
    synth.scheduleStep(s, t);
  } else if (bgmLoopBuffer) {
    // 合成不可用：4 小节 loop 由循环 BufferSource 播放（startOnce）
  }
}

function startBgmLoop() {
  if (synth.enabled || !bgmLoopBuffer) return;
  // 再进入时先停掉旧循环源，避免双份 BGM
  if (bgmLoopSource) {
    safeStop(bgmLoopSource);
    try { bgmLoopSource.disconnect(); } catch (_) { }
    bgmLoopSource = null;
  }
  const source = audio.ctx.createBufferSource();
  source.buffer = bgmLoopBuffer;
  source.loop = true;
  source.connect(audio.bgmBus);
  bgmLoopSource = source;
  source.start(state.startTime);
}

/* ---------- 点击量化队列 ---------- */
function resolveSfxSample(sample, sfxId) {
  const id = sfxId ?? state.selectedSfxId;
  return config.SFX_SAMPLE_SETS[id]?.[sample] ?? sample;
}

function reflowQueuedInputTimes() {
  if (!state.performanceSettings.rhythmSnap) {
    const now = audio ? audio.ctx?.currentTime ?? 0 : 0;
    for (const entry of state.inputQueue) entry.when = now;
    return;
  }

  let when = quantize(S8);
  if (Number.isFinite(state.lastCommittedInputTime)) {
    when = Math.max(when, state.lastCommittedInputTime + S8);
  }
  for (const entry of state.inputQueue) {
    entry.when = when;
    when += S8;
  }
}

function removeQueuedSample(sample) {
  if (!state.performanceSettings.rhythmSnap) return;
  for (let i = state.inputQueue.length - 1; i >= 0; i--) {
    const entry = state.inputQueue[i];
    if (entry.sample !== sample) continue;

    state.inputQueue.splice(i, 1);
    const pointerState = state.pointers.get(entry.pointerId);
    if (pointerState && pointerState.pendingEntryId === entry.id) {
      pointerState.pendingEntryId = null;
    }
  }
}

function enqueueActivation(zi, pointerId) {
  hooks.hideControlsUntilIdle();
  const z = state.zones[zi];
  removeQueuedSample(z.sample);
  const entry = {
    id: ++state.inputSerial,
    kind: 'press',
    pointerId,
    zone: zi,
    sample: z.sample,
    audioSample: resolveSfxSample(z.sample),
    sfxId: state.selectedSfxId,
    pitchTier: z.pitchTier,
    targetMidi: z.targetMidi,
    pianoOctaveStart: z.pianoOctaveStart,
    when: 0,
  };
  state.inputQueue.push(entry);
  reflowQueuedInputTimes();
  hooks.flashZone(zi);
  return entry;
}

function enqueueSustainRetune(zi, pointerId, voice) {
  hooks.hideControlsUntilIdle();
  const z = state.zones[zi];
  removeQueuedSample(z.sample);
  const entry = {
    id: ++state.inputSerial,
    kind: 'sustain-retune',
    pointerId,
    zone: zi,
    sample: z.sample,
    audioSample: voice?.name ?? resolveSfxSample(z.sample),
    sfxId: state.selectedSfxId,
    pitchTier: z.pitchTier,
    targetMidi: z.targetMidi,
    pianoOctaveStart: z.pianoOctaveStart,
    voice,
    when: 0,
  };
  state.inputQueue.push(entry);
  reflowQueuedInputTimes();
  hooks.flashZone(zi);
  return entry;
}

function commitUnsnappedInput(entry) {
  if (state.performanceSettings.rhythmSnap) return;
  const queuedIndex = state.inputQueue.indexOf(entry);
  if (queuedIndex >= 0) state.inputQueue.splice(queuedIndex, 1);
  entry.when = audio.ctx.currentTime;
  state.lastCommittedInputTime = entry.when;
  playQueuedInput(entry);
}

function scheduleActivationVisual(zi, when, sfxId) {
  const waitMs = Math.max(0, (when - audio.ctx.currentTime) * 1000);
  const visualGeneration = state.inputVisualGeneration;
  const timer = setTimeout(() => {
    state.inputVisualTimers.delete(timer);
    if (visualGeneration !== state.inputVisualGeneration) return;
    hooks.openMouth(280);
    hooks.barkKick();
    hooks.spawnEffect(zi, audio.ctx.currentTime);
    hooks.villagerHit(zi, sfxId ?? state.selectedSfxId);
  }, waitMs);
  state.inputVisualTimers.add(timer);
}

function playQueuedInput(entry) {
  const audioSample = entry.audioSample ?? resolveSfxSample(entry.sample);
  const rate = barkPlaybackRate(
    audioSample,
    entry.pitchTier,
    entry.targetMidi,
    entry.pianoOctaveStart,
  );
  if (entry.kind === 'sustain-retune') {
    if (retuneSustainVoice(entry.voice, rate, entry.when)) {
      scheduleActivationVisual(entry.zone, entry.when, entry.sfxId);
    }
    return;
  }

  const pointerState = state.pointers.get(entry.pointerId);
  const stillHeld =
    pointerState &&
    pointerState.zone === entry.zone &&
    pointerState.pendingEntryId === entry.id;
  const voice = playPressVoice(audioSample, rate, entry.when);

  if (stillHeld) {
    pointerState.pendingEntryId = null;
    pointerState.voice = voice;
  } else if (voice) {
    releaseVoice(voice, true);
  }
  scheduleActivationVisual(entry.zone, entry.when, entry.sfxId);
}

function scheduleQueuedInputs(horizon) {
  while (state.inputQueue.length && state.inputQueue[0].when < horizon) {
    const entry = state.inputQueue.shift();
    state.lastCommittedInputTime = entry.when;
    playQueuedInput(entry);
  }
}

function cancelQueuedInputs(pointerId) {
  for (let i = state.inputQueue.length - 1; i >= 0; i--) {
    if (state.inputQueue[i].pointerId === pointerId) state.inputQueue.splice(i, 1);
  }
  reflowQueuedInputTimes();
}

function clearInputVisualTimers() {
  state.inputVisualGeneration++;
  for (const timer of state.inputVisualTimers) clearTimeout(timer);
  state.inputVisualTimers.clear();
}

function clearQueuedPerformanceInput() {
  state.inputQueue.length = 0;
  state.lastCommittedInputTime = -Infinity;
  clearInputVisualTimers();
  for (const pointerState of state.pointers.values()) pointerState.pendingEntryId = null;
}

function settleActivePerformanceInput() {
  clearQueuedPerformanceInput();
  for (const inputId of [...state.pointers.keys()]) hooks.endInput(inputId, true);
}

module.exports = {
  init, getAudio, loadSamples, tryLoadBgmLoop, startBgmLoop,
  barkPlaybackRate, resolveSfxSample,
  playPressVoice, releaseVoice, forceStopVoice, stopAllVoices,
  retuneSustainVoice, isRetunableSustainVoice,
  updateSustainClaims, scheduler, quantize,
  enqueueActivation, enqueueSustainRetune, commitUnsnappedInput,
  cancelQueuedInputs, clearInputVisualTimers, clearQueuedPerformanceInput,
  settleActivePerformanceInput, reflowQueuedInputTimes,
};
