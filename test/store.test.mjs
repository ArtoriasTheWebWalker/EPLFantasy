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

/* --- Editing after a deadline belongs to the NEXT gameweek ------------
   FPL keeps calling a gameweek "current" for days after its deadline.
   Editing in that window used to snapshot over the finished week's
   record, and the Performance page showed today's squad as if it were
   what you fielded. editableGW() is what every team-sheet write uses. */
const HOUR = 3600e3;
Store.currentGW = 4;

/* before the deadline: still editing GW4 */
Store.deadlines = { 4: Date.now() + HOUR, 5: Date.now() + 100 * HOUR };
assert.equal(Store.deadlinePassed(4), false);
assert.equal(Store.editableGW(), 4, 'before the deadline, edits are for GW4');

/* after it: edits are for GW5, and GW4 is now history */
Store.deadlines = { 4: Date.now() - HOUR, 5: Date.now() + 100 * HOUR };
assert.equal(Store.deadlinePassed(4), true);
assert.equal(Store.editableGW(), 5, 'after the deadline, edits are for GW5');

/* a snapshot must land on GW5 and leave the GW4 record untouched */
Store.squad = [
  { id: 201, teamId: 1, pos: 'GK',  price: 4.5, outGW: null, start: true },
  { id: 202, teamId: 2, pos: 'DEF', price: 4.5, outGW: null, start: true },
  { id: 203, teamId: 3, pos: 'DEF', price: 4.5, outGW: null, start: false },
];
Store.lineups = { 4: { memberIds: [201, 202], starterIds: [201, 202] } };
Store.persistSquad();
assert.deepEqual(Store.lineups[4].starterIds, [201, 202], 'GW4 record must survive an edit');
assert.ok(Store.lineups[5], 'the edit is snapshotted into GW5');
assert.deepEqual(Store.lineups[5].starterIds, [201, 202]);
assert.deepEqual(Store.lineups[5].memberIds, [201, 202, 203]);

/* unknown deadlines (offline boot) fall back to the old behaviour */
Store.deadlines = {};
assert.equal(Store.editableGW(), 4, 'no deadline data -> fall back to currentGW');

/* the armband follows the same rule */
Store.deadlines = { 4: Date.now() - HOUR };
Store.captains = {}; Store.vices = {};
Store.setCaptain(202);
assert.equal(Store.captains[5], 202, 'captain set with no gw targets the editable gameweek');
assert.equal(Store.captains[4], undefined, 'and never the finished one');

/* --- A played gameweek is never re-snapshotted, even with no deadlines -
   The belt to editableGW()'s braces: a cached or offline boot has no
   deadline map, so editableGW() falls back to currentGW and would aim
   straight at the finished week. This is what actually corrupted GW4. */
Store.deadlines = {};                 // the dangerous case
Store.currentGW = 4;
Store.captains = {}; Store.vices = {};
/* the working XI must DIFFER from the stored snapshot, or an overwrite
   would be invisible and the test would pass without the guard */
Store.squad = [
  { id: 301, teamId: 1, pos: 'GK',  price: 4.5, outGW: null, start: true,
    history: [{ gw: 4, points: 6 }] },                       // GW4 was played
  { id: 302, teamId: 2, pos: 'DEF', price: 4.5, outGW: null, start: false, history: [] },
  { id: 303, teamId: 3, pos: 'DEF', price: 4.5, outGW: null, start: true,  history: [] },
];
Store.gwHistory = {};
/* GW4 was fielded with 302; today's XI has 303 instead — the exact
   shape of the real bug (Konsa/Botman replaced by Egan/Davis) */
Store.lineups = { 4: { memberIds: [301, 302], starterIds: [301, 302] } };

assert.equal(Store.editableGW(), 4, 'no deadlines -> aims at the finished week');
assert.equal(Store.hasBeenPlayed(4), true, 'player history proves GW4 was played');
Store.persistSquad();
assert.deepEqual(Store.lineups[4].starterIds, [301, 302],
  'a played gameweek survives even when editableGW() points at it');

