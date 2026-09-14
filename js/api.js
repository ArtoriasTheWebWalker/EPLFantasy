/* =====================================================
   API — every network call to the FPL API lives here.
   No other file talks to the network.

   ⚠️  WIRING POINT
   The FPL API sends no CORS header, so a browser on
   GitHub Pages cannot call it directly. Set
   CONFIG.API_PROXY in js/config.js to a proxy URL and
   everything below starts working unchanged.
   Until then the app runs in LOCAL MODE: it reads
   whatever is in localStorage and shows a banner.
===================================================== */

import { CONFIG } from './config.js';

/* ---------- low level ---------- */

function url(path){
  return CONFIG.API_PROXY + encodeURI(CONFIG.API_BASE + path);
}

async function getJSON(path){
  const res = await fetch(url(path), { headers:{ 'Accept':'application/json' } });
  if(!res.ok) throw new Error(`FPL API ${res.status} on ${path}`);
  return res.json();
}

/* ---------- cache ---------- */

function readCache(key){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return null;
    const { at, data } = JSON.parse(raw);
    if(Date.now() - at > CONFIG.CACHE_TTL_MS) return null;
    return data;
  }catch{ return null; }
}

function writeCache(key, data){
  try{ localStorage.setItem(key, JSON.stringify({ at:Date.now(), data })); }catch{}
}

/* =====================================================
   PUBLIC API
===================================================== */

