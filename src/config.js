'use strict';
/* ============================================================
 * 大狗嚼 —— 常量配置（移植自网页版 main.js，去除 B 站相关内容）
 * ==========================================================*/

/* ---------- 节奏常量 ---------- */
const BPM = 128;
const SPB = 60 / BPM;
const S16 = SPB / 4;
const S8 = SPB / 2;
const MASTER_GAIN = 0.85;
const PIANO_OCTAVE_MIN = 3;
const PIANO_OCTAVE_MAX = 6;
const PIANO_DEFAULT_OCTAVE_START = 4;
const DEFAULT_PERFORMANCE_SETTINGS = Object.freeze({
  pianoMode: false,
  octaveSwitching: false,
  pianoOctaveStart: PIANO_DEFAULT_OCTAVE_START,
  rhythmSnap: true,
  showGrid: false,
});

/* ---------- 音色映射 ---------- */
const SFX_SAMPLE_SETS = Object.freeze({
  dagou: Object.freeze({ da: 'da', gou: 'gou', jiao: 'jiao' }),
  hajimi: Object.freeze({ da: 'ha', gou: 'ji', jiao: 'mi' }),
  dingdong: Object.freeze({
    da: 'dingdongji_ding',
    gou: 'dingdongji_dong',
    jiao: 'dingdongji_ji',
  }),
  villager: Object.freeze({
    da: 'villager_hm',
    gou: 'villager_ha',
    jiao: 'villager_hmmm',
  }),
});
const RUNTIME_SAMPLE_NAMES = Object.freeze(
  [...new Set(Object.values(SFX_SAMPLE_SETS).flatMap(Object.values))]
);

const CHAR_IMAGE_DIR = 'assets/img/';
const CHARACTER_IMAGE_SETS = Object.freeze({
  dagou: Object.freeze({
    close: CHAR_IMAGE_DIR + 'dagou_close_mouth.png',
    open: CHAR_IMAGE_DIR + 'dagou_open_mouth.png',
    alt: '大狗',
  }),
  dingdong: Object.freeze({
    close: CHAR_IMAGE_DIR + 'dingdongji_close_mouth.png',
    open: CHAR_IMAGE_DIR + 'dingdongji_open_mouth.png',
    alt: '叮咚鸡',
  }),
  hajimi: Object.freeze({
    close: CHAR_IMAGE_DIR + 'maodie_close_mouth.png',
    open: CHAR_IMAGE_DIR + 'maodie_open_mouth.png',
    alt: '哈基米',
  }),
  villager: Object.freeze({
    close: CHAR_IMAGE_DIR + 'villager_close_mouth.png',
    open: CHAR_IMAGE_DIR + 'villager_open_mouth.png',
    alt: '方块村民',
  }),
});
const TINT_DIR = 'assets/img/tint/';

const HAJIMI_ATLAS_PATH = 'packages/emperor/donghaidihuang_atlas.webp';
const HAJIMI_STATIC_ICON_PATH = CHAR_IMAGE_DIR + 'maodie_close_mouth.png';
const HAJIMI_ANIMATION_ICON_PATH = CHAR_IMAGE_DIR + 'donghaidihuang_icon.png';
const HAJIMI_ANIMATION_BEATS = 9;
const HAJIMI_FRAMES_PER_BEAT = 12;
const HAJIMI_ATLAS_COLUMNS = 12;
/* 图集帧为原始 360×514 的 50% 降采样（180×257）：
 * 显示宽度约 182 CSS 像素，1:1 无损视觉；GPU 纹理显存从约 80MB 降到 20MB */
const HAJIMI_ATLAS_FRAME_WIDTH = 180;
const HAJIMI_ATLAS_FRAME_HEIGHT = 257;
const HAJIMI_ANIMATION_FRAME_COUNT =
  HAJIMI_ANIMATION_BEATS * HAJIMI_FRAMES_PER_BEAT;

/* ---------- 本地存储键（网页版为 B 站 toy 云存储，键名沿用） ---------- */
const STORAGE_KEYS = Object.freeze({
  sfxUnlocked: 'dagou_sfx_unlocked_v1',
  settingsSeen: 'dagou_settings_seen_v1',
  dingdongNewSeen: 'dagou_dingdong_new_seen_v1',
  hajimiNewSeen: 'dagou_hajimi_new_seen_v1',
  villagerNewSeen: 'dagou_villager_new_seen_v1',
  pianoMode: 'dagou_piano_mode_v1',
  octaveSwitching: 'dagou_octave_switching_v1',
  pianoOctaveStart: 'dagou_piano_octave_start_v1',
  rhythmSnap: 'dagou_rhythm_snap_v1',
  showGrid: 'dagou_show_grid_v1',
});

