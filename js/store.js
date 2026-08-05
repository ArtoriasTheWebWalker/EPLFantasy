/* =====================================================
   STORE — the single source of truth.

   Performance, Draft and Table all read and write here.
   Nothing is duplicated per page. Every mutation
   persists to localStorage and fires a 'store:change'
   event so any open page re-renders itself.
===================================================== */

import { CONFIG } from './config.js';

/* ---------- internal ---------- */

function load(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }catch{ return fallback; }
}

function save(key, value){
  try{ localStorage.setItem(key, JSON.stringify(value)); }catch{}
}

function emit(what){
  window.dispatchEvent(new CustomEvent('store:change', { detail:{ what } }));
}

/* =====================================================
   STATE

   squad:      [ SquadPlayer ]  — up to 15
   draft:      { [playerId]: { flag, note } }
   candidates: { [playerId]: { pos, note, targetGW, swapWith } }
   meta:       { currentGW, viewGW, seasonMode }
===================================================== */

const SquadShape = `
  {
    id, name, team, teamId, pos, price,
    start:  true|false,     // in the XI or on the bench
    cap:    true|false,     // captain
    vice:   true|false,     // vice-captain (2x if captain plays 0 mins)
    inGW:   null|number,    // gameweek he joined the squad
    history: [ { gw, points, ... } ]   // filled from the API
  }`;

