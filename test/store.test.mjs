/* Run: node test/store.test.mjs
   Guards the two scoring rules that fail silently on screen. */

import assert from 'node:assert/strict';

/* store.js reads localStorage and emits DOM events at import time */
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
globalThis.CustomEvent = class { constructor(t, o){ this.type = t; Object.assign(this, o); } };
globalThis.window = { dispatchEvent(){}, addEventListener(){} };

const { Store, isStartingPick } = await import('../js/store.js');

/* --- GW1 bug: Bench Boost put all 15 players on the pitch ---------------
   FPL pays the bench under Bench Boost, so every pick comes back with
   multiplier >= 1. Only `position` says who was actually in the XI. */
const benchBoostGW1 = Array.from({ length: 15 }, (_, i) => ({
  element: 100 + i,
  position: i + 1,
  multiplier: 1,          // what BB really returns for all 15
  isCaptain: i === 0,
  isVice: i === 1,
}));

const starters = benchBoostGW1.filter(isStartingPick);
assert.equal(starters.length, 11, 'Bench Boost week must still field 11, not 15');
assert.deepEqual(starters.map(p => p.position), [1,2,3,4,5,6,7,8,9,10,11]);

/* the old rule, kept here to show what it did */
assert.equal(benchBoostGW1.filter(p => p.multiplier > 0).length, 15);

/* a normal week: bench carries multiplier 0, both rules agree */
const normal = benchBoostGW1.map(p => ({ ...p, multiplier: p.position <= 11 ? 1 : 0 }));
assert.equal(normal.filter(isStartingPick).length, 11);

/* --- Triple Captain: one multiplier, used by every screen -------------- */
Store.chips = { 1: 'bboost', 2: '3xc', 3: 'freehit' };
assert.equal(Store.capMultFor(1), 2, 'Bench Boost does not change the armband');
assert.equal(Store.capMultFor(2), 3, 'Triple Captain is x3');
assert.equal(Store.capMultFor(3), 2);
assert.equal(Store.capMultFor(99), 2, 'no chip is x2');

console.log('ok — 8 assertions passed');
