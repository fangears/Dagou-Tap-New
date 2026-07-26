#!/usr/bin/env node

// Executes the production villager-hit helpers from main.js inside a tiny
// deterministic DOM/timer harness. This keeps timing and lifecycle assertions
// tied to the shipped implementation instead of a duplicate test model.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const toolsDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(toolsDir);
const mainSource = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');

function extractFunction(name) {
  const start = mainSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Cannot find function ${name} in main.js`);
  const bodyStart = mainSource.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < mainSource.length; index++) {
    if (mainSource[index] === '{') depth++;
    if (mainSource[index] === '}') {
      depth--;
      if (depth === 0) return mainSource.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed function ${name} in main.js`);
}

function extractConst(name) {
  const match = mainSource.match(
    new RegExp(`const ${name} = [^;]+;`),
  );
  if (!match) throw new Error(`Cannot find constant ${name} in main.js`);
  return match[0];
}

function assertCallsInOrder(source, calls, label) {
  let cursor = -1;
  for (const call of calls) {
    const next = source.indexOf(call, cursor + 1);
    assert.ok(next > cursor, `${label} must call ${call} in lifecycle order`);
    cursor = next;
  }
}

const productionFunctions = [
  'clearVillagerHitParticles',
  'resetVillagerHitState',
  'spawnVillagerHitParticles',
  'triggerVillagerHit',
  'commitUnsnappedInput',
  'scheduleActivationVisual',
  'isRetunableSustainVoice',
  'retuneSustainVoice',
  'playQueuedInput',
  'clearInputVisualTimers',
].map(extractFunction).join('\n\n');

const productionConstants = [
  'BARK_KICK',
  'BARK_KICK_MAX',
  'VILLAGER_COMBO_RESET_MS',
  'VILLAGER_PARTICLE_COUNT',
].map(extractConst).join('\n');

