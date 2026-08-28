'use strict';
/* ============================================================
 * 鼓组 / 贝斯 / 和弦 合成音色（移植自网页版）。
 * 若端上不支持振荡器/滤波器，audio-engine 会改用预渲染 loop
 * （assets/audio/bgm-loop.wav，用 tools/prerender-bgm 生成）。
 * ==========================================================*/
const config = require('./config.js');

function createSynth(audio) {
  const { ctx, bgmBus, noiseBuf, caps } = audio;
  const enabled = caps.oscillator && caps.biquad && caps.gain && caps.bufferSource;
  const S8 = config.S8;

  function kick(t) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.11);
    g.gain.setValueAtTime(0.95, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(g); g.connect(bgmBus);
    o.start(t); o.stop(t + 0.26);
  }

  function snare(t, vol = 0.5) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    n.connect(f); f.connect(g); g.connect(bgmBus);
    n.start(t); n.stop(t + 0.18);
    // 军鼓腔体
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(240, t);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(vol * 0.5, t);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    o.connect(g2); g2.connect(bgmBus);
    o.start(t); o.stop(t + 0.1);
  }

  function hat(t, vol, decay) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    n.connect(f); f.connect(g); g.connect(bgmBus);
    n.start(t); n.stop(t + decay + 0.02);
  }

  function crash(t) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 5000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    n.connect(f); f.connect(g); g.connect(bgmBus);
    n.start(t); n.stop(t + 1.3);
  }

  function stab(t, freqs) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    f.connect(g); g.connect(bgmBus);
    for (const fr of freqs) {
      for (const det of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = fr;
        o.detune.value = det;
        o.connect(f);
        o.start(t); o.stop(t + 0.3);
      }
    }
  }

  function bass(t, fr, vol) {
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.value = fr * 2;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + S8 * 0.9);
    o.connect(f); f.connect(g); g.connect(bgmBus);
    o.start(t); o.stop(t + S8);
  }

  function scheduleStep(s, t) {
    const bar = (s / 16) | 0;
    const pos = s % 16;
    const ch = config.CHORDS[bar];

    if (bar === 0 && pos === 0) crash(t);
    if (pos % 4 === 0) kick(t);
    if (pos === 4 || pos === 12) snare(t);
    if (bar === 3 && pos === 14) snare(t, 0.3);
    hat(t, config.HAT_VEL[pos % 4], pos === 14 ? 0.12 : 0.04);
    if (pos % 4 === 2) stab(t, ch.notes);
    if (pos % 2 === 0) bass(t, ch.bass, pos % 4 === 0 ? 0.4 : 0.26);
  }

  return { enabled, scheduleStep };
}

module.exports = { createSynth };
