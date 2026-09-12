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
    start:  true|false,     // in the XI or on the bench (current view only)
    inGW:   null|number,    // gameweek he joined the squad
    outGW:  null|number,    // gameweek he left (was transferred out); null = still here
    history: [ { gw, points, ... } ]   // filled from the API
  }

  Captain and vice are NOT stored on the player — they live in
  Store.captains[gw] / Store.vices[gw].

  Store.squad keeps EVERY player who has ever been in the squad, so
  past-gameweek renders can still resolve names/kits for players who
  were later transferred out. "Current squad" = filter outGW == null.

  Store.lineups[gw] snapshots WHO was in the XI / bench for that GW:
  { memberIds:[15], starterIds:[11] }. Written on every mutation to
  lineups[currentGW]; past GWs are frozen (never overwritten).`;

export const Store = {

  SHAPE: SquadShape,

  squad     : load(CONFIG.STORE.squad, []),
  draft     : load(CONFIG.STORE.draft, {}),
  candidates: load(CONFIG.STORE.cands, {}),

  /* per-GW armband — { [gw]: playerId } */
  captains  : load(CONFIG.STORE.caps,  {}),
  vices     : load(CONFIG.STORE.vices, {}),

  /* per-GW lineup snapshots — { [gw]: { memberIds, starterIds } } */
  lineups   : load(CONFIG.STORE.lineups, {}),

  /* highest currentGW we've ever seen; used to detect deadline crossings */
  lastKnownGW: load(CONFIG.STORE.lastGW, 0),

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

     "activeSquad" = players still in the current squad
     (outGW == null). The raw `squad` list also keeps
     transferred-out players around, tagged with outGW,
     so past-gameweek renders can look them up by id.
  ================================================= */

  activeSquad(){ return this.squad.filter(p => p.outGW == null); },

  countPos(pos){ return this.activeSquad().filter(p=>p.pos===pos).length; },

  countStart(pos){ return this.activeSquad().filter(p=>p.pos===pos && p.start).length; },

  /* Minimum starters per position for a legal FPL formation. */
  MIN_START: { GK:1, DEF:3, MID:2, FWD:1 },

  /* Should a newly added player of this position go straight
     into the XI? Yes if his position is still below its minimum,
     or if there is a spare outfield place going. */
  wouldStart(pos){
    if(pos === 'GK') return this.countStart('GK') < CONFIG.SQUAD.START_GK;

    if(this.countStart(pos) < this.MIN_START[pos]) return true;

    const outfieldStarters = this.activeSquad().filter(p=>p.pos!=='GK' && p.start).length;
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
    if(n !== CONFIG.SQUAD.STARTERS && this.activeSquad().length === CONFIG.SQUAD.TOTAL)
      out.push(`has ${n} starters, should be ${CONFIG.SQUAD.STARTERS}`);
    return out;
  },

  /* how many of this position may still be added */
  spaceFor(pos){ return CONFIG.SQUAD[pos] - this.countPos(pos); },

  isFull(){ return this.activeSquad().length >= CONFIG.SQUAD.TOTAL; },

  has(id){ return this.activeSquad().some(p=>p.id===id); },

  /* total squad value, £m */
  squadValue(){ return this.activeSquad().reduce((a,p)=>a + (p.price||0), 0); },

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
      inGW: null,
      outGW: null,
      history: []
    });
    this.persistSquad();
    return { ok:true };
  },

  /* Was this player ever recorded in a past lineup snapshot? If so
     we can't hard-delete him — past GWs need to render him — we mark
     outGW instead. If he never made it into any snapshot he's fresh
     roster clutter and we drop him entirely. */
  _isInAnySnapshot(id){
    for(const gw of Object.keys(this.lineups)){
      const ln = this.lineups[gw];
      if(ln?.memberIds?.includes(id)) return true;
    }
    return false;
  },

  removePlayer(id){
    const p = this.squad.find(x=>x.id===id);
    if(!p) return;

    if(this._isInAnySnapshot(id)){
      /* mark as gone from the current squad, preserve for past renders */
      p.outGW = this.currentGW;
      p.start = false;
    }else{
      /* never locked into a past lineup — safe to drop */
      this.squad = this.squad.filter(x=>x.id!==id);
    }

    delete this.draft[id];
    /* also wipe any FUTURE armband slot he still holds — past GW
       snapshots keep him as they were */
    const cw = this.currentGW;
    if(this.captains[cw] === id) delete this.captains[cw];
    if(this.vices[cw]    === id) delete this.vices[cw];
    this.persistSquad();
    this.persistDraft();
    this.persistCaps();
  },

  /* Transfer: outgoing player is retained with outGW = currentGW so
     past-GW views still resolve him. Incoming player joins with
     inGW = currentGW. Same-position enforced. */
  transfer(outId, poolPlayer, gw){
    const out = this.activeSquad().find(p=>p.id===outId);
    if(!out) return { ok:false, reason:'Player not in squad' };
    if(out.pos !== poolPlayer.pos)
      return { ok:false, reason:`FPL only allows same-position transfers (${out.pos} for ${out.pos})` };
    if(this.has(poolPlayer.id)) return { ok:false, reason:'Already in your squad' };

    const tGW = gw ?? this.currentGW;
    out.outGW = tGW;
    /* clear his start flag so the incoming player inherits the slot */
    const wasStarting = out.start;
    out.start = false;

    this.squad.push({
      id: poolPlayer.id,
      name: poolPlayer.name,
      team: poolPlayer.team,
      teamId: poolPlayer.teamId,
      pos: poolPlayer.pos,
      price: poolPlayer.price,
      start: wasStarting,
      inGW: tGW,
      outGW: null,
      history: []
    });

    /* if the outgoing player was carrying the current armband, drop it */
    const cw = this.currentGW;
    if(this.captains[cw] === outId) delete this.captains[cw];
    if(this.vices[cw]    === outId) delete this.vices[cw];
    delete this.draft[outId];
    this.persistSquad();
    this.persistDraft();
    this.persistCaps();
    return { ok:true, out };
  },

  /* =================================================
     CAPTAIN / VICE — per gameweek
     One armband decision per GW, so past weeks stay
     frozen when you change captain later. Default GW
     is Store.currentGW.
  ================================================= */

  captainIdOf(gw){ return this.captains[gw] ?? null; },
  viceIdOf   (gw){ return this.vices[gw]    ?? null; },

  captainOf(gw){
    const id = this.captainIdOf(gw);
    return id ? this.squad.find(p=>p.id===id) || null : null;
  },
  viceOf(gw){
    const id = this.viceIdOf(gw);
    return id ? this.squad.find(p=>p.id===id) || null : null;
  },

  setCaptain(id, gw){
    const target = gw ?? this.currentGW;
    this.captains[target] = id;
    if(this.vices[target] === id) delete this.vices[target];   // can't be both
    this.persistCaps();
  },

  setVice(id, gw){
    const target = gw ?? this.currentGW;
    this.vices[target] = id;
    if(this.captains[target] === id) delete this.captains[target];
    this.persistCaps();
  },

  /* One-time migration for squads that still carry the old p.cap / p.vice
     flags. Seed those into the per-GW maps for every played week plus the
     current one, then drop the flags. Runs cheap-and-often; the guard makes
     it a no-op once the maps exist. */
  migrateLegacyCaptains(){
    const seeded = Object.keys(this.captains).length + Object.keys(this.vices).length > 0;
    if(seeded) return;
    const legacyCap  = this.squad.find(p=>p.cap);
    const legacyVice = this.squad.find(p=>p.vice);
    if(!legacyCap && !legacyVice) return;

    const gws = new Set([this.currentGW]);
    this.squad.forEach(p => (p.history||[]).forEach(h => gws.add(h.gw)));
    for(const gw of gws){
      if(legacyCap)  this.captains[gw] = legacyCap.id;
      if(legacyVice) this.vices[gw]    = legacyVice.id;
    }
    this.squad.forEach(p => { delete p.cap; delete p.vice; });
    this.persistSquad();
    this.persistCaps();
  },

  persistCaps(){
    save(CONFIG.STORE.caps,  this.captains);
    save(CONFIG.STORE.vices, this.vices);
    emit('captains');
  },

  toggleStart(id){
    const p = this.activeSquad().find(x=>x.id===id);
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
        const currentGK = this.activeSquad().find(x=>x.pos==='GK' && x.start);
        if(currentGK) currentGK.start = false;
        p.start = true;
      }else{
        const outfieldStarters = this.activeSquad().filter(x=>x.pos!=='GK' && x.start).length;
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
    const a = this.activeSquad().find(p=>p.id===idA);
    const b = this.activeSquad().find(p=>p.id===idB);
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
    const a = this.activeSquad();
    const d = a.filter(p=>p.pos==='DEF' && p.start).length;
    const m = a.filter(p=>p.pos==='MID' && p.start).length;
    const f = a.filter(p=>p.pos==='FWD' && p.start).length;
    return `${d}-${m}-${f}`;
  },

  /* current-squad convenience — use these on the Draft page and any
     view that shows "today's squad". For past gameweeks, use the
     *ForGW helpers below, which resolve from Store.lineups[gw]. */
  starters(){ return this.activeSquad().filter(p=>p.start); },
  bench(){ return this.activeSquad().filter(p=>!p.start); },

  /* =================================================
     PER-GW LINEUP HELPERS

     Reads: squadForGW / startersForGW / benchForGW return the
     15-man squad and XI/bench for a specific gameweek. They prefer
     the snapshot in Store.lineups[gw]; if the GW has never been
     snapshotted they fall back to reconstructing from inGW / outGW
     on the raw squad list (best-effort for pre-fix history).

     Writes: snapshotLineup(gw) captures the current active squad
     and XI into lineups[gw]. Called from persistSquad(), so every
     mutation to the working state re-snaps the CURRENT gw. Past GWs
     are never overwritten unless snapshotLineup is called with that
     GW explicitly (used only by the boot-time backfill).
  ================================================= */

  playerById(id){ return this.squad.find(p=>p.id===id) || null; },

  squadForGW(gw){
    const snap = this.lineups[gw];
    if(snap && Array.isArray(snap.memberIds) && snap.memberIds.length){
      return snap.memberIds.map(id => this.playerById(id)).filter(Boolean);
    }
    /* fallback: reconstruct from inGW / outGW windows */
    return this.squad.filter(p =>
      (p.inGW  == null || p.inGW  <= gw) &&
      (p.outGW == null || p.outGW >  gw)
    );
  },

  startersForGW(gw){
    const snap = this.lineups[gw];
    if(snap && Array.isArray(snap.starterIds) && snap.starterIds.length){
      return snap.starterIds.map(id => this.playerById(id)).filter(Boolean);
    }
    /* fallback: active members of this GW who currently start */
    return this.squadForGW(gw).filter(p => p.start);
  },

  benchForGW(gw){
    const starters = new Set(this.startersForGW(gw).map(p=>p.id));
    return this.squadForGW(gw).filter(p => !starters.has(p.id));
  },

  /* Freeze the working state as the snapshot for a given GW.
     Called on every mutation for currentGW, so lineups[currentGW]
     always mirrors "today's squad" — the moment currentGW advances,
     that snapshot IS the frozen record for the week that just ended. */
  snapshotLineup(gw){
    const active = this.activeSquad();
    this.lineups[gw] = {
      memberIds : active.map(p => p.id),
      starterIds: active.filter(p => p.start).map(p => p.id)
    };
  },

  persistLineups(){
    save(CONFIG.STORE.lineups, this.lineups);
    save(CONFIG.STORE.lastGW,  this.lastKnownGW);
  },

  /* Called from app.js after the API reports the real currentGW.
     If the deadline for one or more past GWs passed while we were
     closed, back-fill their snapshots from the current working state
     (best guess — the state you saw last time you had the app open
     is the closest thing we have to what you had at each deadline).
     Past GWs already carrying a snapshot are never overwritten. */
  seedMissedLineups(){
    if(this.currentGW > this.lastKnownGW){
      const from = Math.max(1, this.lastKnownGW || 1);
      for(let gw = from; gw <= this.currentGW; gw++){
        if(!this.lineups[gw]) this.snapshotLineup(gw);
      }
    }
    this.lastKnownGW = Math.max(this.lastKnownGW, this.currentGW);
    this.persistLineups();
  },

  persistSquad(){
    /* keep lineups[currentGW] in sync with the working state so it's
       ready to become the frozen record when the deadline passes */
    this.snapshotLineup(this.currentGW);
    save(CONFIG.STORE.squad, this.squad);
    this.persistLineups();
    emit('squad');
  },

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
     SYNC BRIDGE
     The whole persisted state as one blob, and the
     inverse — used by js/sync.js to mirror across
     devices. importState writes local + re-renders.
  ================================================= */

  exportState(){
    return {
      squad:       this.squad,
      draft:       this.draft,
      candidates:  this.candidates,
      captains:    this.captains,
      vices:       this.vices,
      lineups:     this.lineups,
      lastKnownGW: this.lastKnownGW,
    };
  },

  importState(s){
    if(!s || typeof s !== 'object') return;
    this.squad       = Array.isArray(s.squad) ? s.squad : [];
    this.draft       = (s.draft       && typeof s.draft       === 'object') ? s.draft       : {};
    this.candidates  = (s.candidates  && typeof s.candidates  === 'object') ? s.candidates  : {};
    this.captains    = (s.captains    && typeof s.captains    === 'object') ? s.captains    : {};
    this.vices       = (s.vices       && typeof s.vices       === 'object') ? s.vices       : {};
    this.lineups     = (s.lineups     && typeof s.lineups     === 'object') ? s.lineups     : {};
    this.lastKnownGW = Number.isFinite(s.lastKnownGW) ? s.lastKnownGW : this.lastKnownGW;
    save(CONFIG.STORE.squad,   this.squad);
    save(CONFIG.STORE.draft,   this.draft);
    save(CONFIG.STORE.cands,   this.candidates);
    save(CONFIG.STORE.caps,    this.captains);
    save(CONFIG.STORE.vices,   this.vices);
    save(CONFIG.STORE.lineups, this.lineups);
    save(CONFIG.STORE.lastGW,  this.lastKnownGW);
    emit('sync');
  },

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
    const cap  = this.captainOf(gw);
    const vice = this.viceOf(gw);
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
    [CONFIG.STORE.squad, CONFIG.STORE.draft, CONFIG.STORE.cands,
     CONFIG.STORE.caps,  CONFIG.STORE.vices, CONFIG.STORE.lineups,
     CONFIG.STORE.lastGW].forEach(k=>localStorage.removeItem(k));
    this.squad = []; this.draft = {}; this.candidates = {};
    this.captains = {}; this.vices = {};
    this.lineups = {}; this.lastKnownGW = 0;
    emit('reset');
  }
};

export default Store;