/* the official totals are the other signal, for a squad with no history */
Store.squad.forEach(p => p.history = []);
Store.gwHistory = { 4: { points: 54 } };
assert.equal(Store.hasBeenPlayed(4), true, 'gwHistory alone is enough');
Store.persistSquad();
assert.deepEqual(Store.lineups[4].starterIds, [301, 302], 'still protected');

/* an unplayed week is still writable, or planning would be impossible */
Store.gwHistory = {};
assert.equal(Store.hasBeenPlayed(6), false);
Store.currentGW = 6;
Store.persistSquad();
assert.deepEqual(Store.lineups[6].starterIds, [301, 303], 'a future week snapshots normally');

/* --- Grading blend: a cheaper player scoring the same rate as a
   pricier one now grades better, since the plan (see the Grading
   System note) was three metrics — raw points, points-vs-position-
   average, and value — folded together instead of ratio alone. -----*/
{
  Store.posAvg = { 10: { MID: 4 } };
  const cheap     = { pos:'MID', price:4.5, history:[{ gw:10, points:6 }] };
  const expensive = { pos:'MID', price:12,  history:[{ gw:10, points:6 }] };

  const gCheap = Store.gradeGW(cheap, 10);
  const gExp   = Store.gradeGW(expensive, 10);

  assert.equal(gCheap.ratio, 1.5, 'plain position ratio is unaffected by price');
  assert.equal(gExp.ratio, 1.5, 'same plain ratio for the pricier player');
  assert.ok(gCheap.blended > gExp.blended,
    'the cheaper player grades higher once value is folded in, even at an identical ratio');
  assert.equal(Store.valueRatioFor(1.5, 6), 1.5, 'a £6m player at ratio 1.5 has an identical value ratio — the reference price');
}

/* --- Auto-substitution: fills blanks in bench order, formation rules
   permitting — the correction FPL itself applies that gwPointsFor was
   not making before. Three things checked at once: the goalkeeper only
   swaps with the bench goalkeeper, a bench player who also blanked is
   skipped, and a swap that would break the formation minimum is
   refused even though a later bench player can still help elsewhere. */
{
  const AUTOSUB_GW = 50;
  const withMin = (id, pos, price, minutes) => ({
    id, pos, price, teamId: 1, name: `P${id}`, outGW: null, start: false,
    history: [{ gw: AUTOSUB_GW, points: minutes > 0 ? 3 : 0, minutes }],
  });

  Store.squad = [
    withMin(1, 'GK', 4.5, 0),    // starting GK — blanks
    withMin(2, 'GK', 4.0, 90),   // bench GK — played, should come on

    withMin(3, 'DEF', 5, 0),     // starting DEF — blanks
    withMin(4, 'DEF', 5, 0),     // starting DEF — also blanks
    withMin(5, 'DEF', 5, 90),
    withMin(6, 'DEF', 4.5, 90),  // bench DEF, order 1 — played, covers id 3
    /* no second bench DEF, so id 4 stays blanked — nobody legal to replace him */

    withMin(11, 'MID', 6, 90),
    withMin(12, 'MID', 6, 90),
    withMin(13, 'MID', 6, 0),    // starting MID — blanks
    withMin(14, 'MID', 6, 90),
    withMin(15, 'MID', 5.5, 90), // bench MID, order 2 — played, would drop DEF below 3 if used on a DEF gap → only legal for the MID gap

    withMin(21, 'FWD', 7, 90),
    withMin(22, 'FWD', 7, 90),
    withMin(23, 'FWD', 7, 90),
    withMin(24, 'FWD', 5, 0),    // bench FWD, order 0 (first) — also 0 minutes, can't help anyone
  ];

  Store.lineups = {
    [AUTOSUB_GW]: {
      memberIds:  [1,2,3,4,5,6,11,12,13,14,15,21,22,23,24],
      /* bench order (after the 11 starters) is 24 (FWD, blank), 6 (DEF),
         15 (MID) — GK 2 is separately the bench keeper */
      starterIds: [1,3,4,5,11,12,13,14,21,22,23],
    },
  };

  const xi = Store.autoSubStarters(AUTOSUB_GW);
  const ids = xi.map(p => p.id).sort((a,b)=>a-b);

  assert.ok(ids.includes(2) && !ids.includes(1), 'blanking GK is replaced by the bench GK');
  assert.ok(ids.includes(6) && !ids.includes(3), 'DEF gap filled by the bench defender');
  assert.ok(ids.includes(4), 'the second blanking DEF has nobody legal to replace him and stays');
  assert.ok(ids.includes(15) && !ids.includes(13), 'MID gap filled by the bench midfielder');
  assert.ok(!ids.includes(24), 'a bench player who also blanked never comes on');
  assert.equal(xi.length, 11, 'still exactly 11 after substitution');

  const counts = { GK:0, DEF:0, MID:0, FWD:0 };
  xi.forEach(p => counts[p.pos]++);
  assert.deepEqual(counts, { GK:1, DEF:3, MID:4, FWD:3 }, 'formation stays legal throughout');

  /* Bench Boost skips auto-sub entirely — every bench player already
     counts in full, so there's nothing to correct */
  Store.chips = { [AUTOSUB_GW]: 'bboost' };
  Store.captains = {}; Store.vices = {};
  Store.gwHistory = {};
  const bbTotal = Store.gwPointsFor(AUTOSUB_GW);
  const rawTotal = [...Store.squad].reduce((s,p) => s + (Store.pointsIn(p, AUTOSUB_GW) ?? 0), 0);
  assert.equal(bbTotal, rawTotal, 'Bench Boost totals every player as-is, auto-sub or not');
}

