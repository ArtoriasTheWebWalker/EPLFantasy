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

/* ---------- small concurrency-limited map ----------
   await Promise.all(items.map(fn)) fires every request at once, which
   is what the boot sequence used to do one at a time in a plain loop
   instead — 15-35 sequential round trips through the proxy by
   mid-season. This runs a bounded number of workers in parallel
   instead of either extreme: fast, without hammering the Worker. */
async function mapLimit(items, limit, fn){
  const results = new Array(items.length);
  let i = 0;
  async function worker(){
    while(i < items.length){
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

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

function activatePage(name){
  /* there are now two navs sharing the same data-page values — the
     header tabs (desktop) and the fixed bottom bar (phone) — so every
     button for this page needs the active class, not just whichever
     one was clicked. */
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.page === name));
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
}

function initTabs(){
  document.querySelectorAll('.tab').forEach(tab=>{
    tab.onclick = () => {
      activatePage(tab.dataset.page);
      try{ localStorage.setItem(CONFIG.STORE.lastPage, tab.dataset.page); }catch{}
      window.scrollTo({ top:0 });
      mountPage(tab.dataset.page);
    };
  });
}

/* ---------- header, frosted on scroll ---------- */

function initHeaderScroll(){
  const header = document.querySelector('header');
  if(!header) return;
  let ticking = false;
  const apply = () => { header.classList.toggle('scrolled', window.scrollY > 6); ticking = false; };
  window.addEventListener('scroll', () => {
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(apply);
  }, { passive:true });
  apply();
}

/* ---------- deadline countdown ---------- */

function formatCountdown(ms){
  if(ms <= 0) return 'deadline passed';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if(d > 0)  return `${d}d ${h}h`;
  if(h > 0)  return `${h}h ${m}m`;
  return `${m}m`;
}

function renderDeadline(){
  const el = document.getElementById('deadlineChip');
  if(!el) return;

  const gw = Store.editableGW ? Store.editableGW() : Store.currentGW;
  const deadline = Store.deadlines?.[gw];
  if(!deadline){ el.hidden = true; return; }

  const ms = deadline - Date.now();
  el.hidden = false;
  el.classList.toggle('soon', ms > 0 && ms < 1000*60*60*24);
  el.classList.toggle('passed', ms <= 0);
  el.innerHTML = `<b>GW${gw}</b> ${ms > 0 ? formatCountdown(ms) : 'deadline passed'}`;
}

/* ---------- ambient mood ----------
   Tints the background's floodlight orb toward how the most recently
   played gameweek actually went — purely cosmetic, computed from the
   same grade colours the pitch already uses. */
function applyMoodColor(){
  const map = { blue:'var(--blue)', green:'var(--lime)', amber:'var(--amber)', red:'var(--red)' };
  const grade = Store.lastGWMoodColor?.();
  document.documentElement.style.setProperty('--mood', map[grade] || 'var(--lime)');
}

/* ---------- service worker ----------
   Caches the static shell (HTML/CSS/JS/icons) for instant repeat loads
   and basic offline access. Never touches the FPL proxy or the sync
   worker — those are a different origin and keep their own freshness
   rules in api.js / sync.js. */
function initServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
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

  Store.booting = true;

  initTabs();
  initModal();
  initSync();
  initHeaderScroll();
  initServiceWorker();

  /* reopen on whichever tab was open last, not always Performance */
  let startPage = 'performance';
  try{ startPage = localStorage.getItem(CONFIG.STORE.lastPage) || 'performance'; }catch{}
  if(!PAGES.includes(startPage)) startPage = 'performance';
  activatePage(startPage);

  /* first paint immediately, so the UI never waits on the network */
  await mountPage(startPage);

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
    Store.deadlines = boot.deadlines || {};

    /* Legacy squads carry cap/vice flags on the player. Now that the
       armband is per-GW, seed those into the maps once the real GW is
       known, then drop the flags. Idempotent after the first run. */
    Store.migrateLegacyCaptains();

    /* Any past gameweek whose deadline passed while the app was
       closed gets its lineup snapshot back-filled from the working
       state — the closest thing we have to what you had on that
       deadline day. Idempotent: past GWs already carrying a snapshot
       are never overwritten. */
    Store.seedMissedLineups();

    /* If the user linked their FPL account, pull the official record
       for every played GW. FPL wins for squad / XI / captain / vice;
       local notes and Draft flags stay untouched. Runs in background
       so first paint isn't blocked. */
    if(Store.managerId){
      Store.syncFromFPL(API).catch(err => console.warn('FPL sync failed:', err));
    }

    const fx = await API.fixtures();
    if(fx){
      Store.fixtures = fx;
      Store.table    = API.leagueTable(boot.teams, fx);
    }

    /* Position averages for every finished gameweek — needed to grade
       anyone. Used to be a plain sequential loop (one round trip at a
       time through the proxy); now runs up to 6 at once. A finished
       week's stats never change, so liveGW caches those permanently —
       only the truly in-progress gameweek (if any) re-fetches. */
    const finishedGWs = Array.from({ length: boot.finishedGW }, (_,i)=>i+1);
    await mapLimit(finishedGWs, 6, async gw=>{
      const live = await API.liveGW(gw, /* finished */ true);
      if(live) Store.posAvg[gw] = API.positionAverages(boot.players, live);
    });

    /* backfill history for every squad member, same treatment */
    await mapLimit(Store.squad, 6, async p=>{
      const hist = await API.playerHistory(p.id);
      if(hist) p.history = hist;
    });
    Store.persistSquad();
  }

  Store.apiState = API.online ? 'ok' : 'offline';
  Store.lastError = API.lastError;
  Store.booting = false;

  applyMoodColor();
  renderDeadline();
  setInterval(renderDeadline, 60000);

  /* re-render whatever page is showing */
  const active = document.querySelector('.tab.active')?.dataset.page || 'performance';
  loaded[active]?.render?.();
}

/* re-render the visible page whenever the store changes — but never
   yank a field out from under someone who's typing. Re-rendering rebuilds
   the page's inputs, which blurs the focused one; on mobile that closes
   the keyboard mid-word. So while a text field is focused we hold the
   render and run it once they leave the field. */
let pendingRender = false;

function isTyping(){
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function renderActive(){
  const active = document.querySelector('.tab.active')?.dataset.page;
  loaded[active]?.render?.();
  applyMoodColor();
  renderDeadline();
}

window.addEventListener('store:change', () => {
  if(isTyping()){ pendingRender = true; return; }
  renderActive();
});

/* caught-up render once focus leaves the field (unless focus just moved
   to another field — then keep holding) */
document.addEventListener('focusout', () => {
  if(!pendingRender) return;
  setTimeout(() => {
    if(isTyping()) return;          // moved to another input — keep waiting
    pendingRender = false;
    renderActive();
  }, 0);
});

boot();