const SFX_LABELS = Object.freeze({
  dagou: '大狗叫',
  dingdong: '叮咚鸡',
  hajimi: '哈基米',
  villager: '方块村民',
});
const NEW_ITEM_IDS = new Set(['dingdong', 'hajimi', 'villager']);
const SFX_NEW_ITEM_IDS = new Set(['dingdong', 'villager']);
/* 抖音版 MVP：全部角色与皮肤直接解锁 */
const LOCKED_SFX_IDS = new Set([]);

/* ---------- 延音（WSOLA）参数 ---------- */
const SUSTAIN_REGIONS = {
  da: {
    enabled: false,
    regionStart: 0.065, regionEnd: 0.168,
    frame: 0.052, overlap: 0.026, search: 0.007,
    wrapBlend: 0.040, textureDuration: 7.31, seed: 0.17,
  },
  gou: {
    enabled: false,
    regionStart: 0.055, regionEnd: 0.140,
    frame: 0.048, overlap: 0.024, search: 0.006,
    wrapBlend: 0.036, textureDuration: 7.73, seed: 0.43,
  },
  jiao: {
    enabled: true,
    regionStart: 0.125, regionEnd: 0.290,
    frame: 0.100, overlap: 0.050, search: 0.012,
    wrapBlend: 0.040, textureDuration: 12.37, seed: 0.71,
    preferFrameEntry: true,
  },
  mi: {
    enabled: true,
    regionStart: 0.245, regionEnd: 0.345,
    frame: 0.070, overlap: 0.035, search: 0.008,
    wrapBlend: 0.028, textureDuration: 12.11, seed: 0.29,
    preferFrameEntry: true,
  },
  dingdongji_ji: {
    enabled: true,
    regionStart: 0.120, regionEnd: 0.310,
    frame: 0.100, overlap: 0.050, search: 0.012,
    wrapBlend: 0.040, textureDuration: 11.83, seed: 0.53,
    preferFrameEntry: true,
  },
  villager_hmmm: {
    enabled: true,
    regionStart: 0.220, regionEnd: 0.520,
    frame: 0.080, overlap: 0.040, search: 0.010,
    wrapBlend: 0.030, textureDuration: 12.23, seed: 0.61,
    preferFrameEntry: true,
  },
};
const SUSTAIN_CLAIM_LEAD = 0.008;
const RELEASE_SCHEDULE_LEAD = 0.006;
const EMERGENCY_FADE = 0.018;

/* ---------- 音高校准表 ---------- */
const CHORDS = [
  { bass: 65.41, notes: [261.63, 329.63, 392.00, 523.25] }, // C
  { bass: 49.00, notes: [196.00, 246.94, 293.66, 392.00] }, // G
  { bass: 55.00, notes: [220.00, 261.63, 329.63, 440.00] }, // Am
  { bass: 43.65, notes: [174.61, 220.00, 261.63, 349.23] }, // F
];
const HAT_VEL = [0.34, 0.16, 0.42, 0.16];

const BARK_SOURCE_MIDI = Object.freeze({
  da: 71.1950846771,
  gou: 65.5950930881,
  jiao: 71.1226079346,
  ha: 72.6652936920031,
  ji: 67.55506219280217,
  mi: 65.47641325112846,
  dingdongji_ding: 68.72369809072657,
  dingdongji_dong: 68.20736701647688,
  dingdongji_ji: 69.48535473104747,
  villager_hm: 68.86757909447432,
  villager_ha: 68.75589316791971,
  villager_hmmm: 69.00081425407193,
});
const BARK_NORMAL_SOURCE_MIDI = Object.freeze({
  ha: 72.732,
});
const BARK_PIANO_SOURCE_MIDI = Object.freeze({
  mi: Object.freeze({
    5: 65.60141325112846,
    6: 65.17172575112846,
  }),
  dingdongji_ding: Object.freeze({
    3: 68.49322934072657,
    6: 68.86822934072657,
  }),
  dingdongji_ji: Object.freeze({
    6: 69.64941723104747,
  }),
});
const BARK_TARGET_MIDI = Object.freeze({
  da: Object.freeze([79, 76, 72, 69]),
  gou: Object.freeze([72, 69, 67, 64]),
  jiao: Object.freeze([79, 76, 72, 69]),
  ha: Object.freeze([81, 79, 76, 72]),
  ji: Object.freeze([74, 72, 69, 67]),
  mi: Object.freeze([72, 69, 67, 64]),
  dingdongji_ding: Object.freeze([74, 72, 69, 67]),
  dingdongji_dong: Object.freeze([74, 72, 69, 67]),
  dingdongji_ji: Object.freeze([74, 72, 69, 67]),
  villager_hm: Object.freeze([74, 72, 69, 67]),
  villager_ha: Object.freeze([74, 72, 69, 67]),
  villager_hmmm: Object.freeze([74, 72, 69, 67]),
});
const SFX_SAMPLE_GAIN = Object.freeze({
  da: 1.0000000000,
  gou: 1.012898017161218,
  jiao: 0.953577156471302,
  ha: 1.283378415934229,
  ji: 1.4777851484035351,
  mi: 1.4846115949156913,
  dingdongji_ding: 2.5889190244772604,
  dingdongji_dong: 2.3637451111911507,
  dingdongji_ji: 2.3501763429894065,
  villager_hm: 0.9323404285136571,
  villager_ha: 0.9923723668843711,
  villager_hmmm: 0.8749070275355995,
});

