/* Run: node test/store.test.mjs

   Guards the rules that fail silently — either on screen (a chip week
   that displays the wrong multiplier) or in the squad (a lineup or a
   club count that FPL would reject but the app happily accepted).
   Rule values are verified against the live engine's own config;
   see the FPL 2026/27 ruleset note in the vault. */

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

/* --- Club limit: max 3 from one real club, absolute -------------------- */
const arsenal = 1, chelsea = 2;
Store.squad = [
  { id: 1, teamId: arsenal, pos: 'DEF', price: 5, outGW: null, start: true },
  { id: 2, teamId: arsenal, pos: 'MID', price: 6, outGW: null, start: true },
  { id: 3, teamId: arsenal, pos: 'FWD', price: 7, outGW: null, start: true },
  { id: 4, teamId: chelsea, pos: 'DEF', price: 5, outGW: null, start: true },
  /* a transferred-out Arsenal player must NOT count against the limit */
  { id: 5, teamId: arsenal, pos: 'MID', price: 6, outGW: 3, start: false },
];

assert.equal(Store.countTeam(arsenal), 3, 'retired players do not occupy a club slot');
assert.ok(Store.teamLimitIssue({ id: 9, teamId: arsenal }), 'a 4th from one club is refused');
assert.equal(Store.teamLimitIssue({ id: 9, teamId: chelsea }), null, 'a 2nd from another club is fine');

/* transferring out an Arsenal player frees his slot for another */
assert.equal(
  Store.teamLimitIssue({ id: 9, teamId: arsenal }, { replacingId: 3 }), null,
  'the outgoing player frees his own club slot'
);

/* squadIssues warns but never blocks; budget only once the squad is full */
Store.teamById = {};
assert.ok(Store.squadIssues().every(s => typeof s === 'string'));

/* the real entry points must refuse too, not just the helper */
Store.teamById = {};
Store.currentGW = 4;
const fourthGunner = { id: 90, name: 'Fourth', team: 'ARS', teamId: arsenal, pos: 'DEF', price: 5.0 };
const add = Store.addPlayer(fourthGunner);
assert.equal(add.ok, false, 'addPlayer refuses a 4th from one club');
assert.match(add.reason, /maximum of 3 from one club/);

/* but the same player is fine when he replaces one of that club's own */
const swap = Store.transfer(1, fourthGunner, 4);
assert.equal(swap.ok, true, 'transfer in for a same-club player is allowed');

/* --- Chips: one of each per half, first set dies at GW19 --------------- */
Store.chips = {};
assert.equal(Store.chipHalf(1), 1);
assert.equal(Store.chipHalf(19), 1, 'GW19 is still the first half');
assert.equal(Store.chipHalf(20), 2, 'GW20 starts the second set');

assert.ok(Store.setChip(7, 'wildcard').ok, 'first wildcard of the half is allowed');
assert.equal(Store.setChip(12, 'wildcard').ok, false, 'a second wildcard in the same half is refused');
assert.ok(Store.setChip(25, 'wildcard').ok, 'the second half gets its own wildcard');
assert.ok(Store.setChip(7, 'wildcard').ok, 're-setting the same GW is not a clash with itself');
assert.ok(Store.setChip(9, 'bboost').ok, 'a different chip in the same half is fine');
assert.deepEqual(Store.chipsLeftIn(1).sort(), ['3xc', 'freehit'], 'two chips still unplayed in half 1');

console.log('ok — 25 assertions passed');