function makeHarness(reduceMotion = false) {
  const sandbox = {};
  vm.runInNewContext(
    `
    class FakeClassList {
      constructor() { this.values = new Set(); }
      add(...names) { for (const name of names) this.values.add(name); }
      remove(...names) { for (const name of names) this.values.delete(name); }
      contains(name) { return this.values.has(name); }
      toggle(name, force) {
        const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
        if (enabled) this.values.add(name);
        else this.values.delete(name);
        return enabled;
      }
    }

    class FakeStyle {
      constructor() { this.values = new Map(); }
      setProperty(name, value) { this.values.set(name, String(value)); }
      removeProperty(name) { this.values.delete(name); }
      getPropertyValue(name) { return this.values.get(name) ?? ''; }
    }

    class FakeElement {
      constructor() {
        this.classList = new FakeClassList();
        this.style = new FakeStyle();
        this.children = [];
        this.hidden = false;
        this.textContent = '';
        this.offsetWidth = 240;
      }
      appendChild(child) { this.children.push(child); return child; }
      replaceChildren(...children) { this.children = [...children]; }
      addEventListener(type, callback, options) {
        this.listener = { type, callback, options };
      }
    }

    let fakeNowMs = 0;
    let nextTimerId = 1;
    const pendingTimers = new Map();
    const timerHistory = new Map();
    function setTimeout(callback, delay = 0) {
      const id = nextTimerId++;
      const normalizedDelay = Math.max(0, Number(delay) || 0);
      const record = {
        id,
        callback,
        delay: normalizedDelay,
        due: fakeNowMs + normalizedDelay,
      };
      pendingTimers.set(id, record);
      timerHistory.set(id, record);
      return id;
    }
    function clearTimeout(id) {
      pendingTimers.delete(id);
    }

    const ctx = { currentTime: 0 };
    function advanceTimers(milliseconds) {
      const target = fakeNowMs + milliseconds;
      while (true) {
        let next = null;
        for (const record of pendingTimers.values()) {
          if (record.due > target) continue;
          if (!next || record.due < next.due || (
            record.due === next.due && record.id < next.id
          )) next = record;
        }
        if (!next) break;
        ctx.currentTime += (next.due - fakeNowMs) / 1000;
        fakeNowMs = next.due;
        pendingTimers.delete(next.id);
        next.callback();
      }
      ctx.currentTime += (target - fakeNowMs) / 1000;
      fakeNowMs = target;
    }

    const document = {
      createElement() { return new FakeElement(); },
    };
    const dogHit = new FakeElement();
    const villagerHitParticles = new FakeElement();
    const villagerHitComboEl = new FakeElement();
    villagerHitComboEl.hidden = true;

    ${productionConstants}
    const reduceUiMotion = ${reduceMotion};
    let cols = 4;
    let selectedSfxId = 'villager';
    let sfxMuted = false;
    let villagerHitCombo = 0;
    let villagerHitStartedAt = -Infinity;
    let villagerHitDirection = 1;
    let villagerHitStrength = 0;
    let villagerHitResetTimer = 0;
    let villagerHitFadeTimer = 0;
    let villagerHitGeneration = 0;
    const inputVisualTimers = new Set();
    let inputVisualGeneration = 0;
    let barkPopVel = 0;
    const performanceSettings = { rhythmSnap: true };
    const inputQueue = [];
    let lastCommittedInputTime = -Infinity;
    const pointers = new Map();
    const visualEvents = [];

    function nowSec() { return ctx.currentTime; }
    function getStageMetrics() { return { width: 400, height: 300 }; }
    function openMouth(holdMs) {
      visualEvents.push({ type: 'mouth', holdMs, muted: sfxMuted });
    }
    function spawnEffect(zone, when) {
      visualEvents.push({ type: 'effect', zone, when });
    }
    function resolveSfxSample(sample) { return sample; }
    function barkPlaybackRate() { return 1; }
    function playPressVoice(sample, rate, when) {
      visualEvents.push({ type: 'press-audio', sample, rate, when });
      return null;
    }
    function releaseVoice() {}

    ${productionFunctions}

    function makeSustainVoice(valid) {
      const rateEvents = [];
      return {
        name: 'villager_hmmm',
        mode: 'sustain',
        held: valid,
        released: false,
        stopped: false,
        cleaned: false,
        handoffAt: ctx.currentTime,
        rate: 1,
        rateTimeline: [],
        loopSource: {
          playbackRate: {
            cancelScheduledValues(time) {
              rateEvents.push({ type: 'cancel', time });
            },
            setValueAtTime(value, time) {
              rateEvents.push({ type: 'set', value, time });
            },
          },
        },
        rateEvents,
      };
    }

    function state() {
      return {
        now: ctx.currentTime,
        combo: villagerHitCombo,
        strength: villagerHitStrength,
        direction: villagerHitDirection,
        hitGeneration: villagerHitGeneration,
        visualGeneration: inputVisualGeneration,
        comboHidden: villagerHitComboEl.hidden,
        comboText: villagerHitComboEl.textContent,
        comboClasses: [...villagerHitComboEl.classList.values],
        hitClasses: [...dogHit.classList.values],
        hitOffset: dogHit.style.getPropertyValue('--villager-hit-offset'),
        particleCount: villagerHitParticles.children.length,
        visualEvents: visualEvents.map(event => ({ ...event })),
        pendingTimers: [...pendingTimers.values()].map(record => ({
          id: record.id,
          delay: record.delay,
          dueIn: record.due - fakeNowMs,
        })),
        lastCommittedInputTime,
      };
    }

    globalThis.hitApi = {
      state,
      setTime(seconds) { ctx.currentTime = seconds; },
      setSelected(sfxId) { selectedSfxId = sfxId; },
      setMuted(muted) { sfxMuted = muted; },
      schedule: scheduleActivationVisual,
      trigger: triggerVillagerHit,
      reset: resetVillagerHitState,
      clearVisual: clearInputVisualTimers,
      advance: advanceTimers,
      invokeHistoricalTimer(id) {
        const timer = timerHistory.get(id);
        if (!timer) throw new Error('Unknown historical timer ' + id);
        timer.callback();
      },
      timerRecord(id) {
        const timer = timerHistory.get(id);
        return timer ? { id: timer.id, delay: timer.delay, due: timer.due } : null;
      },
      commitFreePress(zone, sfxId) {
        performanceSettings.rhythmSnap = false;
        const entry = {
          id: 1,
          kind: 'press',
          pointerId: 99,
          zone,
          sample: 'villager_hm',
          audioSample: 'villager_hm',
          sfxId,
          pitchTier: 0,
          when: -1,
        };
        inputQueue.push(entry);
        commitUnsnappedInput(entry);
        return {
          when: entry.when,
          queueLength: inputQueue.length,
          committedAt: lastCommittedInputTime,
        };
      },
      playSustainRetune(valid, zone, when, sfxId) {
        const voice = makeSustainVoice(valid);
        playQueuedInput({
          kind: 'sustain-retune',
          voice,
          zone,
          when,
          sfxId,
          audioSample: 'villager_hmmm',
          pitchTier: 0,
        });
        return {
          rate: voice.rate,
          rateTimeline: voice.rateTimeline.map(event => ({ ...event })),
          rateEvents: voice.rateEvents.map(event => ({ ...event })),
        };
      },
    };
    `,
    sandbox,
  );
  return sandbox.hitApi;
}

