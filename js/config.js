/* =====================================================
   CONFIG — every constant lives here.
   Change a URL, a storage key or a squad rule in this
   file only; nothing else hard-codes these values.
===================================================== */

export const CONFIG = {

  /* ---------- season ---------- */
  SEASON: '2026/27',
  TOTAL_GW: 38,

  /* ---------- FPL API ----------
     The official API is free and public. These are the
     endpoints we need. If FPL changes its structure,
     this block is the only thing to edit.
     NOTE: browsers block direct calls to the FPL API
     (no CORS header), so API_PROXY is prefixed to every
     request. Set it to your own proxy when you have one.
  ------------------------------- */
  API_PROXY: '',                                         // e.g. 'https://corsproxy.io/?'
  API_BASE : 'https://fpl-proxy-abc.abdulelah12012.workers.dev',

  ENDPOINTS: {
    bootstrap    : '/bootstrap-static/',        // all players, teams, current GW
    fixtures     : '/fixtures/',                // all 380 fixtures
    playerHist   : '/element-summary/{id}/',    // one player's full season history
    liveGW       : '/event/{gw}/live/',         // every player's points for one GW
    entry        : '/entry/{id}/',              // manager profile (name, rank, chips)
    entryHistory : '/entry/{id}/history/',      // per-GW totals and rank
    entryPicks   : '/entry/{id}/event/{gw}/picks/',  // XI/bench/captain for one GW
    entryTransfers: '/entry/{id}/transfers/'    // every transfer with GW and cost
  },

  /* ---------- refresh ---------- */
  REFRESH_HOUR: 4,                 // daily data refresh at 04:00 local
  CACHE_TTL_MS: 1000*60*60*12,

  /* ---------- storage keys ---------- */
  STORE: {
    squad     : 'fpl2627_squad',
    draft     : 'fpl2627_draft',
    cands     : 'fpl2627_candidates',
    caps      : 'fpl2627_captains',        // { [gw]: playerId } — per-GW captain
    vices     : 'fpl2627_vices',           // { [gw]: playerId } — per-GW vice
    lineups   : 'fpl2627_lineups',         // { [gw]: { memberIds, starterIds } }
    lastGW    : 'fpl2627_last_known_gw',   // number — last currentGW we saw
    manager   : 'fpl2627_manager_id',      // linked FPL manager (integer)
    entryMeta : 'fpl2627_entry_meta',      // { teamName, rank, ... }
    chips     : 'fpl2627_chips',           // { [gw]: '3xc'|'bboost'|'wildcard'|'freehit' }
    gwHistory : 'fpl2627_gw_history',      // { [gw]: {points, transferCost, ...} } from FPL entryHistory
    bootstrap : 'fpl2627_bootstrap_cache_v2',   // _v2: player shape gained gwPoints
    settings  : 'fpl2627_settings'
  },

  /* ---------- squad rules (FPL, fixed) ----------
     Verified 2026-09-14 against the live engine's own config
     (bootstrap-static → game_config.rules + element_types).
  ----------------------------------------------- */
  SQUAD: {
    GK:2, DEF:5, MID:5, FWD:3,
    TOTAL:15, STARTERS:11, BENCH:4,
    START_GK:1,                     // exactly one keeper starts
    TEAM_LIMIT:3,                   // squad_team_limit — max per real club, absolute
    BUDGET:100.0                    // squad_total_spend 1000 ÷ ui_currency_multiplier 10
  },

  POS_ORDER: ['GK','DEF','MID','FWD'],
  POS_LABEL: { GK:'Goalkeepers', DEF:'Defenders', MID:'Midfielders', FWD:'Forwards' },

  /* ---------- defensive contribution ----------
     Hit the threshold in a match and you get a flat +2, capped.
     Defenders count CBIT (clearances, blocks, interceptions,
     tackles); midfielders and forwards count CBIRT — the same four
     PLUS ball recoveries — against a higher bar. Keepers aren't
     eligible. The API's defensive_contribution field already holds
     the right total per position, so we only need the threshold.
  --------------------------------------------- */
  DEFCON: { DEF:10, MID:12, FWD:12 },
  DEFCON_POINTS: 2,

  /* ---------- chips ----------
     Two sets across the season: one of each per half. The first set
     expires at the GW19 deadline and does NOT carry over.
  ---------------------------- */
  CHIP_HALF_END: 19,               // last GW of the first set

  /* ---------- grade thresholds ----------
     ratio = player points / position average that week
  --------------------------------------- */
  GRADE_CUTS: { blue:1.8, green:1.15, amber:0.6 },
  GRADE_WORD: { blue:'Exceptional', green:'Good', amber:'Average', red:'Underperformed' },

  /* ---------- fixture difficulty tiers ----------
     derived from live league position
  ----------------------------------------------- */
  TIER_BANDS: [
    { max:5,  tier:1, label:'Very hard', color:'#FF4D4F' },
    { max:10, tier:2, label:'Hard',      color:'#FF8C42' },
    { max:14, tier:3, label:'Mid',       color:'#FFB703' },
    { max:17, tier:4, label:'Ok',        color:'#94D552' },
    { max:20, tier:5, label:'Easy',      color:'#4BD07A' }
  ]
};

/* club kit styles — used by the shirt graphic */
export const KITS = {
  ARS:'linear-gradient(180deg,#EF0107 0 55%,#F5F7FA 55% 100%)',
  AVL:'linear-gradient(90deg,#95BFE5 0 32%,#670E36 32% 100%)',
  BOU:'repeating-linear-gradient(90deg,#DA291C 0 6px,#000000 6px 12px)',
  BRE:'repeating-linear-gradient(90deg,#E30613 0 6px,#FFFFFF 6px 12px)',
  BHA:'repeating-linear-gradient(90deg,#0057B8 0 6px,#FFFFFF 6px 12px)',
  BUR:'linear-gradient(180deg,#6C1D45 0 70%,#99D6EA 70% 100%)',
  CHE:'#034694',
  CRY:'repeating-linear-gradient(90deg,#1B458F 0 7px,#C4122E 7px 14px)',
  EVE:'#003399',
  FUL:'linear-gradient(180deg,#FFFFFF 0 72%,#000000 72% 100%)',
  IPS:'#3A64A3',
  LEE:'#FFFFFF',
  LEI:'#003090',
  LIV:'#C8102E',
  MCI:'#6CABDD',
  MUN:'#DA291C',
  NEW:'repeating-linear-gradient(90deg,#241F20 0 6px,#FFFFFF 6px 12px)',
  NFO:'#E53233',
  SOU:'repeating-linear-gradient(90deg,#D71920 0 7px,#FFFFFF 7px 14px)',
  SUN:'repeating-linear-gradient(90deg,#EB172B 0 6px,#FFFFFF 6px 12px)',
  TOT:'linear-gradient(180deg,#FFFFFF 0 78%,#132257 78% 100%)',
  WHU:'linear-gradient(90deg,#7A263A 0 70%,#1BB1E7 70% 100%)',
  WOL:'#FDB913'
};

export default CONFIG;
