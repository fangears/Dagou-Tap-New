'use strict';
/* ============================================================
 * 音频后端：创建 WebAudio 风格 AudioContext 并探测节点能力。
 * 抖音小游戏的 WebAudio 能力入口在不同基础库上命名不一，
 * 依次尝试已知入口；浏览器预览走标准 AudioContext。
 * ==========================================================*/
const config = require('./config.js');

function createPlatformAudioContext() {
  if (typeof tt !== 'undefined') {
    const factories = [
      'createWebAudioContext',
      'getWebAudioContext',
      'createAudioContext',
      'getAudioContext',
    ];
    for (const name of factories) {
      try {
        if (typeof tt[name] === 'function') {
          const ctx = tt[name]();
          if (ctx) return ctx;
        }
      } catch (_) { /* 尝试下一个入口 */ }
    }
    throw new Error('当前环境不支持 WebAudio');
  }
  return new (window.AudioContext || window.webkitAudioContext)();
}

function createAudioBackend() {
  const ctx = createPlatformAudioContext();

  const caps = {
    bufferSource: typeof ctx.createBufferSource === 'function',
    gain: typeof ctx.createGain === 'function',
    oscillator: typeof ctx.createOscillator === 'function',
    biquad: typeof ctx.createBiquadFilter === 'function',
    compressor: typeof ctx.createDynamicsCompressor === 'function',
    decode: typeof ctx.decodeAudioData === 'function',
    createBuffer: typeof ctx.createBuffer === 'function',
  };

  const master = ctx.createGain();
  master.gain.value = config.MASTER_GAIN;
  const bgmBus = ctx.createGain();
  bgmBus.gain.value = 1;
  const sfxBus = ctx.createGain();
  sfxBus.gain.value = 1;

  bgmBus.connect(master);
  sfxBus.connect(master);

  if (caps.compressor) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 24;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    master.connect(comp);
    comp.connect(ctx.destination);
  } else {
    master.connect(ctx.destination);
  }

  // 1 秒白噪声（鼓组用）
  let noiseBuf = null;
  if (caps.createBuffer) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function resume() {
    try {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        const result = ctx.resume();
        if (result && typeof result.then === 'function') return result;
      }
    } catch (_) { /* 某些实现 resume 不存在或已恢复 */ }
    return Promise.resolve();
  }

  function decodeAudioData(buffer) {
    return new Promise((resolve, reject) => {
      try {
        const maybe = ctx.decodeAudioData(buffer, resolve, reject);
        if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  return { ctx, caps, master, bgmBus, sfxBus, noiseBuf, resume, decodeAudioData };
}

module.exports = { createAudioBackend, createPlatformAudioContext };
