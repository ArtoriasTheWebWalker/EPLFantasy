/* Run: node test/performance.test.mjs

   Guards Performance.optimalXI — the exhaustive formation search behind
   the "points left on the bench" review. Cross-checked against an
   independent brute-force calculation over the same synthetic squad,
   so this isn't just testing the implementation against itself. */

import assert from 'node:assert/strict';

/* performance.js imports ui.js, which touches `document` only inside
   functions (never at module load time), so it's safe to import under
   node — store.js still needs the same localStorage/window stubs as
   the other test file, since Performance imports Store. */
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
globalThis.CustomEvent = class { constructor(t, o){ this.type = t; Object.assign(this, o); } };
globalThis.window = { dispatchEvent(){}, addEventListener(){} };

const { default: Performance } = await import('../js/performance.js');
const { Store } = await import('../js/store.js');

/* a squad with an obvious best XI: strong DEF and MID, weak FWD, so
   the optimum should lean toward a defensive shape rather than the
   naive "always play as many forwards as possible" */
const squad = [
  { id:1, pos:'GK',  history:[{ gw:1, points:10 }] },
  { id:2, pos:'GK',  history:[{ gw:1, points:2  }] },

  { id:3, pos:'DEF', history:[{ gw:1, points:8 }] },
  { id:4, pos:'DEF', history:[{ gw:1, points:1 }] },
  { id:5, pos:'DEF', history:[{ gw:1, points:6 }] },
  { id:6, pos:'DEF', history:[{ gw:1, points:0 }] },
  { id:7, pos:'DEF', history:[{ gw:1, points:9 }] },

  { id:8,  pos:'MID', history:[{ gw:1, points:15 }] },
  { id:9,  pos:'MID', history:[{ gw:1, points:12 }] },
  { id:10, pos:'MID', history:[{ gw:1, points:3  }] },
  { id:11, pos:'MID', history:[{ gw:1, points:2  }] },
  { id:12, pos:'MID', history:[{ gw:1, points:1  }] },

  { id:13, pos:'FWD', history:[{ gw:1, points:20 }] },
  { id:14, pos:'FWD', history:[{ gw:1, points:1  }] },
  { id:15, pos:'FWD', history:[{ gw:1, points:0  }] },
];

/* independent brute-force reference: try every legal (d,m,f) shape,
   take the top scorers per position, keep the best total */
function bruteForceOptimal(squad, gw){
  const byPos = pos => squad
    .filter(p => p.pos === pos)
    .map(p => Store.pointsIn(p, gw) ?? 0)
    .sort((a,b) => b - a);

  const gks = byPos('GK'), defs = byPos('DEF'), mids = byPos('MID'), fwds = byPos('FWD');
  const sumTop = (arr, n) => arr.slice(0, n).reduce((a,b) => a+b, 0);

  let best = -1, shape = null;
  for(let d = 3; d <= 5; d++){
    for(let m = 2; m <= 5; m++){
      const f = 10 - d - m;
      if(f < 1 || f > 3) continue;
      if(d > defs.length || m > mids.length || f > fwds.length) continue;
      const total = sumTop(defs, d) + sumTop(mids, m) + sumTop(fwds, f);
      if(total > best){ best = total; shape = `${d}-${m}-${f}`; }
    }
  }
  return { points: gks[0] + best, shape };
}

const got      = Performance.optimalXI(squad, 1);
const expected = bruteForceOptimal(squad, 1);

assert.equal(got.points, expected.points, 'optimalXI must match an independent brute-force search');
assert.equal(got.shape, expected.shape, 'and pick the same formation shape');
assert.equal(got.points, 87, 'GK best (10) plus the highest-scoring legal outfield combination (77, shape 3-5-2)');
assert.equal(got.shape, '3-5-2');

/* a squad with exactly enough outfielders to fill 10 slots in only one
   way — 5 DEF, 2 MID, 3 FWD is the sole shape that fits both the
   available counts and the 1-3 forward rule, so the search space
   collapses to one option and it must still work */
const tightSquad = [
  { id:20, pos:'GK', history:[{ gw:1, points:5 }] },
  { id:21, pos:'GK', history:[{ gw:1, points:1 }] },
  ...[22,23,24,25,26].map(id => ({ id, pos:'DEF', history:[{ gw:1, points:4 }] })),
  ...[27,28].map(id => ({ id, pos:'MID', history:[{ gw:1, points:4 }] })),
  ...[29,30,31].map(id => ({ id, pos:'FWD', history:[{ gw:1, points:4 }] })),
];
const tight = Performance.optimalXI(tightSquad, 1);
assert.equal(tight.shape, '5-2-3', 'with exactly enough players and no more, only one shape is legal at all');
assert.equal(tight.points, 5 + 4*5 + 4*2 + 4*3, 'sums every available outfield player once the shape is forced');

console.log('ok — 6 assertions passed');