/* --- Free transfers: banks one per gameweek crossed (capped at 5),
   a real transfer spends one immediately, and a wildcard/free-hit
   week neither costs one nor banks an extra one. ------------------- */
{
  Store.freeTransfers = 1;
  Store.freeTransfersSeenGW = 5;
  Store.chips = {};

  Store.advanceFreeTransfers(8);   // crosses GW6, GW7
  assert.equal(Store.freeTransfers, 3, 'two ordinary gameweeks crossed, two banked');
  assert.equal(Store.freeTransfersSeenGW, 7);

  Store.advanceFreeTransfers(8);   // nothing new to cross
  assert.equal(Store.freeTransfers, 3, 're-checking the same point banks nothing twice');

  Store.freeTransfers = 4;
  Store.chips = { 9: 'wildcard' };
  Store.freeTransfersSeenGW = 8;
  Store.advanceFreeTransfers(10);  // crosses GW9, a wildcard week
  assert.equal(Store.freeTransfers, 4, 'a wildcard gameweek does not bank an extra free transfer');

  Store.freeTransfers = 5;
  Store.freeTransfersSeenGW = 30;
  Store.advanceFreeTransfers(34);
  assert.equal(Store.freeTransfers, 5, 'the bank is capped at 5');

  /* a real transfer spends one immediately */
  Store.freeTransfers = 2;
  Store.chips = {};
  Store.squad = [
    { id: 401, teamId: 1, pos: 'MID', price: 6, outGW: null, start: true },
  ];
  Store.currentGW = 10; Store.deadlines = {};
  const budgetMid = { id: 402, name: 'Sub', team: 'X', teamId: 2, pos: 'MID', price: 6 };
  const r = Store.transfer(401, budgetMid, 10);
  assert.ok(r.ok, 'transfer succeeds');
  assert.equal(Store.freeTransfers, 1, 'making a transfer spends exactly one banked free transfer');

  /* a wildcard transfer costs nothing */
  Store.freeTransfers = 1;
  Store.chips = { 11: 'wildcard' };
  Store.squad = [
    { id: 403, teamId: 1, pos: 'FWD', price: 7, outGW: null, start: true },
  ];
  const budgetFwd = { id: 404, name: 'Sub2', team: 'Y', teamId: 3, pos: 'FWD', price: 7 };
  const r2 = Store.transfer(403, budgetFwd, 11);
  assert.ok(r2.ok);
  assert.equal(Store.freeTransfers, 1, 'a transfer under an active wildcard does not spend a free transfer');
}

console.log('ok — 64 assertions passed');
