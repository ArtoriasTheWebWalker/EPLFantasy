/* =====================================================
   UI — shared widgets used by more than one page.
   Player chips, the modal, the player search box and
   the API status banner all live here so the three
   page files stay short.
===================================================== */

import { CONFIG, KITS } from './config.js';
import { Store } from './store.js';

/* ---------- modal ---------- */

export const Modal = {
  el(){ return document.getElementById('overlay'); },
  box(){ return document.getElementById('modalBox'); },
  body(){ return document.getElementById('modalContent'); },

  open(html, gradeColor){
    this.box().style.setProperty('--grade', gradeColor || 'var(--lime)');
    this.body().innerHTML = html;
    this.el().classList.add('open');
  },
  close(){ this.el().classList.remove('open'); },
  isOpen(){ return this.el().classList.contains('open'); }
};

/* ---------- shirt + chip ---------- */

export function shirtHTML(team){
  return `<div class="shirt" style="--kit:${KITS[team] || '#8892a0'}"></div>`;
}

/*
  Build a player chip.
  opts:
    stripe    : { text, className }  what shows in the coloured bar
    grade     : 'blue'|'green'|'amber'|'red'|null
    meta      : small line under the name
    onClick   : handler
    showCap   : draw the captain / vice badges
*/
export function chipEl(player, opts={}){
  const el = document.createElement('button');
  el.className = 'chip' + (opts.grade ? ` g-${opts.grade}` : '');
  el.dataset.pid = player.id;                 // used by drag-and-drop hit testing
  el.innerHTML = `
    ${opts.showCap && player.cap  ? '<span class="capstar">C</span>'  : ''}
    ${opts.showCap && player.vice ? '<span class="vicestar">V</span>' : ''}
    ${player.inGW ? `<span class="in-tag">IN GW${player.inGW}</span>` : ''}
    ${shirtHTML(player.team)}
    ${opts.stripe ? `<div class="pstripe ${opts.stripe.className||''}">${opts.stripe.text}</div>` : ''}
    <div class="name">${player.name}</div>
    <div class="meta">${opts.meta ?? `${player.team} · £${player.price.toFixed(1)}m`}</div>`;
  if(opts.onClick) el.onclick = () => opts.onClick(player);
  return el;
}

/* empty slot on the pitch */
export function slotEl(pos, onClick){
  const el = document.createElement('button');
  el.className = 'slot';
  el.innerHTML = `<span><span class="plus">+</span>${pos}</span>`;
  el.onclick = onClick;
  return el;
}

/* ---------- api banner (short status only) ---------- */

export function apiBanner(state){
  const map = {
    offline: { cls:'',    ico:'⚡', msg:`Local mode` },
    ok:      { cls:'ok',  ico:'●', msg:`Connected · ${CONFIG.SEASON}` },
    error:   { cls:'err', ico:'!', msg:`Offline — using saved data` }
  };
  const s = map[state] || map.offline;
  return `<div class="api-banner ${s.cls}"><span class="ico">${s.ico}</span><span>${s.msg}</span></div>`;
}

/* =====================================================
   PLAYER SEARCH
   Used by: add-to-squad, transfer, add-candidate.
   Filters Store.pool by position and name prefix.
===================================================== */

export function searchBox({ pos, exclude=[], placeholder, onPick, note }){
  const id = 'sb' + Math.random().toString(36).slice(2,7);
  const html = `
    <div class="search-box">
      <input id="${id}-input" type="text" autocomplete="off"
             placeholder="${placeholder || `Search ${CONFIG.POS_LABEL[pos]?.toLowerCase() || 'players'}…`}">
      <div class="search-list" id="${id}-list"></div>
      ${note ? `<div class="hint-line">${note}</div>` : ''}
    </div>`;

  /* call after inserting html into the DOM */
  const bind = () => {
    const input = document.getElementById(`${id}-input`);
    const list  = document.getElementById(`${id}-list`);
    if(!input) return;

    const render = q => {
      if(!q){ list.innerHTML=''; return; }
      const ql = q.toLowerCase();
      const hits = Store.pool
        .filter(p => (!pos || p.pos === pos))
        .filter(p => !exclude.includes(p.id))
        .filter(p => p.name.toLowerCase().startsWith(ql) || p.fullName?.toLowerCase().includes(ql))
        .sort((a,b)=> b.total - a.total)
        .slice(0, 40);

      if(!hits.length){
        list.innerHTML = `<div class="hint-line">No ${pos||'player'} matching “${q}”.</div>`;
        return;
      }
      list.innerHTML = hits.map(p=>`
        <button class="search-opt" data-id="${p.id}">
          <b>${p.name}</b>
          <span>${p.team} · £${p.price.toFixed(1)}m · ${p.total} pts</span>
        </button>`).join('');
      list.querySelectorAll('.search-opt').forEach(b=>{
        b.onclick = () => {
          const player = Store.pool.find(p=>p.id === +b.dataset.id);
          if(player) onPick(player);
        };
      });
    };

    input.addEventListener('input', e=>render(e.target.value.trim()));
    input.focus();
  };

  return { html, bind };
}

/* ---------- small helpers ---------- */

export function fixtureRunHTML(teamId, n=5){
  const runs = Store.nextFixtures(teamId, n);
  if(!runs.length) return `<span class="hint-line">Fixture data arrives with the API connection</span>`;
  return `<div class="fix-run">` + runs.map(f=>`
    <span class="fix-cell" style="--tc:${f.color}" title="GW${f.gw} ${f.home?'vs':'@'} ${f.opp} — ${f.label}">
      <b>${f.opp}</b><small>${f.home?'H':'A'}</small>
    </span>`).join('') + `</div>`;
}

export function gradeColorVar(grade){
  return grade ? `var(--${grade})` : 'var(--line-strong)';
}

export function emptyNote(text){
  return `<div class="empty-note">${text}</div>`;
}