const PIANO_SCALE_INTERVALS = Object.freeze([0, 2, 4, 5, 7, 9, 11, 12]);
const PIANO_SCALE_NOTES = Object.freeze(['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C']);
const PIANO_SCALE_SOLFEGE = Object.freeze(['do', 're', 'mi', 'fa', 'sol', 'la', 'si', 'do']);

/* ---------- 调色板与特效 ---------- */
const C = {
  cream: '#fff2dc',
  amber: '#ffb400',
  gray: '#87837e',
  coral: '#ff5a5f',
  teal: '#16c2a3',
  blue: '#3e7bfa',
};
const ACCENTS = [C.coral, C.teal, C.blue];
const EFFECTS = [
  'rings', 'poly', 'spiral', 'rays', 'confetti', 'zigzag',
  'pop', 'cross', 'orbit', 'wave', 'stars', 'grid',
];

/* ---------- 布局 / 交互常量 ---------- */
const INPUT_LOOKAHEAD = 0.12;
const INPUT_QUEUE_LOOKAHEAD = 0.03;
const BARK_KICK = 5.2;
const BARK_KICK_MAX = 9;
const VILLAGER_COMBO_RESET_MS = 1200;
const VILLAGER_PARTICLE_COUNT = 8;
const CONTROLS_IDLE_MS = 2000;
const CONTROLS_HOVER_IDLE_MS = 250;
const TOAST_VISIBLE_MS = 4800;

/* 设置页文案：网页版显示 B 站云端同步状态，抖音版保存在本机 */
const SETTINGS_STATUS_SAVED = '设置已自动保存到本机';

module.exports = {
  BPM, SPB, S16, S8, MASTER_GAIN,
  PIANO_OCTAVE_MIN, PIANO_OCTAVE_MAX, PIANO_DEFAULT_OCTAVE_START,
  DEFAULT_PERFORMANCE_SETTINGS,
  SFX_SAMPLE_SETS, RUNTIME_SAMPLE_NAMES, CHARACTER_IMAGE_SETS, TINT_DIR,
  HAJIMI_ATLAS_PATH, HAJIMI_STATIC_ICON_PATH, HAJIMI_ANIMATION_ICON_PATH,
  HAJIMI_ANIMATION_BEATS, HAJIMI_FRAMES_PER_BEAT, HAJIMI_ATLAS_COLUMNS,
  HAJIMI_ATLAS_FRAME_WIDTH, HAJIMI_ATLAS_FRAME_HEIGHT, HAJIMI_ANIMATION_FRAME_COUNT,
  STORAGE_KEYS, SFX_LABELS, NEW_ITEM_IDS, SFX_NEW_ITEM_IDS, LOCKED_SFX_IDS,
  SUSTAIN_REGIONS, SUSTAIN_CLAIM_LEAD, RELEASE_SCHEDULE_LEAD, EMERGENCY_FADE,
  CHORDS, HAT_VEL,
  BARK_SOURCE_MIDI, BARK_NORMAL_SOURCE_MIDI, BARK_PIANO_SOURCE_MIDI,
  BARK_TARGET_MIDI, SFX_SAMPLE_GAIN,
  PIANO_SCALE_INTERVALS, PIANO_SCALE_NOTES, PIANO_SCALE_SOLFEGE,
  C, ACCENTS, EFFECTS,
  INPUT_LOOKAHEAD, INPUT_QUEUE_LOOKAHEAD,
  BARK_KICK, BARK_KICK_MAX,
  VILLAGER_COMBO_RESET_MS, VILLAGER_PARTICLE_COUNT,
  CONTROLS_IDLE_MS, CONTROLS_HOVER_IDLE_MS, TOAST_VISIBLE_MS,
  SETTINGS_STATUS_SAVED,
};