const snapshot = api => JSON.parse(JSON.stringify(api.state()));

// Quantized visuals must wait for the audio timestamp, and muting the SFX bus
// must not suppress the villager's visual feedback.
{
  const api = makeHarness();
  api.setTime(10);
  api.setMuted(true);
  api.schedule(0, 10.25, 'villager');
  const scheduled = snapshot(api);
  assert.equal(scheduled.combo, 0);
  assert.equal(scheduled.pendingTimers.length, 1);
  assert.equal(scheduled.pendingTimers[0].delay, 250);
  api.advance(249);
  assert.equal(snapshot(api).combo, 0, 'a snapped hit must not render early');
  api.advance(1);
  const fired = snapshot(api);
  assert.equal(fired.combo, 1, 'the hit must render at the scheduled audio time');
  assert.equal(fired.comboText, 'HIT ×1');
  assert.equal(fired.particleCount, 8);
  assert.equal(fired.visualEvents[0].muted, true);
  assert.deepEqual(
    fired.visualEvents.map(event => event.type),
    ['mouth', 'effect'],
  );
}

// Free rhythm commits at ctx.currentTime and therefore creates a zero-delay
// visual timer rather than inheriting the snapped queue's future time.
{
  const api = makeHarness();
  api.setTime(4.2);
  const committed = api.commitFreePress(3, 'villager');
  assert.deepEqual(
    JSON.parse(JSON.stringify(committed)),
    { when: 4.2, queueLength: 0, committedAt: 4.2 },
  );
  const queued = snapshot(api);
  assert.equal(queued.combo, 0);
  const visualTimer = queued.pendingTimers.find(timer => timer.delay === 0);
  assert.ok(visualTimer, 'free rhythm must schedule its visual with zero delay');
  api.advance(0);
  assert.equal(snapshot(api).combo, 1);
}

// Both the queued sound identity and the currently selected sound set must be
// villager. This also proves that sfxMuted is intentionally not a hit gate.
{
  const api = makeHarness();
  api.setSelected('hajimi');
  api.trigger(0, 'villager');
  assert.equal(snapshot(api).combo, 0);
  api.setSelected('villager');
  api.trigger(0, 'hajimi');
  assert.equal(snapshot(api).combo, 0);
  api.setMuted(true);
  api.trigger(0, 'villager');
  assert.equal(snapshot(api).combo, 1);
}

// Left-side input knocks right and right-side input knocks left. The displayed
// combo is unbounded while only animation strength saturates at eight.
{
  const api = makeHarness();
  api.trigger(0, 'villager');
  let state = snapshot(api);
  assert.equal(state.direction, 1);
  assert.ok(Number.parseFloat(state.hitOffset) > 0);
  assert.equal(state.hitClasses.includes('is-hit-from-right'), false);

  api.reset();
  api.trigger(3, 'villager');
  state = snapshot(api);
  assert.equal(state.direction, -1);
  assert.ok(Number.parseFloat(state.hitOffset) < 0);
  assert.equal(state.hitClasses.includes('is-hit-from-right'), true);

  api.reset();
  for (let count = 0; count < 10; count++) api.trigger(0, 'villager');
  state = snapshot(api);
  assert.equal(state.combo, 10);
  assert.equal(state.comboText, 'HIT ×10');
  assert.equal(state.strength, 8);
}

// A later hit invalidates the earlier reset callback. The current generation
// then fades after 1.2 seconds and hides after the production fade interval.
{
  const api = makeHarness();
  api.trigger(0, 'villager');
  const oldResetId = snapshot(api).pendingTimers[0].id;
  api.advance(500);
  api.trigger(1, 'villager');
  assert.equal(snapshot(api).combo, 2);
  api.invokeHistoricalTimer(oldResetId);
  assert.equal(
    snapshot(api).combo,
    2,
    'a stale reset callback must not clear the newer combo generation',
  );
  api.advance(1199);
  assert.equal(snapshot(api).combo, 2);
  api.advance(1);
  let state = snapshot(api);
  assert.equal(state.combo, 0);
  assert.equal(state.comboHidden, false);
  assert.equal(state.comboClasses.includes('is-fading'), true);
  api.advance(179);
  assert.equal(snapshot(api).comboHidden, false);
  api.advance(1);
  state = snapshot(api);
  assert.equal(state.comboHidden, true);
  assert.equal(state.comboText, 'HIT ×0');
}

