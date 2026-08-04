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
  API_BASE : 'https://fantasy.premierleague.com/api',

  ENDPOINTS: {
    bootstrap : '/bootstrap-static/',      // all players, teams, current GW
    fixtures  : '/fixtures/',              // all 380 fixtures
    playerHist: '/element-summary/{id}/',  // one player's full season history
    liveGW    : '/event/{gw}/live/'        // every player's points for one GW
  },

  /* ---------- refresh ---------- */
  REFRESH_HOUR: 4,                 // daily data refresh at 04:00 local
  CACHE_TTL_MS: 1000*60*60*12,

  /* ---------- storage keys ---------- */
  STORE: {
    squad     : 'fpl2627_squad',
    draft     : 'fpl2627_draft',
    cands     : 'fpl2627_candidates',
    bootstrap : 'fpl2627_bootstrap_cache',
    settings  : 'fpl2627_settings'
  },

  /* ---------- squad rules (FPL, fixed) ---------- */
  SQUAD: {
    GK:2, DEF:5, MID:5, FWD:3,
    TOTAL:15, STARTERS:11, BENCH:4,
    START_GK:1                      // exactly one keeper starts
  },

  POS_ORDER: ['GK','DEF','MID','FWD'],
  POS_LABEL: { GK:'Goalkeepers', DEF:'Defenders', MID:'Midfielders', FWD:'Forwards' },

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
