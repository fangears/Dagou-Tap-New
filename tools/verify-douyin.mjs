'use strict';
/* 移植逻辑校验：在 Node 端直接 require src 模块断言关键行为。
 * 用法：node tools/verify-douyin.mjs */
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../src/config.js');

/* 说明：各区块断言失败会直接抛出并使脚本非零退出；
 * 脚本完整跑完即代表所有移植逻辑与预期一致。 */

console.log('[1] base64 解码（对照 atob 语义）');
{
  const { b64ToArrayBuffer } = require('../src/utils.js');
  // 'SGVsbG8=' => "Hello"
  const bytes = new Uint8Array(b64ToArrayBuffer('SGVsbG8='));
  assert.deepStrictEqual([...bytes], [72, 101, 108, 108, 111]);
  // WAV 头前 4 字节必须是 RIFF
  const AUDIO_B64 = require('../src/audio-data.js');
  const head = new Uint8Array(b64ToArrayBuffer(AUDIO_B64.da).slice(0, 4));
  assert.strictEqual(Buffer.from(head).toString('ascii'), 'RIFF');
  // 12 个样本齐全且都是非空 RIFF
  for (const [key, value] of Object.entries(AUDIO_B64)) {
    const h = Buffer.from(new Uint8Array(b64ToArrayBuffer(value).slice(0, 4))).toString('ascii');
    assert.strictEqual(h, 'RIFF', `样本 ${key} 不是 WAV`);
  }
}

console.log('[2] 网格构建：普通竖屏 3×4 与钢琴模式 3×8');
{
  const state = require('../src/state.js');
  const grid = require('../src/grid.js');
  state.metrics = { width: 390, height: 844, left: 0, top: 0 };
  state.performanceSettings = { ...config.DEFAULT_PERFORMANCE_SETTINGS };
  grid.buildGrid();
  assert.strictEqual(state.cols, 3);
  assert.strictEqual(state.rows, 4);
  assert.strictEqual(state.zones.length, 12);
  assert.strictEqual(state.zones[0].sample, 'da');
  assert.strictEqual(state.zones[1].sample, 'gou');
  assert.strictEqual(state.zones[2].sample, 'jiao');
  assert.strictEqual(state.zones[0].pitchTier, 0);
  assert.strictEqual(state.zones[3].pitchTier, 1);

  state.performanceSettings.pianoMode = true;
  grid.buildGrid();
  assert.strictEqual(state.cols, 3);
  assert.strictEqual(state.rows, 8);
  assert.strictEqual(state.zones.length, 24);
  // 竖屏钢琴：第一行是最高音（高音 do）
  assert.strictEqual(state.zones[0].note, 'C5');
  assert.strictEqual(state.zones[21].note, 'C4');
}

console.log('[3] 线段跨格补全 zonesAlongSegment');
{
  const grid2 = require('../src/grid.js');
  const state2 = require('../src/state.js');
  state2.metrics = { width: 300, height: 400, left: 0, top: 0 };
  state2.performanceSettings = { ...config.DEFAULT_PERFORMANCE_SETTINGS };
  grid2.buildGrid();
  // 横穿一整行：经过 3 格
  const row = grid2.zonesAlongSegment(10, 60, 290, 60);
  assert.strictEqual(row.length, 3, `横穿一行应经过 3 格，实际 ${row.length}`);
  // 原地不动：只 1 格
  const still = grid2.zonesAlongSegment(150, 200, 150, 200);
  assert.strictEqual(still.length, 1);
  // 对角线：至少 3 格（min(cols,rows)）
  const diag = grid2.zonesAlongSegment(5, 5, 295, 395);
  assert.ok(diag.length >= 3, `对角线至少 3 格，实际 ${diag.length}`);
  // zoneIndex 与补全首格一致
  assert.strictEqual(diag[0], grid2.zoneIndex(5, 5));
}

console.log('[4] 变调表：与网页版 playbackRate 一致');
{
  const audioEngine = require('../src/audio-engine.js');
  const rate1 = audioEngine.barkPlaybackRate('da', 0, undefined, undefined);
  assert.ok(Math.abs(rate1 - Math.pow(2, (79 - 71.1950846771) / 12)) < 1e-12);
  const rate2 = audioEngine.barkPlaybackRate('ha', 3, undefined, undefined);
  assert.ok(Math.abs(rate2 - Math.pow(2, (72 - 72.732) / 12)) < 1e-12); // 普通模式锚点
  const rate3 = audioEngine.barkPlaybackRate('mi', 0, 60, 5);
  assert.ok(Math.abs(rate3 - Math.pow(2, (60 - 65.60141325112846) / 12)) < 1e-12); // 钢琴锚点
}

console.log('[5] 乐理：钢琴音阶生成');
{
  const music = require('../src/music.js');
  const scale = music.buildPianoScale(4);
  assert.strictEqual(scale.length, 8);
  assert.strictEqual(scale[0].midi, 60);
  assert.strictEqual(scale[7].midi, 72);
  assert.strictEqual(scale[0].note, 'C4');
  assert.strictEqual(scale[7].note, 'C5');
  assert.strictEqual(music.normalizePianoOctaveStart(9), 4);
  assert.strictEqual(music.normalizePianoOctaveStart(2), 4);
}

console.log('[6] 配置完整性');
{
  const config2 = require('../src/config.js');
  assert.strictEqual(Object.keys(config2.SFX_SAMPLE_SETS).length, 4);
  assert.strictEqual(config2.RUNTIME_SAMPLE_NAMES.length, 12);
  assert.strictEqual(config2.EFFECTS.length, 12);
  assert.strictEqual(config2.LOCKED_SFX_IDS.size, 0, '抖音版应全部解锁');
  for (const set of Object.values(config2.CHARACTER_IMAGE_SETS)) {
    assert.ok(set.close.startsWith('assets/img/'));
  }
  assert.ok(config2.HAJIMI_ATLAS_PATH.startsWith('packages/emperor/'));
}

console.log('全部断言通过 ✓');
