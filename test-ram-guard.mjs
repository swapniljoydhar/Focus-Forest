import assert from 'node:assert/strict';
import { resolvePerfMode, sampleMemoryPressure, applyPerfMode } from './shared/ram-guard.js';

const base = { ramGuard: true, ramGuardLevel: 3 };

// Opt-out: the guardian never degrades when the user disabled it, even under
// maximal measured pressure.
assert.equal(resolvePerfMode({ ramGuard: false, ramGuardLevel: 5 }, { deviceGb: 0.25, heapRatio: 0.99 }), 'normal', 'opt-out must win over every pressure signal');

// No evidence, no degradation.
assert.equal(resolvePerfMode(base, {}), 'normal');
assert.equal(resolvePerfMode(base, { deviceGb: null, heapRatio: null }), 'normal');
assert.equal(resolvePerfMode(null, { deviceGb: 0.25 }), 'normal', 'missing settings must not degrade');

// Device-class floors per sensitivity level.
assert.equal(resolvePerfMode(base, { deviceGb: 1 }), 'reduced', 'a 1 GB device is at the level-3 floor');
assert.equal(resolvePerfMode(base, { deviceGb: 2 }), 'normal');
assert.equal(resolvePerfMode({ ramGuard: true, ramGuardLevel: 5 }, { deviceGb: 4 }), 'reduced');
assert.equal(resolvePerfMode({ ramGuard: true, ramGuardLevel: 1 }, { deviceGb: 1 }), 'normal', 'level 1 only guards the smallest devices');

// Own-heap pressure per sensitivity level.
assert.equal(resolvePerfMode(base, { heapRatio: 0.75 }), 'reduced');
assert.equal(resolvePerfMode(base, { heapRatio: 0.65 }), 'normal');
assert.equal(resolvePerfMode({ ramGuard: true, ramGuardLevel: 5 }, { heapRatio: 0.55 }), 'reduced');
assert.equal(resolvePerfMode({ ramGuard: true, ramGuardLevel: 1 }, { heapRatio: 0.85 }), 'normal');

// A reduced-motion preference always calms decorations.
assert.equal(resolvePerfMode(base, {}, true), 'reduced');

// Hostile or missing levels clamp instead of throwing.
assert.equal(resolvePerfMode({ ramGuard: true, ramGuardLevel: 'x' }, { heapRatio: 0.75 }), 'reduced', 'a non-numeric level falls back to 3');
assert.equal(resolvePerfMode({ ramGuard: true, ramGuardLevel: 99 }, { deviceGb: 4 }), 'reduced', 'level clamps to 5');
assert.equal(resolvePerfMode({ ramGuard: true, ramGuardLevel: -3 }, { deviceGb: 0.5 }), 'normal', 'level clamps to 1');

// Sampling never throws in Node and reports honest nulls for absent signals.
const sample = sampleMemoryPressure();
assert.equal(sample.deviceGb, null, 'Node exposes no navigator.deviceMemory');
assert.equal('heapRatio' in sample, true);

// applyPerfMode survives the absence of a DOM.
applyPerfMode('reduced');
applyPerfMode('normal');

console.log('ram-guard tests passed');
