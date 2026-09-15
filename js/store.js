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

/* Was this FPL pick in the starting XI?

   Read `position`, never `multiplier`. FPL's multiplier means "how much
   does he score", not "is he on the pitch": it's 0 for an unused bench
   player, but Bench Boost pays the bench, so in a BB week all 15 picks
   come back with multiplier >= 1. Filtering on that put all 15 players
   on the field (seen in GW1, a Bench Boost week). `position` is always
   1-15 with 1-11 the XI and 12-15 the bench order, whatever chip is on. */
export function isStartingPick(pick){
  return pick.position <= CONFIG.SQUAD.STARTERS;
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
  lineups[editableGW()]; past GWs are frozen (never overwritten).`;

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

  /* Local estimate of banked free transfers — only meaningful without a
     linked FPL account (a linked account reads the real transferCost
     straight from FPL's own history instead, in gwPointsFor above).
     Starts at the safe default of 1 and grows automatically as
     gameweeks pass without a transfer, capped at 5; a real transfer()
     call consumes one immediately. Because it only starts counting
     from whenever this feature first ran, it can under-count real
     banking from before that point — it's an estimate, not the
     authoritative figure. See advanceFreeTransfers(). */
  freeTransfers: load(CONFIG.STORE.freeTransfers, 1),
  freeTransfersSeenGW: load(CONFIG.STORE.freeTransfersSeenGW, 0),

  /* linked FPL account — persisted id + last-known team/rank meta.
     When set, boot pulls picks/history from the official API and lets
     them overwrite lineups / captains / vices. Local notes, flags and
     candidates are never overwritten. */
  managerId : load(CONFIG.STORE.manager,   null),
  entryMeta : load(CONFIG.STORE.entryMeta, null),  // { teamName, managerName, rank, ... }

  /* which chip (if any) was active in each GW. Codes match the FPL
     API: '3xc' = Triple Captain, 'bboost' = Bench Boost,
     'wildcard' = Wildcard, 'freehit' = Free Hit. Wildcard/Free Hit
     don't affect scoring; TC/BB do. */
  chips     : load(CONFIG.STORE.chips,     {}),

  /* per-GW official totals + transfer costs, populated by syncFromFPL.
     When present, the hero prefers these as they're the exact numbers
     from the official app. { [gw]: {points, totalPoints, transferCost} } */
  gwHistory : load(CONFIG.STORE.gwHistory, {}),

  CHIP_LABEL: {
    '3xc':      'Triple Captain',
    'bboost':   'Bench Boost',
    'wildcard': 'Wildcard',
    'freehit':  'Free Hit'
  },
  CHIP_SHORT: { '3xc':'TC', 'bboost':'BB', 'wildcard':'WC', 'freehit':'FH' },

  /* one-time backfill exception: gameweeks 1..BACKFILL_UNTIL stay
     editable even after their "deadline" so the pre-fix snapshots
     (which were seeded as best-guesses from the current squad) can
     be corrected to match reality. Every GW after this is locked. */
  BACKFILL_UNTIL: 4,
  isBackfillGW(gw){ return gw >= 1 && gw <= this.BACKFILL_UNTIL && gw < this.currentGW; },

  /* =================================================
     WHICH GAMEWEEK AM I ACTUALLY EDITING?

     currentGW is what FPL calls "current", which stays put for days
     after that gameweek's deadline has passed. Editing in that window
     is planning for the NEXT gameweek — but the old code snapshotted
     every change into lineups[currentGW], rewriting a finished week's
     record, and the Performance page showed the live working squad in
     place of what was actually fielded.

     editableGW() is the honest answer: the gameweek your team sheet
     still counts for. Everything that mutates a team sheet — the
     snapshot, the armband, the chip, a transfer — targets this, never
     currentGW. Falls back to currentGW when deadlines are unknown
     (offline / cached boot), which is the old behaviour.
  ================================================= */

  deadlines : {},     // { gw: epoch ms }, from API.bootstrap()

  deadlinePassed(gw){
    const t = this.deadlines?.[gw];
    return t != null && Date.now() >= t;
  },

  editableGW(){
    return this.deadlinePassed(this.currentGW)
      ? Math.min(this.currentGW + 1, CONFIG.TOTAL_GW)
      : this.currentGW;
  },

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

  /* true from the moment boot() starts until the first API round-trip
     finishes. Pages use it to show a loading skeleton instead of an
     empty pitch on a fresh device with no local squad yet. */
  booting   : false,

  /* =================================================
     SQUAD

     "activeSquad" = players still in the current squad
     (outGW == null). The raw `squad` list also keeps
     transferred-out players around, tagged with outGW,
     so past-gameweek renders can look them up by id.
  ================================================= */

  activeSquad(){ return this.squad.filter(p => p.outGW == null); },

  /* Collapse duplicate rows for the same id in Store.squad. Can happen
     if a retired player (outGW set) got re-added via addPlayer/transfer
     instead of being reactivated — both used to guard against dupes
     with has(), which only looks at ACTIVE members, so a retired id
     slipped past it and got pushed as a brand-new second row. Once
     that happens, syncFromFPL's rebuild only ever touches the FIRST
     row it finds for an id, so the extra row(s) never get corrected —
     an active duplicate can silently push the XI to 12+ starters.
     Keeps one row per id (prefers an active copy if any exist, merges
     history from all copies), idempotent, safe to call any time. */
  dedupeSquad(){
    const byId = new Map();
    for(const p of this.squad){
      const kept = byId.get(p.id);
      if(!kept){ byId.set(p.id, p); continue; }

      const winner = kept.outGW == null ? kept : (p.outGW == null ? p : kept);
      const loser  = winner === kept ? p : kept;

      const ins = [kept.inGW, p.inGW].filter(x => x != null);
      winner.inGW = ins.length ? Math.min(...ins) : null;

      const histByGW = new Map();
      for(const h of [...(kept.history||[]), ...(p.history||[])]) histByGW.set(h.gw, h);
      winner.history = [...histByGW.values()].sort((a,b)=>a.gw-b.gw);

      void loser;
      byId.set(p.id, winner);
    }
    const deduped = [...byId.values()];
    if(deduped.length === this.squad.length) return false;
    this.squad = deduped;
    save(CONFIG.STORE.squad, this.squad);
    return true;
  },

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

  /* =================================================
     CLUB LIMIT — max 3 players from any one real club.
     Absolute in FPL: there is no legitimate way to hold
     four, so this one blocks rather than warns.
  ================================================= */

  countTeam(teamId, members = null){
    const list = members || this.activeSquad();
    return list.filter(p => p.teamId === teamId).length;
  },

  /* Name of the club, for an error message the user can act on. */
  teamName(teamId){
    return this.teamById?.[teamId]?.short || this.teamById?.[teamId]?.name || 'that club';
  },

  /* Can this player join, given who's already there? `members` lets a
     past-GW snapshot be checked instead of today's squad; `replacingId`
     is the outgoing player in a transfer, who frees his own slot. */
  teamLimitIssue(pool, { members = null, replacingId = null } = {}){
    let list = members || this.activeSquad();
    if(replacingId != null) list = list.filter(p => p.id !== replacingId);
    if(this.countTeam(pool.teamId, list) < CONFIG.SQUAD.TEAM_LIMIT) return null;
    return `You already have ${CONFIG.SQUAD.TEAM_LIMIT} players from ${this.teamName(pool.teamId)} — FPL allows a maximum of ${CONFIG.SQUAD.TEAM_LIMIT} from one club.`;
  },

  /* =================================================
     SQUAD LEGALITY — warnings, not blocks.

     Budget is deliberately a warning: £100.0m is the STARTING
     budget, and once prices rise a perfectly legal squad is worth
     more than that. We don't track purchase prices or the bank, so
     we can flag the overspend but must not refuse it.
  ================================================= */
  squadIssues(){
    const out = [];

    const counts = {};
    for(const p of this.activeSquad()) counts[p.teamId] = (counts[p.teamId] || 0) + 1;
    for(const [teamId, n] of Object.entries(counts)){
      if(n > CONFIG.SQUAD.TEAM_LIMIT)
        out.push(`${n} players from ${this.teamName(+teamId)} — the limit is ${CONFIG.SQUAD.TEAM_LIMIT}`);
    }

    const val = this.squadValue();
    if(this.activeSquad().length === CONFIG.SQUAD.TOTAL && val > CONFIG.SQUAD.BUDGET){
      out.push(`£${val.toFixed(1)}m is over the £${CONFIG.SQUAD.BUDGET.toFixed(1)}m starting budget (fine if your squad has risen in value)`);
    }
    return out;
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

    const clubIssue = this.teamLimitIssue(poolPlayer);
    if(clubIssue) return { ok:false, reason:clubIssue };

    /* Auto-place him.
       A legal FPL XI is 1 GK, at least 3 DEF, at least 2 MID and
       at least 1 FWD. So we fill each position's minimum first and
       only then use the remaining outfield places. Otherwise the
       order you happen to add players in could leave you with an
       illegal shape like 5-5-0. */
    let startFlag = start;
    if(startFlag === null) startFlag = this.wouldStart(poolPlayer.pos);

    /* he may already have a row from an earlier stint (transferred out,
       now coming back) — reactivate it instead of pushing a duplicate
       row for the same id (has() above only rules out ACTIVE members) */
    const existing = this.playerById(poolPlayer.id);
    if(existing){
      existing.outGW = null;
      existing.start = startFlag;
      existing.price = poolPlayer.price;
    }else{
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
    }
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
      p.outGW = this.editableGW();
      p.start = false;
    }else{
      /* never locked into a past lineup — safe to drop */
      this.squad = this.squad.filter(x=>x.id!==id);
    }

    delete this.draft[id];
    /* also wipe any FUTURE armband slot he still holds — past GW
       snapshots keep him as they were */
    const cw = this.editableGW();
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

    /* the outgoing player frees his own club slot, so exclude him */
    const clubIssue = this.teamLimitIssue(poolPlayer, { replacingId: outId });
    if(clubIssue) return { ok:false, reason:clubIssue };

    const tGW = gw ?? this.editableGW();
    out.outGW = tGW;
    /* clear his start flag so the incoming player inherits the slot */
    const wasStarting = out.start;
    out.start = false;

    /* incoming player may already have a row from an earlier stint —
       reactivate it instead of pushing a duplicate row for the same id */
    const existing = this.playerById(poolPlayer.id);
    if(existing){
      existing.outGW = null;
      existing.start = wasStarting;
      existing.inGW  = tGW;
      existing.price = poolPlayer.price;
    }else{
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
    }

    /* if the outgoing player was carrying the armband for the gameweek
       we're editing, drop it — past gameweeks keep theirs */
    const cw = tGW;
    if(this.captains[cw] === outId) delete this.captains[cw];
    if(this.vices[cw]    === outId) delete this.vices[cw];
    delete this.draft[outId];

    /* consumes one banked free transfer, unless a wildcard/free-hit is
       active — those give unlimited moves for the week at no cost */
    const chip = this.chips[tGW];
    if(chip !== 'wildcard' && chip !== 'freehit'){
      this.freeTransfers = Math.max(0, this.freeTransfers - 1);
      this.persistFreeTransfers();
    }

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
    const target = gw ?? this.editableGW();
    this.captains[target] = id;
    if(this.vices[target] === id) delete this.vices[target];   // can't be both
    this.persistCaps();
  },

  setVice(id, gw){
    const target = gw ?? this.editableGW();
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

  /* =================================================
     CHIPS — per gameweek. null = no chip that week.
  ================================================= */
  chipOf(gw){ return this.chips[gw] || null; },

  /* Which half of the season a gameweek belongs to. You get one of
     each chip per half, and the first set expires at the GW19
     deadline rather than carrying over. */
  chipHalf(gw){ return gw <= CONFIG.CHIP_HALF_END ? 1 : 2; },

  /* Where this chip was already played in the same half, if anywhere.
     Returns the gameweek number, or null. */
  chipPlayedIn(code, half, exceptGW = null){
    for(const [gw, c] of Object.entries(this.chips)){
      const n = +gw;
      if(c !== code || n === exceptGW) continue;
      if(this.chipHalf(n) === half) return n;
    }
    return null;
  },

  /* Chips still unplayed in a half — used to warn before they expire. */
  chipsLeftIn(half){
    return Object.keys(this.CHIP_SHORT).filter(c => !this.chipPlayedIn(c, half));
  },

  setChip(gw, code){
    if(!code){
      delete this.chips[gw];
      save(CONFIG.STORE.chips, this.chips);
      emit('chips');
      return { ok:true };
    }

    const half  = this.chipHalf(gw);
    const clash = this.chipPlayedIn(code, half, gw);
    if(clash != null){
      return { ok:false, reason:`${this.CHIP_LABEL[code]} is already played in GW${clash}. You get one per half of the season — remove it there first.` };
    }

    this.chips[gw] = code;
    save(CONFIG.STORE.chips, this.chips);
    emit('chips');
    return { ok:true };
  },

  /* What the captain's points get multiplied by in this GW: ×3 under
     Triple Captain, ×2 otherwise. Everything that doubles a captain —
     the team total, the pitch stripe, the modal breakdown, the captain
     table — must go through here, or the screens disagree with each
     other in a TC week. */
  capMultFor(gw){ return this.chipOf(gw) === '3xc' ? 3 : 2; },

  /* =================================================
     AUTO-SUBSTITUTION — the correction FPL itself makes
     when a starter records 0 minutes: the highest-priority
     eligible bench player who did play comes on instead,
     formation rules permitting.

     Standard fan-implementation algorithm (fill blanks in
     bench order, skip anyone who'd break the formation) —
     this has NOT been checked against a real official
     auto-sub gameweek this session, unlike the scoring
     rules elsewhere in this file, which were reconciled
     against real totals. Treat a disagreement with the
     official app as a reason to come back and audit this,
     not as proof the official app is wrong.

     Only affects the POINTS TOTAL (gwPointsFor below); the
     pitch still shows the XI you actually picked, and
     Bench Calls / Optimal XI deliberately keep using the
     as-picked XI since those are about your decision, not
     FPL's mechanical correction.
  ================================================= */
  autoSubStarters(gw){
    const starters = this.startersForGW(gw);
    const bench    = this.benchForGW(gw);
    const minutesOf = p => this.minutesIn(p, gw) ?? 0;

    let xi = [...starters];

    /* goalkeeper — only the bench keeper can come on for a blanking
       starting keeper, whatever the outfield bench order says */
    const startGK = xi.find(p=>p.pos==='GK');
    const benchGK = bench.find(p=>p.pos==='GK');
    if(startGK && minutesOf(startGK) === 0 && benchGK && minutesOf(benchGK) > 0){
      xi = xi.map(p => p === startGK ? benchGK : p);
    }

    const isLegalXI = list => {
      const c = { GK:0, DEF:0, MID:0, FWD:0 };
      list.forEach(p=>c[p.pos]++);
      return c.GK===1 && c.DEF>=3 && c.MID>=2 && c.FWD>=1 && list.length===11;
    };

    /* outfield, in bench order — each eligible bench player who played
       fills the first blanking starter whose removal keeps a legal XI */
    for(const sub of bench.filter(p=>p.pos!=='GK')){
      if(xi.includes(sub)) continue;          // already came on (shouldn't happen, but safe)
      if(minutesOf(sub) === 0) continue;      // he didn't play either — can't help

      const blanking = xi.filter(p=>p.pos!=='GK' && minutesOf(p) === 0);
      for(const out of blanking){
        const trial = xi.map(p => p === out ? sub : p);
        if(isLegalXI(trial)){ xi = trial; break; }
      }
    }

    return xi;
  },

  /* =================================================
     SCORING — the correct team total for one GW.
     starters (auto-sub corrected) + captain doubling (or
     ×3 with Triple Captain); Bench Boost adds bench points
     — and skips auto-sub entirely, since every bench player
     already counts in full so there's nothing to correct;
     transfer hits are subtracted when we have them from FPL.
     If a snapshot for this GW doesn't exist yet we fall back
     to today's starters/bench so the current GW still reads
     right before its first mutation.
  ================================================= */
  gwPointsFor(gw){
    /* if linked, FPL's own tally is authoritative (and already
       includes real auto-subs, so nothing more to do here) */
    const hist = this.gwHistory[gw];
    if(hist && Number.isFinite(hist.points)){
      const cost = Number.isFinite(hist.transferCost) ? hist.transferCost : 0;
      return hist.points - cost;
    }

    const chip     = this.chipOf(gw);
    const starters = chip === 'bboost' ? this.startersForGW(gw) : this.autoSubStarters(gw);
    const eff      = this.effectiveCaptain(gw);
    const capMult  = this.capMultFor(gw);

    let total = 0;
    for(const p of starters){
      const pts = this.pointsIn(p, gw) ?? 0;
      const mult = (eff.player && p.id === eff.player.id) ? capMult : 1;
      total += pts * mult;
    }
    if(chip === 'bboost'){
      for(const p of this.benchForGW(gw)){
        total += this.pointsIn(p, gw) ?? 0;
      }
    }
    return total;
  },

  seasonPointsTotal(){
    /* prefer the FPL account total if linked — matches the app exactly */
    if(this.entryMeta && Number.isFinite(this.entryMeta.totalPoints)){
      return this.entryMeta.totalPoints;
    }
    /* otherwise sum every played GW using the corrected per-GW formula */
    let total = 0;
    const played = new Set();
    this.squad.forEach(p => (p.history||[]).forEach(h => played.add(h.gw)));
    for(const gw of played) total += this.gwPointsFor(gw);
    return total;
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
  /* Has this gameweek actually been played? Two independent signals, so
     this still works offline and for an unlinked squad: official per-GW
     totals if we have them, otherwise any player carrying history for
     that week. Either means the week is over and its record is final. */
  hasBeenPlayed(gw){
    if(this.gwHistory?.[gw]) return true;
    return this.squad.some(p => (p.history || []).some(h => h.gw === gw));
  },

  snapshotLineup(gw){
    /* Defence in depth. editableGW() normally keeps us off a finished
       week, but it needs deadline data — and a cached or offline boot
       has none, which is exactly how a played gameweek got overwritten
       with the following week's XI. A week that has already been scored
       is history: never re-snapshot it. */
    if(this.lineups[gw] && this.hasBeenPlayed(gw)) return;

    const active = this.activeSquad();
    this.lineups[gw] = {
      memberIds : active.map(p => p.id),
      starterIds: active.filter(p => p.start).map(p => p.id)
    };
  },

  /* -------------------------------------------------
     PAST-GW LINEUP EDITS (backfill mode)

     These write only into lineups[gw]; today's active squad is
     never touched. Used by Performance's past-GW modal when the
     GW is in the backfill window. Same validation rules as the
     current-GW mutations, applied against the snapshot's rosters.
  ------------------------------------------------- */

  _ensureLineup(gw){
    if(!this.lineups[gw]){
      this.lineups[gw] = { memberIds:[], starterIds:[] };
    }else{
      this.lineups[gw].memberIds  = this.lineups[gw].memberIds  || [];
      this.lineups[gw].starterIds = this.lineups[gw].starterIds || [];
    }
    return this.lineups[gw];
  },

  _membersOfGW(gw){
    return this._ensureLineup(gw).memberIds
      .map(id => this.playerById(id))
      .filter(Boolean);
  },

  _startersOfGW(gw){
    return this._ensureLineup(gw).starterIds
      .map(id => this.playerById(id))
      .filter(Boolean);
  },

  /* Add a pool player to a past GW's squad. If we've never seen him
     before we create a lightweight player record so his kit/name/etc.
     render everywhere; inGW is set for provenance but we don't set
     outGW (adding him elsewhere later is fine). */
  addPlayerToGW(pool, gw){
    const ln  = this._ensureLineup(gw);
    const mem = this._membersOfGW(gw);
    if(mem.length >= CONFIG.SQUAD.TOTAL) return { ok:false, reason:'This gameweek already has 15 players' };
    if(this.countPosInMembers(mem, pool.pos) >= CONFIG.SQUAD[pool.pos])
      return { ok:false, reason:`GW${gw} already has ${CONFIG.SQUAD[pool.pos]} ${CONFIG.POS_LABEL[pool.pos].toLowerCase()}` };
    if(ln.memberIds.includes(pool.id)) return { ok:false, reason:'Already in this gameweek' };

    const clubIssue = this.teamLimitIssue(pool, { members: mem });
    if(clubIssue) return { ok:false, reason:clubIssue };

    if(!this.playerById(pool.id)){
      /* backfill-only player — mark retired at this GW so he only
         appears in past snapshots that include him, never in today's
         active squad. Real transfers set outGW = currentGW; a snapshot
         cameo sets it the same way. */
      this.squad.push({
        id: pool.id, name: pool.name, team: pool.team, teamId: pool.teamId,
        pos: pool.pos, price: pool.price,
        start: false, inGW: gw, outGW: gw, history: []
      });
      save(CONFIG.STORE.squad, this.squad);
    }

    ln.memberIds.push(pool.id);
    this.persistLineups();
    emit('squad');
    return { ok:true };
  },

  countPosInMembers(members, pos){ return members.filter(p => p.pos === pos).length; },

  removePlayerFromGW(id, gw){
    const ln = this._ensureLineup(gw);
    ln.memberIds  = ln.memberIds.filter(x => x !== id);
    ln.starterIds = ln.starterIds.filter(x => x !== id);
    /* if he still hasn't been captain here, no armband cleanup needed */
    if(this.captains[gw] === id) delete this.captains[gw];
    if(this.vices[gw]    === id) delete this.vices[gw];
    this.persistLineups();
    this.persistCaps();
    emit('squad');
  },

  /* Same-position swap inside a past GW's roster. Outgoing player is
     removed from memberIds/starterIds (no outGW dance, since we only
     edit this GW's snapshot); incoming inherits the start flag. */
  transferInGW(outId, pool, gw){
    const ln  = this._ensureLineup(gw);
    if(!ln.memberIds.includes(outId)) return { ok:false, reason:'Player not in this GW squad' };
    const outP = this.playerById(outId);
    if(!outP) return { ok:false, reason:'Outgoing player not found' };
    if(outP.pos !== pool.pos) return { ok:false, reason:`Same-position only (${outP.pos})` };
    if(ln.memberIds.includes(pool.id)) return { ok:false, reason:'Already in this GW squad' };

    const clubIssue = this.teamLimitIssue(pool, { members: this._membersOfGW(gw), replacingId: outId });
    if(clubIssue) return { ok:false, reason:clubIssue };

    if(!this.playerById(pool.id)){
      /* backfill-only player — see comment in addPlayerToGW */
      this.squad.push({
        id: pool.id, name: pool.name, team: pool.team, teamId: pool.teamId,
        pos: pool.pos, price: pool.price,
        start: false, inGW: gw, outGW: gw, history: []
      });
      save(CONFIG.STORE.squad, this.squad);
    }

    const wasStarting = ln.starterIds.includes(outId);
    ln.memberIds  = ln.memberIds.map(x => x === outId ? pool.id : x);
    ln.starterIds = ln.starterIds.filter(x => x !== outId);
    if(wasStarting) ln.starterIds.push(pool.id);

    if(this.captains[gw] === outId) delete this.captains[gw];
    if(this.vices[gw]    === outId) delete this.vices[gw];
    this.persistLineups();
    this.persistCaps();
    emit('squad');
    return { ok:true };
  },

  /* Start or bench a player within a past GW. Same formation rules
     as the live toggleStart. */
  startInGW(id, gw){
    const ln = this._ensureLineup(gw);
    if(!ln.memberIds.includes(id)) return { ok:false, reason:'Player not in this GW squad' };
    if(ln.starterIds.includes(id)) return { ok:true };
    const p = this.playerById(id);
    if(!p) return { ok:false };

    const starters = this._startersOfGW(gw);
    if(p.pos === 'GK'){
      const gk = starters.find(x => x.pos === 'GK');
      if(gk) ln.starterIds = ln.starterIds.filter(x => x !== gk.id);
    }else{
      const outfield = starters.filter(x => x.pos !== 'GK').length;
      if(outfield >= CONFIG.SQUAD.STARTERS - CONFIG.SQUAD.START_GK)
        return { ok:false, reason:'Already 10 outfield starters — bench one first' };
    }
    ln.starterIds.push(id);
    this.persistLineups();
    emit('squad');
    return { ok:true };
  },

  benchInGW(id, gw){
    const ln = this._ensureLineup(gw);
    if(!ln.starterIds.includes(id)) return { ok:true };
    const p = this.playerById(id);
    if(!p) return { ok:false };

    if(p.pos === 'GK')
      return { ok:false, reason:'You must always start one goalkeeper. Promote the other keeper — that swaps them.' };

    const starters = this._startersOfGW(gw);
    const samePos = starters.filter(x => x.pos === p.pos).length;
    if(samePos <= this.MIN_START[p.pos])
      return { ok:false, reason:`A legal XI needs at least ${this.MIN_START[p.pos]} ${CONFIG.POS_LABEL[p.pos].toLowerCase()}` };

    ln.starterIds = ln.starterIds.filter(x => x !== id);
    this.persistLineups();
    emit('squad');
    return { ok:true };
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
    this.advanceFreeTransfers(this.currentGW);
    this.lastKnownGW = Math.max(this.lastKnownGW, this.currentGW);
    this.persistLineups();
  },

  /* Bank one free transfer for every gameweek crossed since this was
     last checked, capped at 5. A wildcard/free-hit week doesn't bank
     an extra one either — you get unlimited moves that week instead,
     so the count just carries over unchanged. transfer() below is what
     actually spends one, at the moment a real transfer happens; this
     only ever adds. */
  advanceFreeTransfers(uptoGW){
    const from = Math.max(1, (this.freeTransfersSeenGW || 0) + 1);
    for(let gw = from; gw < uptoGW; gw++){
      const chip = this.chips[gw];
      if(chip !== 'wildcard' && chip !== 'freehit'){
        this.freeTransfers = Math.min(5, this.freeTransfers + 1);
      }
    }
    this.freeTransfersSeenGW = Math.max(this.freeTransfersSeenGW, uptoGW - 1);
    this.persistFreeTransfers();
  },

  persistFreeTransfers(){
    save(CONFIG.STORE.freeTransfers, this.freeTransfers);
    save(CONFIG.STORE.freeTransfersSeenGW, this.freeTransfersSeenGW);
    emit('freeTransfers');
  },

  persistSquad(){
    /* Snapshot the gameweek these edits actually count for. Once a
       deadline has passed that is the NEXT gameweek — snapshotting
       currentGW there would overwrite a finished week's record. */
    this.snapshotLineup(this.editableGW());
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
      managerId:   this.managerId,
      entryMeta:   this.entryMeta,
      chips:       this.chips,
      gwHistory:   this.gwHistory,
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
    this.dedupeSquad();
    this.lastKnownGW = Number.isFinite(s.lastKnownGW) ? s.lastKnownGW : this.lastKnownGW;
    this.managerId   = Number.isFinite(s.managerId) ? s.managerId : this.managerId;
    this.entryMeta   = (s.entryMeta   && typeof s.entryMeta   === 'object') ? s.entryMeta   : this.entryMeta;
    this.chips       = (s.chips       && typeof s.chips       === 'object') ? s.chips       : {};
    this.gwHistory   = (s.gwHistory   && typeof s.gwHistory   === 'object') ? s.gwHistory   : {};
    save(CONFIG.STORE.squad,     this.squad);
    save(CONFIG.STORE.draft,     this.draft);
    save(CONFIG.STORE.cands,     this.candidates);
    save(CONFIG.STORE.caps,      this.captains);
    save(CONFIG.STORE.vices,     this.vices);
    save(CONFIG.STORE.lineups,   this.lineups);
    save(CONFIG.STORE.lastGW,    this.lastKnownGW);
    save(CONFIG.STORE.chips,     this.chips);
    save(CONFIG.STORE.gwHistory, this.gwHistory);
    if(this.managerId != null) save(CONFIG.STORE.manager, this.managerId);
    if(this.entryMeta)         save(CONFIG.STORE.entryMeta, this.entryMeta);
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

  /* Price-adjusted ratio: the same position-average ratio, scaled down
     for a player who costs more than the "reference" £6m and up for
     one who costs less. A £6m player at exactly the position average
     scores 1.0 on both ratio and this — the two only diverge as price
     moves away from the middle of the market. */
  valueRatioFor(ratio, price){
    return ratio / Math.max(0.1, price / 6);
  },

  /* The three-metric grade the Grading System plan called for (raw
     points + points-vs-position-average + value), folded into the
     grade colour itself rather than only the "Above expectation" star
     card. Equal-weighted average of the plain position ratio and the
     value ratio above — a budget player who modestly beats his
     position average now grades better than an identically-modest
     premium player, instead of both reading the same colour.
     This is a judgement call on the weighting, not something
     backtested the way the fixture-difficulty model was — watch it
     for a few gameweeks rather than trusting it blindly. */
  blendedGradeRatio(ratio, price){
    return (ratio + this.valueRatioFor(ratio, price)) / 2;
  },

  gradeGW(player, gw){
    const pts = this.pointsIn(player, gw);
    if(pts === null) return { grade:null, pts:null };
    const avg = this.posAvg?.[gw]?.[player.pos];
    if(!avg) return { grade:'amber', pts };
    const ratio = pts/avg;
    const blended = this.blendedGradeRatio(ratio, player.price);
    return { grade:this.gradeFromRatio(blended), pts, ratio, blended };
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
    const ratio = total/avgSum;
    const blended = this.blendedGradeRatio(ratio, player.price);
    return { grade:this.gradeFromRatio(blended), pts:total, ratio, blended };
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
    const ratio = poolPlayer.total/expected;
    const blended = this.blendedGradeRatio(ratio, poolPlayer.price);
    return { grade:this.gradeFromRatio(blended), pts:poolPlayer.total, ratio, blended };
  },

  /* =================================================
     OWNERSHIP RISK / REWARD

     How much your transfer decisions are costing or earning
     you relative to the rest of the field, using ownership
     as the weight. Two symmetric ideas:

     - Sell a player owned by O% of managers, and he keeps
       scoring: that O% of the field is banking points you
       aren't, so you fall behind the average manager by
       roughly O% of whatever he's scored since he left.
     - Hold a player owned by only O%, and he scores: almost
       nobody else gets those points, so you pull AHEAD of
       the average manager by roughly (100-O)% of what he's
       scored while actually starting for you.

     Explicitly approximate, and said so in the UI: the FPL
     API has no historical per-gameweek ownership, only the
     current snapshot, so a sale from ten gameweeks ago is
     weighted by today's ownership, not what it was then. Good
     enough for "did that recent sale burn me", much shakier
     the further back a transfer sits — which is exactly why
     this is a rough placeholder, not a scoreboard.
  ================================================= */

  /* every player ever sold, and the points he's scored since
     leaving, weighted by how much of the field still has him */
  soldPlayerRisk(){
    const sold = this.squad.filter(p => p.outGW != null);
    const rows = sold.map(p => {
      const pool = this.pool.find(x => x.id === p.id);
      const ownership = pool ? pool.selected : 0;
      const pointsSince = (p.history || [])
        .filter(h => h.gw >= p.outGW)
        .reduce((s,h) => s + h.points, 0);
      return { player:p, ownership, pointsSince, risk: ownership/100 * pointsSince };
    }).filter(r => r.pointsSince > 0)
      .sort((a,b) => b.risk - a.risk);

    return { total: rows.reduce((s,r) => s + r.risk, 0), rows };
  },

  /* every currently-owned player, and the points he's scored
     while actually starting for you since he joined, weighted
     by how little of the field shares him */
  differentialReward(){
    const rows = this.activeSquad().map(p => {
      const pool = this.pool.find(x => x.id === p.id);
      const ownership = pool ? pool.selected : 0;
      const since = p.inGW || 1;
      let pointsSince = 0;
      for(let gw = since; gw <= this.currentGW; gw++){
        if(this.startersForGW(gw).some(x => x.id === p.id)){
          pointsSince += this.pointsIn(p, gw) ?? 0;
        }
      }
      return { player:p, ownership, pointsSince, reward: (1 - ownership/100) * pointsSince };
    }).filter(r => r.pointsSince > 0)
      .sort((a,b) => b.reward - a.reward);

    return { total: rows.reduce((s,r) => s + r.reward, 0), rows };
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

  /* =================================================
     MOOD — the grade colour of the most recently played
     gameweek's XI, used to tint the app's ambient
     background. Purely cosmetic; never affects logic.
  ================================================= */
  lastGWMoodColor(){
    const weeks = new Set();
    this.squad.forEach(p=>(p.history||[]).forEach(h=>weeks.add(h.gw)));
    const played = [...weeks].sort((a,b)=>a-b);
    if(!played.length) return null;

    const gw = played.at(-1);
    const starters = this.startersForGW(gw);
    if(!starters.length) return null;

    /* blended, not the plain ratio — so the background matches the
       same grade colour the pitch itself is showing */
    const ratios = starters
      .map(p=>this.gradeGW(p, gw).blended)
      .filter(Number.isFinite);
    if(!ratios.length) return null;

    const avg = ratios.reduce((a,b)=>a+b,0) / ratios.length;
    if(avg >= CONFIG.GRADE_CUTS.blue)  return 'blue';
    if(avg >= CONFIG.GRADE_CUTS.green) return 'green';
    if(avg >= CONFIG.GRADE_CUTS.amber) return 'amber';
    return 'red';
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
     LINKED FPL ACCOUNT
     One-way sync: the official picks endpoint is the
     source of truth for squad / XI / captain / vice per
     GW. Local notes, Hold/Watch/Swap flags and Draft
     candidates are always preserved.
  ================================================= */

  linkManager(id){
    const n = parseInt(id, 10);
    if(!Number.isFinite(n) || n <= 0) return { ok:false, reason:'Manager id must be a positive number' };
    this.managerId = n;
    save(CONFIG.STORE.manager, this.managerId);
    return { ok:true };
  },

  unlinkManager(){
    this.managerId = null;
    this.entryMeta = null;
    localStorage.removeItem(CONFIG.STORE.manager);
    localStorage.removeItem(CONFIG.STORE.entryMeta);
    emit('sync');
  },

  /* Pull the official record for every played gameweek. Overwrites:
       lineups[gw].memberIds / starterIds
       captains[gw], vices[gw]
       Store.squad's active membership / start flags (reconstructed
         from the union of all picks; retired players get outGW so
         they only appear in past snapshots) — but ONLY once FPL has
         posted picks for the current gameweek itself. Until then the
         local working squad (today's transfers/XI edits) is left
         exactly as-is rather than reconciled against a stale GW.
     Leaves untouched: draft (notes/flags), candidates. */
  async syncFromFPL(API){
    if(!this.managerId) return { ok:false, reason:'No FPL account linked' };
    if(!API || !this.pool.length) return { ok:false, reason:'API bootstrap must run first' };

    const profile = await API.entry(this.managerId);
    if(!profile) return { ok:false, reason:'Could not fetch that manager — id may be wrong' };
    this.entryMeta = {
      teamName    : profile.teamName,
      managerName : profile.managerName,
      rank        : profile.rank,
      totalPoints : profile.totalPoints,
      chips       : profile.chips,
      syncedAt    : Date.now()
    };
    save(CONFIG.STORE.entryMeta, this.entryMeta);

    /* Pull picks for every GW from 1 to currentGW plus the per-GW
       totals from entryHistory. Failed picks endpoints (e.g. GW whose
       deadline hasn't passed) are swallowed. */
    const pickPromises = [];
    for(let gw = 1; gw <= this.currentGW; gw++){
      pickPromises.push(API.entryPicks(this.managerId, gw).then(p => ({ gw, p })));
    }
    const [pickResults, historyRaw] = await Promise.all([
      Promise.all(pickPromises),
      API.entryHistory(this.managerId)
    ]);

    /* Union of every element the manager has ever fielded. */
    const seen = new Map();  // id → { first: gw, last: gw }
    for(const { gw, p } of pickResults){
      if(!p) continue;

      this.lineups[gw] = {
        memberIds : p.picks.map(x => x.element),
        starterIds: p.picks.filter(isStartingPick).map(x => x.element),
      };
      const cap  = p.picks.find(x => x.isCaptain);
      const vice = p.picks.find(x => x.isVice);
      if(cap)  this.captains[gw] = cap.element;
      if(vice) this.vices[gw]    = vice.element;

      /* chip in effect that GW, if any — 3xc / bboost / wildcard / freehit */
      if(p.activeChip) this.chips[gw] = p.activeChip;
      else if(this.chips[gw]) delete this.chips[gw];

      for(const pick of p.picks){
        const rec = seen.get(pick.element) || { first: gw, last: gw };
        rec.first = Math.min(rec.first, gw);
        rec.last  = Math.max(rec.last,  gw);
        seen.set(pick.element, rec);
      }
    }

    /* per-GW official totals + transfer costs — the authoritative
       numbers the hero uses in place of our own computation */
    this.gwHistory = {};
    for(const h of (historyRaw?.current || [])){
      this.gwHistory[h.event] = {
        points        : h.points,
        totalPoints   : h.total_points,
        transferCost  : h.event_transfers_cost || 0,
        transfers     : h.event_transfers || 0,
        pointsOnBench : h.points_on_bench || 0,
        rank          : h.rank,
        overallRank   : h.overall_rank,
      };
    }
    save(CONFIG.STORE.chips,     this.chips);
    save(CONFIG.STORE.gwHistory, this.gwHistory);

    /* Only the picks fetched for the CURRENT gameweek can decide who's
       active today. If FPL hasn't posted them yet (deadline hasn't
       passed), falling back to an older GW's picks would revive a
       player you've since transferred out locally while his local
       replacement also survives (he's still sitting in this GW's own
       lineup snapshot, which never got overwritten) — both end up
       "active" at once and the XI count goes over 11. So when today's
       official picks aren't in yet, skip this reconciliation entirely
       and leave the local working squad exactly as you left it; the
       next sync that lands on a real deadline will settle it. */
    const currentPicks = pickResults.find(r => r.gw === this.currentGW)?.p || null;

    if(currentPicks){
      const currentIds = new Set(currentPicks.picks.map(x => x.element));
      const currentStartFlag = id => {
        const pick = currentPicks.picks.find(x => x.element === id);
        return pick ? isStartingPick(pick) : false;
      };

      /* Rebuild Store.squad from the union. Keep existing entries so
         notes/history survive; add missing ones from the pool. */
      for(const [id, span] of seen.entries()){
        const pool = this.pool.find(p => p.id === id);
        if(!pool) continue;
        let existing = this.squad.find(p => p.id === id);
        if(!existing){
          existing = {
            id, name: pool.name, team: pool.team, teamId: pool.teamId,
            pos: pool.pos, price: pool.price,
            start: currentStartFlag(id), inGW: span.first, outGW: null, history: []
          };
          this.squad.push(existing);
        }else{
          /* refresh mutable pool-derived fields */
          existing.name = pool.name; existing.team = pool.team;
          existing.teamId = pool.teamId; existing.price = pool.price;
          existing.pos = pool.pos;
          if(existing.inGW == null) existing.inGW = span.first;
        }
        if(currentIds.has(id)){
          existing.outGW = null;
          existing.start = currentStartFlag(id);
        }else{
          /* not in today's official lineup → retired at the GW after his last appearance */
          if(existing.outGW == null) existing.outGW = span.last + 1;
          existing.start = false;
        }
      }
      /* Anyone in Store.squad who never appears in any FPL snapshot is
         stale local data (from before the link) — drop him unless he's
         held in a manual lineup snapshot we haven't overwritten. */
      this.squad = this.squad.filter(p => {
        if(seen.has(p.id)) return true;
        return Object.values(this.lineups).some(ln => ln?.memberIds?.includes(p.id));
      });
    }

    this.dedupeSquad();
    save(CONFIG.STORE.squad, this.squad);
    this.persistLineups();
    this.persistCaps();

    /* backfill player histories for anyone we don't have — fires in
       the background; the UI re-renders as each one lands */
    for(const p of this.squad){
      if(!p.history?.length){
        API.playerHistory(p.id).then(h => {
          if(h){ p.history = h; save(CONFIG.STORE.squad, this.squad); emit('squad'); }
        });
      }
    }

    emit('sync');
    return { ok:true, meta:this.entryMeta };
  },

  /* =================================================
     RESET
  ================================================= */

  resetAll(){
    [CONFIG.STORE.squad, CONFIG.STORE.draft, CONFIG.STORE.cands,
     CONFIG.STORE.caps,  CONFIG.STORE.vices, CONFIG.STORE.lineups,
     CONFIG.STORE.lastGW, CONFIG.STORE.manager, CONFIG.STORE.entryMeta,
     CONFIG.STORE.chips, CONFIG.STORE.gwHistory,
     CONFIG.STORE.freeTransfers, CONFIG.STORE.freeTransfersSeenGW
    ].forEach(k=>localStorage.removeItem(k));
    this.squad = []; this.draft = {}; this.candidates = {};
    this.captains = {}; this.vices = {};
    this.lineups = {}; this.lastKnownGW = 0;
    this.managerId = null; this.entryMeta = null;
    this.chips = {}; this.gwHistory = {};
    this.freeTransfers = 1; this.freeTransfersSeenGW = 0;
    emit('reset');
  }
};

/* one-time cleanup of whatever loaded from localStorage on boot */
Store.dedupeSquad();

export default Store;