export const Store = {

  SHAPE: SquadShape,

  squad     : load(CONFIG.STORE.squad, []),
  draft     : load(CONFIG.STORE.draft, {}),
  candidates: load(CONFIG.STORE.cands, {}),

  /* runtime only, not persisted */
  pool      : [],     // all FPL players, from API.bootstrap()
  teams     : [],
  teamById  : {},
  fixtures  : [],
  table     : [],
  posAvg    : {},     // { gw: {GK,DEF,MID,FWD} }
  currentGW : 1,
  viewGW    : 1,
  seasonMode: false,

  /* =================================================
     SQUAD
  ================================================= */

  countPos(pos){ return this.squad.filter(p=>p.pos===pos).length; },

  countStart(pos){ return this.squad.filter(p=>p.pos===pos && p.start).length; },

  /* Minimum starters per position for a legal FPL formation. */
  MIN_START: { GK:1, DEF:3, MID:2, FWD:1 },

  /* Should a newly added player of this position go straight
     into the XI? Yes if his position is still below its minimum,
     or if there is a spare outfield place going. */
  wouldStart(pos){
    if(pos === 'GK') return this.countStart('GK') < CONFIG.SQUAD.START_GK;

    if(this.countStart(pos) < this.MIN_START[pos]) return true;

    const outfieldStarters = this.squad.filter(p=>p.pos!=='GK' && p.start).length;
    const outfieldPlaces   = CONFIG.SQUAD.STARTERS - CONFIG.SQUAD.START_GK;   // 10
    if(outfieldStarters >= outfieldPlaces) return false;

    /* keep enough places free for the positions still short of their minimum */
    const reserved = ['DEF','MID','FWD']
      .filter(o=>o !== pos)
      .reduce((n,o)=>n + Math.max(0, this.MIN_START[o] - this.countStart(o)), 0);

    return outfieldStarters + reserved < outfieldPlaces;
  },

  /* Is the current XI legal? Used to warn, never to block. */
  formationIssues(){
    const out = [];
    if(this.countStart('GK') !== 1) out.push('needs exactly 1 goalkeeper');
    for(const pos of ['DEF','MID','FWD']){
      const have = this.countStart(pos), min = this.MIN_START[pos];
      if(have < min) out.push(`needs at least ${min} ${CONFIG.POS_LABEL[pos].toLowerCase()}`);
    }
    const n = this.starters().length;
    if(n !== CONFIG.SQUAD.STARTERS && this.squad.length === CONFIG.SQUAD.TOTAL)
      out.push(`has ${n} starters, should be ${CONFIG.SQUAD.STARTERS}`);
    return out;
  },

  /* how many of this position may still be added */
  spaceFor(pos){ return CONFIG.SQUAD[pos] - this.countPos(pos); },

  isFull(){ return this.squad.length >= CONFIG.SQUAD.TOTAL; },

  has(id){ return this.squad.some(p=>p.id===id); },

  /* total squad value, £m */
  squadValue(){ return this.squad.reduce((a,p)=>a + (p.price||0), 0); },

  /* Add a player to a position slot.
     Enforces the FPL quota: 2 GK, 5 DEF, 5 MID, 3 FWD. */
  addPlayer(poolPlayer, { start=null } = {}){
    if(this.has(poolPlayer.id)) return { ok:false, reason:'Already in your squad' };
    if(this.spaceFor(poolPlayer.pos) <= 0)
      return { ok:false, reason:`You already have ${CONFIG.SQUAD[poolPlayer.pos]} ${CONFIG.POS_LABEL[poolPlayer.pos].toLowerCase()}` };

    /* Auto-place him.
       A legal FPL XI is 1 GK, at least 3 DEF, at least 2 MID and
       at least 1 FWD. So we fill each position's minimum first and
       only then use the remaining outfield places. Otherwise the
       order you happen to add players in could leave you with an
       illegal shape like 5-5-0. */
    let startFlag = start;
    if(startFlag === null) startFlag = this.wouldStart(poolPlayer.pos);

    this.squad.push({
      id: poolPlayer.id,
      name: poolPlayer.name,
      team: poolPlayer.team,
      teamId: poolPlayer.teamId,
      pos: poolPlayer.pos,
      price: poolPlayer.price,
      start: startFlag,
      cap: false,
      vice: false,
      inGW: null,
      history: []
    });
    this.persistSquad();
    return { ok:true };
  },

  removePlayer(id){
    this.squad = this.squad.filter(p=>p.id!==id);
    delete this.draft[id];
    this.persistSquad();
    this.persistDraft();
  },

  /* Transfer: out goes, in arrives, same position enforced. */
  transfer(outId, poolPlayer, gw){
    const idx = this.squad.findIndex(p=>p.id===outId);
    if(idx === -1) return { ok:false, reason:'Player not in squad' };
    const out = this.squad[idx];
    if(out.pos !== poolPlayer.pos)
      return { ok:false, reason:`FPL only allows same-position transfers (${out.pos} for ${out.pos})` };
    if(this.has(poolPlayer.id)) return { ok:false, reason:'Already in your squad' };

    this.squad[idx] = {
      id: poolPlayer.id,
      name: poolPlayer.name,
      team: poolPlayer.team,
      teamId: poolPlayer.teamId,
      pos: poolPlayer.pos,
      price: poolPlayer.price,
      start: out.start,
      cap: false,
      vice: out.vice,
      inGW: gw ?? this.currentGW,
      history: []
    };
    delete this.draft[outId];
    this.persistSquad();
    this.persistDraft();
    return { ok:true, out };
  },

  setCaptain(id){
    this.squad.forEach(p=>{
      p.cap = (p.id===id);
      if(p.id===id) p.vice = false;   // captain can't also be vice
    });
    this.persistSquad();
  },

  setVice(id){
    this.squad.forEach(p=>{
      p.vice = (p.id===id);
      if(p.id===id) p.cap = false;    // vice can't also be captain
    });
    this.persistSquad();
  },

  toggleStart(id){
    const p = this.squad.find(x=>x.id===id);
    if(!p) return { ok:false };

    if(p.start){
      /* benching him */
      if(p.pos === 'GK')
        return { ok:false, reason:'You must always start one goalkeeper. Promote the other keeper instead — that swaps them.' };

      if(this.countStart(p.pos) <= this.MIN_START[p.pos])
        return { ok:false, reason:`A legal XI needs at least ${this.MIN_START[p.pos]} ${CONFIG.POS_LABEL[p.pos].toLowerCase()}. Start another one first.` };

      p.start = false;

    }else{
      /* starting him */
      if(p.pos === 'GK'){
        /* keepers simply swap — the other one drops to the bench */
        const currentGK = this.squad.find(x=>x.pos==='GK' && x.start);
        if(currentGK) currentGK.start = false;
        p.start = true;
      }else{
        const outfieldStarters = this.squad.filter(x=>x.pos!=='GK' && x.start).length;
        if(outfieldStarters >= CONFIG.SQUAD.STARTERS - CONFIG.SQUAD.START_GK)
          return { ok:false, reason:'You already have 10 outfield starters. Bench someone first.' };
        p.start = true;
      }
    }
    this.persistSquad();
    return { ok:true };
  },

  /* -------------------------------------------------
     swapLineup — drag one shirt onto another.
       • same start-status (both XI or both bench) → cosmetic reorder
       • one starter + one bench → move them into/out of the XI,
         but only if the resulting formation is still legal.
     Returns { ok, reason?, swapped?, reorder? }.
  ------------------------------------------------- */
  swapLineup(idA, idB){
    if(idA === idB) return { ok:false };
    const a = this.squad.find(p=>p.id===idA);
    const b = this.squad.find(p=>p.id===idB);
    if(!a || !b) return { ok:false, reason:'Player not found' };

    /* both on the same side → just reorder for tidiness */
    if(a.start === b.start){
      const from = this.squad.indexOf(a);
      this.squad.splice(from, 1);
      const to = this.squad.indexOf(b);
      this.squad.splice(to + (from <= to ? 0 : 1), 0, a);
      this.persistSquad();
      return { ok:true, reorder:true };
    }

    /* one in, one out → try the swap, validate, revert if illegal */
    const sA = a.start, sB = b.start;
    a.start = !sA;
    b.start = !sB;

    const issue = this._lineupIssue();
    if(issue){
      a.start = sA; b.start = sB;      // revert
      return { ok:false, reason:issue };
    }
    this.persistSquad();
    return { ok:true, swapped:true };
  },

  /* validates the current XI for drag-drop; returns a message or null.
     Relaxed while the squad is still being built (under 15). */
  _lineupIssue(){
    const gk = this.countStart('GK');
    if(gk > 1) return 'Only one goalkeeper can start.';

    if(this.squad.length !== CONFIG.SQUAD.TOTAL) return null;   // still building

    if(gk !== 1) return 'Exactly one goalkeeper must start.';
    for(const pos of ['DEF','MID','FWD']){
      if(this.countStart(pos) < this.MIN_START[pos])
        return `A legal XI needs at least ${this.MIN_START[pos]} ${CONFIG.POS_LABEL[pos].toLowerCase()}.`;
    }
    if(this.starters().length !== CONFIG.SQUAD.STARTERS)
      return `The XI must have ${CONFIG.SQUAD.STARTERS} players.`;
    return null;
  },

  /* current formation, e.g. "4-4-2" */
  formation(){
    const d = this.squad.filter(p=>p.pos==='DEF' && p.start).length;
    const m = this.squad.filter(p=>p.pos==='MID' && p.start).length;
    const f = this.squad.filter(p=>p.pos==='FWD' && p.start).length;
    return `${d}-${m}-${f}`;
  },

  starters(){ return this.squad.filter(p=>p.start); },
  bench(){ return this.squad.filter(p=>!p.start); },

  persistSquad(){ save(CONFIG.STORE.squad, this.squad); emit('squad'); },

  /* =================================================
     DRAFT — flags and notes on your own players
  ================================================= */

  draftOf(id){
    if(!this.draft[id]) this.draft[id] = { flag:'hold', note:'' };
    return this.draft[id];
  },

  setFlag(id, flag){
    this.draftOf(id).flag = flag;
    this.persistDraft();
  },

  setNote(id, note){
    this.draftOf(id).note = note;
    this.persistDraft();
  },

  persistDraft(){ save(CONFIG.STORE.draft, this.draft); emit('draft'); },

  /* =================================================
     CANDIDATES — players you're watching, per position
  ================================================= */

  addCandidate(poolPlayer){
    if(this.candidates[poolPlayer.id]) return { ok:false, reason:'Already on your shortlist' };
    if(this.has(poolPlayer.id)) return { ok:false, reason:'He is already in your squad' };
    this.candidates[poolPlayer.id] = {
      id: poolPlayer.id,
      name: poolPlayer.name,
      team: poolPlayer.team,
      teamId: poolPlayer.teamId,
      pos: poolPlayer.pos,
      price: poolPlayer.price,
      note: '',
      swapWith: null,
      targetGW: null
    };
    this.persistCands();
    return { ok:true };
  },

  removeCandidate(id){
    delete this.candidates[id];
    this.persistCands();
  },

  updateCandidate(id, patch){
    if(!this.candidates[id]) return;
    Object.assign(this.candidates[id], patch);
    this.persistCands();
  },

  candidatesFor(pos){
    return Object.values(this.candidates).filter(c=>c.pos===pos);
  },

  persistCands(){ save(CONFIG.STORE.cands, this.candidates); emit('candidates'); },

  /* =================================================
     GRADING
     ratio = points / position average that gameweek
  ================================================= */

  gradeFromRatio(ratio){
    const c = CONFIG.GRADE_CUTS;
    if(ratio >= c.blue)  return 'blue';
    if(ratio >= c.green) return 'green';
    if(ratio >= c.amber) return 'amber';
    return 'red';
  },

  /* points a squad player scored in one gameweek */
  pointsIn(player, gw){
    const h = player.history?.find(x=>x.gw===gw);
    return h ? h.points : null;
  },

  /* minutes a squad player played in one gameweek */
  minutesIn(player, gw){
    const h = player.history?.find(x=>x.gw===gw);
    return h ? (h.minutes ?? 0) : null;
  },

  /* who actually gets the 2x for a gameweek.
     If the captain played 0 minutes that week, the vice takes over. */
  effectiveCaptain(gw){
    const cap  = this.squad.find(p=>p.cap);
    const vice = this.squad.find(p=>p.vice);
    if(!cap) return { player:null, fallback:false };
    const capMin = this.minutesIn(cap, gw);
    if(vice && capMin === 0) return { player:vice, fallback:true };
    return { player:cap, fallback:false };
  },

  seasonTotal(player){
    return (player.history||[]).reduce((a,h)=>a+h.points, 0);
  },

  gradeGW(player, gw){
    const pts = this.pointsIn(player, gw);
    if(pts === null) return { grade:null, pts:null };
    const avg = this.posAvg?.[gw]?.[player.pos];
    if(!avg) return { grade:'amber', pts };
    return { grade:this.gradeFromRatio(pts/avg), pts, ratio:pts/avg };
  },

  gradeSeason(player){
    const total = this.seasonTotal(player);
    const weeks = (player.history||[]).length;
    if(!weeks) return { grade:null, pts:0 };
    let avgSum = 0, n = 0;
    for(const h of player.history){
      const a = this.posAvg?.[h.gw]?.[player.pos];
      if(a){ avgSum += a; n++; }
    }
    if(!n) return { grade:'amber', pts:total };
    return { grade:this.gradeFromRatio(total/avgSum), pts:total, ratio:total/avgSum };
  },

  /* grade a pool player (candidate) on season form */
  gradePool(poolPlayer){
    const weeksPlayed = Math.max(1, this.currentGW - 1);
    const avgArr = [];
    for(let gw=1; gw<=weeksPlayed; gw++){
      const a = this.posAvg?.[gw]?.[poolPlayer.pos];
      if(a) avgArr.push(a);
    }
    if(!avgArr.length) return { grade:null, pts:poolPlayer.total };
    const expected = avgArr.reduce((a,b)=>a+b,0);
    return { grade:this.gradeFromRatio(poolPlayer.total/expected), pts:poolPlayer.total };
  },

  /* =================================================
     FIXTURES / TIERS
  ================================================= */

  tierOf(teamId){
    const row = this.table.find(r=>r.id===teamId);
    if(!row) return 3;
    for(const band of CONFIG.TIER_BANDS){
      if(row.position <= band.max) return band.tier;
    }
    return 5;
  },

  tierMeta(tier){
    return CONFIG.TIER_BANDS.find(b=>b.tier===tier) || CONFIG.TIER_BANDS[2];
  },

  /* next N fixtures for a team, with difficulty */
  nextFixtures(teamId, n=5, fromGW=null){
    const start = fromGW ?? this.currentGW;
    return this.fixtures
      .filter(f=>f.gw >= start && (f.homeId===teamId || f.awayId===teamId))
      .sort((a,b)=>a.gw-b.gw)
      .slice(0, n)
      .map(f=>{
        const home = f.homeId === teamId;
        const oppId = home ? f.awayId : f.homeId;
        const tier = this.tierOf(oppId);
        return {
          gw: f.gw,
          opp: this.teamById[oppId]?.short || '???',
          home,
          tier,
          ...this.tierMeta(tier)
        };
      });
  },

  /* =================================================
     RESET
  ================================================= */

  resetAll(){
    [CONFIG.STORE.squad, CONFIG.STORE.draft, CONFIG.STORE.cands].forEach(k=>localStorage.removeItem(k));
    this.squad = []; this.draft = {}; this.candidates = {};
    emit('reset');
  }
};

export default Store;