// Reduced-motion mode keeps the useful combo feedback without emitting debris.
{
  const api = makeHarness(true);
  api.trigger(2, 'villager');
  const state = snapshot(api);
  assert.equal(state.combo, 1);
  assert.equal(state.comboHidden, false);
  assert.equal(state.particleCount, 0);
}

// clearInputVisualTimers must remain safe even if a host delivers a callback
// that was already cleared: the captured generation makes it a no-op.
{
  const api = makeHarness();
  api.setTime(2);
  api.schedule(0, 2.5, 'villager');
  const timerId = snapshot(api).pendingTimers[0].id;
  const generationBefore = snapshot(api).visualGeneration;
  api.clearVisual();
  assert.equal(snapshot(api).visualGeneration, generationBefore + 1);
  assert.equal(snapshot(api).pendingTimers.length, 0);
  api.invokeHistoricalTimer(timerId);
  const state = snapshot(api);
  assert.equal(state.combo, 0);
  assert.equal(state.visualEvents.length, 0);
}

// Sustain retunes get hit feedback only when the real retune helper accepts the
// existing live voice.
{
  const api = makeHarness();
  api.setTime(7);
  api.playSustainRetune(false, 1, 7.1, 'villager');
  assert.equal(snapshot(api).pendingTimers.length, 0);
  const accepted = api.playSustainRetune(true, 1, 7.1, 'villager');
  assert.equal(accepted.rateTimeline.length, 1);
  assert.equal(snapshot(api).pendingTimers.length, 1);
  api.advance(99);
  assert.equal(snapshot(api).combo, 0);
  api.advance(1);
  assert.equal(snapshot(api).combo, 1);
}

// Reset itself clears all visible hit state and timers.
{
  const api = makeHarness();
  api.trigger(0, 'villager');
  assert.equal(snapshot(api).particleCount, 8);
  api.reset();
  const state = snapshot(api);
  assert.equal(state.combo, 0);
  assert.equal(state.strength, 0);
  assert.equal(state.comboHidden, true);
  assert.equal(state.comboText, 'HIT ×0');
  assert.equal(state.particleCount, 0);
  assert.equal(state.hitClasses.length, 0);
  assert.equal(state.hitOffset, '');
  assert.equal(state.pendingTimers.length, 0);
}

// Performance resets, sound-set changes, and window blur all have to cancel
// pending visuals and invalidate the active combo before stale work can render.
const clearQueueSource = extractFunction('clearQueuedPerformanceInput');
assertCallsInOrder(
  clearQueueSource,
  ['inputQueue.length = 0', 'lastCommittedInputTime = -Infinity', 'clearInputVisualTimers()'],
  'performance input cleanup',
);

const selectSfxSource = extractFunction('selectSfxOption');
assertCallsInOrder(
  selectSfxSource,
  [
    'settleActivePerformanceInput()',
    'forceStopVoice(voice)',
    'resetVillagerHitState()',
    'selectedSfxId = nextSfxId',
  ],
  'sound-set switching',
);

const blurStart = mainSource.indexOf("window.addEventListener('blur'");
const blurEnd = mainSource.indexOf(
  "window.addEventListener('contextmenu'",
  blurStart,
);
assert.ok(blurStart >= 0 && blurEnd > blurStart, 'cannot find the window blur handler');
assertCallsInOrder(
  mainSource.slice(blurStart, blurEnd),
  [
    'inputQueue.length = 0',
    'clearInputVisualTimers()',
    'resetVillagerHitState()',
    'pointers.clear()',
    'forceStopVoice(voice)',
  ],
  'window blur cleanup',
);

console.log('Villager hit flow verified:');
console.log('- snapped visuals fire at the audio timestamp; free rhythm uses zero delay');
console.log('- only the selected villager set counts hits, even while SFX is muted');
console.log('- each hit emits eight particles and left/right zones choose opposite knockback');
console.log('- combo text is unbounded, visual strength caps at eight, and reset waits 1.2s');
console.log('- stale hit and input-visual timers cannot clear or render a newer generation');
console.log('- reduced motion keeps combo text without particles');
console.log('- sound switching, performance reset, and blur clear queued visual state');
console.log('- sustain retunes render a hit only after a successful live-voice retune');
