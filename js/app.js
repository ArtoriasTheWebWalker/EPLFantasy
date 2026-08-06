/* =====================================================
   APP — the shell.

   Loads each page's HTML fragment into its container,
   then hands control to that page's own module.
   This file stays small on purpose: page logic belongs
   in js/performance.js, js/draft.js, js/table.js.
===================================================== */

import { CONFIG } from './config.js';
import { API }    from './api.js';
import { Store }  from './store.js';
import { Modal }  from './ui.js';
import { Sync }   from './sync.js';

const PAGES = ['performance','draft','table'];
const loaded = {};

/* ---------- load a page fragment + its module ---------- */

async function mountPage(name){
  if(loaded[name]) { loaded[name].render?.(); return; }

  const host = document.getElementById(`page-${name}`);

  try{
    const res  = await fetch(`pages/${name}.html`);
    host.innerHTML = await res.text();
  }catch(err){
    host.innerHTML = `<div class="empty-note">Could not load pages/${name}.html<br>${err.message}</div>`;
    return;
  }

  const mod = await import(`./${name}.js`);
  loaded[name] = mod.default;
  mod.default.mount?.();
  mod.default.render?.();
}

/* ---------- tabs ---------- */

function initTabs(){
  document.querySelectorAll('.tab').forEach(tab=>{
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
      document.getElementById(`page-${tab.dataset.page}`).classList.add('active');
      window.scrollTo({ top:0 });
      mountPage(tab.dataset.page);
    };
  });
}

/* ---------- modal close ---------- */

function initModal(){
  document.getElementById('modalClose').onclick = () => Modal.close();
  document.getElementById('overlay').onclick = e => {
    if(e.target.id === 'overlay') Modal.close();
  };
  window.addEventListener('keydown', e=>{
    if(e.key === 'Escape' && Modal.isOpen()) Modal.close();
  });
}

/* ---------- cross-device sync ---------- */

function initSync(){
  const btn = document.getElementById('syncBtn');
  if(btn) btn.onclick = () => Sync.openSettings();
  Sync.refreshButton();
}

/* =====================================================
   BOOT

   1. Try the FPL API. If it answers, fill Store.pool,
      teams, fixtures, table and position averages.
   2. If it does not answer (no proxy configured yet)
      the app runs in local mode: your saved squad and
      notes still work, the player search is just empty.
===================================================== */

async function boot(){
  document.getElementById('brandSeason').textContent = CONFIG.SEASON;
  document.getElementById('footSeason').textContent  = CONFIG.SEASON;

  initTabs();
  initModal();
  initSync();

  /* first paint immediately, so the UI never waits on the network */
  await mountPage('performance');

  /* pull the cloud copy (if sync is on) and reconcile before we
     backfill history, so the API works against the right squad */
  await Sync.boot();

  /* then try to bring the data in */
  const boot = await API.bootstrap();

  if(boot){
    Store.pool      = boot.players;
    Store.teams     = boot.teams;
    Store.teamById  = boot.teamById;
    Store.currentGW = boot.currentGW;
    Store.viewGW    = boot.currentGW;

    const fx = await API.fixtures();
    if(fx){
      Store.fixtures = fx;
      Store.table    = API.leagueTable(boot.teams, fx);
    }

    /* position averages for every finished gameweek —
       needed to grade anyone, so it runs once up front */
    for(let gw=1; gw<=boot.finishedGW; gw++){
      const live = await API.liveGW(gw);
      if(live) Store.posAvg[gw] = API.positionAverages(boot.players, live);
    }

    /* backfill history for every squad member */
    for(const p of Store.squad){
      const hist = await API.playerHistory(p.id);
      if(hist) p.history = hist;
    }
    Store.persistSquad();
  }

  Store.apiState = API.online ? 'ok' : 'offline';
  Store.lastError = API.lastError;

  /* re-render whatever page is showing */
  const active = document.querySelector('.tab.active')?.dataset.page || 'performance';
  loaded[active]?.render?.();
}

/* re-render the visible page whenever the store changes */
window.addEventListener('store:change', () => {
  const active = document.querySelector('.tab.active')?.dataset.page;
  loaded[active]?.render?.();
});

boot();
