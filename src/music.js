'use strict';
/* ============================================================
 * 乐理辅助：钢琴模式八度 / 音阶（供网格、音频、UI 共用）
 * 函数均为纯函数，settings 由调用方显式传入。
 * ==========================================================*/
const config = require('./config.js');

function normalizePianoOctaveStart(value) {
  const octave = Number(value);
  return Number.isInteger(octave) &&
    octave >= config.PIANO_OCTAVE_MIN &&
    octave <= config.PIANO_OCTAVE_MAX
    ? octave
    : config.PIANO_DEFAULT_OCTAVE_START;
}

function effectivePianoOctaveStart(settings) {
  const s = settings;
  return s.pianoMode && s.octaveSwitching
    ? normalizePianoOctaveStart(s.pianoOctaveStart)
    : config.PIANO_DEFAULT_OCTAVE_START;
}

function octaveControlsEnabled(settings) {
  const s = settings;
  return s.pianoMode && s.octaveSwitching;
}

function buildPianoScale(octaveStart) {
  const octave = normalizePianoOctaveStart(octaveStart);
  const baseMidi = (octave + 1) * 12;
  return config.PIANO_SCALE_INTERVALS.map((interval, index) => Object.freeze({
    midi: baseMidi + interval,
    note: `${config.PIANO_SCALE_NOTES[index]}${index === 7 ? octave + 1 : octave}`,
    solfege: config.PIANO_SCALE_SOLFEGE[index],
  }));
}

module.exports = {
  normalizePianoOctaveStart, effectivePianoOctaveStart, octaveControlsEnabled,
  buildPianoScale,
};