export const API = {

  /* live status, flipped by bootstrap() */
  online: false,
  lastError: null,

  /* -------------------------------------------------
     bootstrap — the big one. Returns:
       { players, teams, currentGW, posAverages }
     Shapes are normalised here so the rest of the app
     never sees raw FPL field names.
  ------------------------------------------------- */
  async bootstrap({ force=false } = {}){
    if(!force){
      const cached = readCache(CONFIG.STORE.bootstrap);
      if(cached){ this.online = true; return cached; }
    }

    try{
      const raw = await getJSON(CONFIG.ENDPOINTS.bootstrap);

      const teamById = {};
      raw.teams.forEach(t=>{
        teamById[t.id] = { id:t.id, name:t.name, short:t.short_name, strength:t.strength };
      });

      const POS = { 1:'GK', 2:'DEF', 3:'MID', 4:'FWD' };

      const players = raw.elements.map(e=>({
        id      : e.id,
        name    : e.web_name,
        fullName: `${e.first_name} ${e.second_name}`,
        pos     : POS[e.element_type],
        teamId  : e.team,
        team    : teamById[e.team]?.short || '???',
        price   : e.now_cost / 10,
        total   : e.total_points,
        gwPoints: e.event_points ?? null,   // his points in the CURRENT gameweek
        form    : parseFloat(e.form) || 0,
        ppg     : parseFloat(e.points_per_game) || 0,
        selected: parseFloat(e.selected_by_percent) || 0,
        status  : e.status,            // a=available, i=injured, d=doubtful
        news    : e.news || ''
      }));

      const currentEvent = raw.events.find(ev=>ev.is_current)
                        || raw.events.find(ev=>ev.is_next)
                        || raw.events[0];

      const out = {
        players,
        teams     : Object.values(teamById),
        teamById,
        currentGW : currentEvent ? currentEvent.id : 1,
        finishedGW: raw.events.filter(ev=>ev.finished).length
      };

      writeCache(CONFIG.STORE.bootstrap, out);
      this.online = true;
      this.lastError = null;
      return out;

    }catch(err){
      this.online = false;
      this.lastError = err.message;
      return null;
    }
  },

  /* -------------------------------------------------
     playerHistory(id) — full per-GW history for one
     player. Used when a player joins the squad so his
     earlier gameweeks backfill automatically.
     Returns [{ gw, points, opponent, minutes, ... }]
  ------------------------------------------------- */
  async playerHistory(id){
    try{
      const path = CONFIG.ENDPOINTS.playerHist.replace('{id}', id);
      const raw = await getJSON(path);
      return raw.history.map(h=>({
        gw       : h.round,
        points   : h.total_points,
        minutes  : h.minutes,
        goals    : h.goals_scored,
        assists  : h.assists,
        cleanSheet: h.clean_sheets,
        bonus    : h.bonus,
        saves    : h.saves,
        conceded : h.goals_conceded,
        yellow   : h.yellow_cards,
        red      : h.red_cards,
        ownGoals : h.own_goals,
        pensSaved: h.penalties_saved,
        pensMissed: h.penalties_missed,
        /* Defensive contribution: FPL already totals the right actions
           for the position — CBIT for defenders, CBIRT (those plus ball
           recoveries) for midfielders and forwards — so we keep the
           total and compare it to the position threshold in CONFIG. */
        defCon   : h.defensive_contribution,
        opponentId: h.opponent_team,
        home     : h.was_home
      }));
    }catch(err){
      this.lastError = err.message;
      return null;
    }
  },

  /* -------------------------------------------------
     liveGW(gw) — every player's points for one GW.
     Used to compute position averages for grading.
  ------------------------------------------------- */
  async liveGW(gw){
    try{
      const path = CONFIG.ENDPOINTS.liveGW.replace('{gw}', gw);
      const raw = await getJSON(path);
      const map = {};
      raw.elements.forEach(e=>{
        map[e.id] = {
          points : e.stats.total_points,
          minutes: e.stats.minutes,
          stats  : e.stats
        };
      });
      return map;
    }catch(err){
      this.lastError = err.message;
      return null;
    }
  },

  /* -------------------------------------------------
     fixtures() — all 380 matches, normalised.
  ------------------------------------------------- */
  async fixtures(){
    try{
      const raw = await getJSON(CONFIG.ENDPOINTS.fixtures);
      return raw.map(f=>({
        id      : f.id,
        gw      : f.event,
        homeId  : f.team_h,
        awayId  : f.team_a,
        homeScore: f.team_h_score,
        awayScore: f.team_a_score,
        finished: f.finished,
        kickoff : f.kickoff_time
      }));
    }catch(err){
      this.lastError = err.message;
      return null;
    }
  },

  /* -------------------------------------------------
     positionAverages(gw, players, liveMap)
     League average per position for one GW, excluding
     anyone who scored 0 — the pragmatic "did he play"
     filter agreed in planning.
  ------------------------------------------------- */
  positionAverages(players, liveMap){
    const buckets = { GK:[], DEF:[], MID:[], FWD:[] };
    players.forEach(p=>{
      const live = liveMap?.[p.id];
      if(!live) return;
      if(live.points === 0) return;          // excluded
      buckets[p.pos]?.push(live.points);
    });
    const out = {};
    for(const pos of Object.keys(buckets)){
      const arr = buckets[pos];
      out[pos] = arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;
    }
    return out;
  },

  /* =================================================
     LINKED-ACCOUNT ENDPOINTS
     All read-only. Take a numeric manager id (visible
     in the URL when a signed-in user views their team
     on fantasy.premierleague.com).
  ================================================= */

  /* Manager profile: team name, overall rank, chips used. */
  async entry(id){
    try{
      const raw = await getJSON(CONFIG.ENDPOINTS.entry.replace('{id}', id));
      return {
        id           : raw.id,
        teamName     : raw.name,
        managerName  : `${raw.player_first_name} ${raw.player_last_name}`.trim(),
        rank         : raw.summary_overall_rank,
        gwRank       : raw.summary_event_rank,
        totalPoints  : raw.summary_overall_points,
        currentEvent : raw.current_event,
        chips        : raw.chips || []
      };
    }catch(err){ this.lastError = err.message; return null; }
  },

  /* Per-GW totals and rank (used to fill history if needed). */
  async entryHistory(id){
    try{
      const raw = await getJSON(CONFIG.ENDPOINTS.entryHistory.replace('{id}', id));
      return {
        current : raw.current || [],   // [{event, points, total_points, rank, overall_rank, ...}]
        past    : raw.past    || [],
        chips   : raw.chips   || []
      };
    }catch(err){ this.lastError = err.message; return null; }
  },

  /* The XI/bench/captain/vice for one gameweek — the real record.
     Cached per-manager-per-GW so past weeks don't re-fetch. */
  async entryPicks(id, gw){
    const cacheKey = `fpl2627_picks_${id}_${gw}`;
    const cached = readCache(cacheKey);
    if(cached) return cached;
    try{
      const path = CONFIG.ENDPOINTS.entryPicks
        .replace('{id}', id).replace('{gw}', gw);
      const raw = await getJSON(path);
      const out = {
        gw,
        activeChip : raw.active_chip,
        entryHistory: raw.entry_history,
        picks: (raw.picks || []).map(p => ({
          element    : p.element,
          position   : p.position,
          /* how much he SCORES, not whether he played: 0 bench, 1 playing,
             2 captain, 3 triple captain — but Bench Boost pays the bench,
             so all 15 come back >= 1 that week. Use `position` (1-11 = XI)
             to decide the lineup; see isStartingPick in store.js. */
          multiplier : p.multiplier,
          isCaptain  : !!p.is_captain,
          isVice     : !!p.is_vice_captain
        }))
      };
      writeCache(cacheKey, out);
      return out;
    }catch(err){ this.lastError = err.message; return null; }
  },

  /* Every transfer this season. */
  async entryTransfers(id){
    try{
      const raw = await getJSON(CONFIG.ENDPOINTS.entryTransfers.replace('{id}', id));
      return raw.map(t => ({
        gw       : t.event,
        inId     : t.element_in,
        outId    : t.element_out,
        cost     : t.element_in_cost,
        sellPrice: t.element_out_cost,
        time     : t.time
      }));
    }catch(err){ this.lastError = err.message; return null; }
  },

  /* -------------------------------------------------
     leagueTable(teams, fixtures) — built from finished
     fixtures, since bootstrap has no table.
  ------------------------------------------------- */
  leagueTable(teams, fixtures){
    const row = {};
    teams.forEach(t=>{
      row[t.id] = { id:t.id, name:t.name, short:t.short, P:0,W:0,D:0,L:0,GF:0,GA:0,GD:0,Pts:0 };
    });
    (fixtures||[]).filter(f=>f.finished).forEach(f=>{
      const h = row[f.homeId], a = row[f.awayId];
      if(!h || !a) return;
      h.P++; a.P++;
      h.GF += f.homeScore; h.GA += f.awayScore;
      a.GF += f.awayScore; a.GA += f.homeScore;
      if(f.homeScore > f.awayScore){ h.W++; h.Pts+=3; a.L++; }
      else if(f.homeScore < f.awayScore){ a.W++; a.Pts+=3; h.L++; }
      else { h.D++; a.D++; h.Pts++; a.Pts++; }
    });
    return Object.values(row)
      .map(r=>({ ...r, GD:r.GF-r.GA }))
      .sort((x,y)=> y.Pts-x.Pts || y.GD-x.GD || y.GF-x.GF || x.name.localeCompare(y.name))
      .map((r,i)=>({ ...r, position:i+1 }));
  }
};

export default API;
