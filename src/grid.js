'use strict';
/* ============================================================
 * 分区网格（纯逻辑分区，坐标全部来自 state.metrics）
 * ==========================================================*/
const config = require('./config.js');
const state = require('./state.js');
const music = require('./music.js');

function buildGrid() {
  const { width, height } = state.metrics;
  const landscape = width >= height;
  const settings = state.performanceSettings;
  const pianoScale = settings.pianoMode
    ? music.buildPianoScale(music.effectivePianoOctaveStart(settings))
    : null;

  state.cols = landscape ? (settings.pianoMode ? 8 : 4) : 3;
  state.rows = landscape ? 3 : (settings.pianoMode ? 8 : 4);

  const zones = [];
  if (landscape) {
    // 横屏：纵向依次 da / gou / jiao；钢琴模式横向 do 到高音 do。
    const rowMap = [{ n: 'da', s: '大' }, { n: 'gou', s: '狗' }, { n: 'jiao', s: '叫' }];
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        const pianoKey = pianoScale?.[c] ?? null;
        zones.push({
          sample: rowMap[r].n,
          syllable: rowMap[r].s,
          pitchTier: c,
          targetMidi: pianoKey?.midi,
          pianoOctaveStart: pianoKey ? music.effectivePianoOctaveStart(settings) : undefined,
          note: pianoKey?.note,
          solfege: pianoKey?.solfege,
        });
      }
    }
  } else {
    // 竖屏：横向依次 da / gou / jiao；钢琴模式纵向从高音 do 降到 do。
    const colMap = [{ n: 'da', s: '大' }, { n: 'gou', s: '狗' }, { n: 'jiao', s: '叫' }];
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        const pianoIndex = settings.pianoMode
          ? pianoScale.length - 1 - r
          : r;
        const pianoKey = pianoScale?.[pianoIndex] ?? null;
        zones.push({
          sample: colMap[c].n,
          syllable: colMap[c].s,
          pitchTier: pianoIndex,
          targetMidi: pianoKey?.midi,
          pianoOctaveStart: pianoKey ? music.effectivePianoOctaveStart(settings) : undefined,
          note: pianoKey?.note,
          solfege: pianoKey?.solfege,
        });
      }
    }
  }
  state.zones = zones;
}

function zoneIndex(x, y) {
  const { width, height, left, top } = state.metrics;
  const localX = x - left;
  const localY = y - top;
  const c = Math.min(state.cols - 1, Math.max(0, Math.floor(localX / width * state.cols)));
  const r = Math.min(state.rows - 1, Math.max(0, Math.floor(localY / height * state.rows)));
  return r * state.cols + c;
}

/* 返回一条指针线段实际穿过的全部格子，避免快速滑动时只上报首尾格。 */
function zonesAlongSegment(x0, y0, x1, y1) {
  const { width, height, left, top } = state.metrics;
  const cols = state.cols;
  const rows = state.rows;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const times = [0, 1];

  if (Math.abs(dx) > 1e-7) {
    for (let c = 1; c < cols; c++) {
      const t = (left + width * c / cols - x0) / dx;
      if (t > 0 && t < 1) times.push(t);
    }
  }
  if (Math.abs(dy) > 1e-7) {
    for (let r = 1; r < rows; r++) {
      const t = (top + height * r / rows - y0) / dy;
      if (t > 0 && t < 1) times.push(t);
    }
  }

  times.sort((a, b) => a - b);
  const uniqueTimes = times.filter(
    (t, i) => i === 0 || Math.abs(t - times[i - 1]) > 1e-7
  );
  const result = [];
  const appendAt = (t) => {
    const zi = zoneIndex(x0 + dx * t, y0 + dy * t);
    if (result[result.length - 1] !== zi) result.push(zi);
  };

  appendAt(0);
  for (let i = 1; i < uniqueTimes.length; i++) {
    appendAt((uniqueTimes[i - 1] + uniqueTimes[i]) / 2);
  }
  appendAt(1);
  return result;
}

module.exports = { buildGrid, zoneIndex, zonesAlongSegment };
