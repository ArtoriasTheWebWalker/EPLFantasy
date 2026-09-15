/* =====================================================
   UI — shared widgets used by more than one page.
   Player chips, the modal, the player search box and
   the API status banner all live here so the three
   page files stay short.
===================================================== */

import { CONFIG, KITS } from './config.js';
import { Store } from './store.js';

/* ---------- sliding tab nav ----------
   Shared by any page using the .slide-nav / .snav / .slide markup
   (Performance's Squad/Captain/Bench/Transfers, Draft's Board/Shortlist).
   Wire once from a page's mount(); render() never touches the tabs
   themselves, so the active tab survives a re-render.
----------------------------------------- */
export function wireSlideNav(rootSelector){
  const nav   = document.querySelector(`${rootSelector} .slide-nav`);
  const snavs = document.querySelectorAll(`${rootSelector} .snav`);
  if(!nav || !snavs.length) return;

  const move = (btn, instant) => {
    if(!btn) return;
    if(instant) nav.classList.add('no-anim');
    nav.style.setProperty('--ind-x', btn.offsetLeft   + 'px');
    nav.style.setProperty('--ind-y', btn.offsetTop    + 'px');
    nav.style.setProperty('--ind-w', btn.offsetWidth  + 'px');
    nav.style.setProperty('--ind-h', btn.offsetHeight + 'px');
    if(instant) requestAnimationFrame(()=>requestAnimationFrame(()=>nav.classList.remove('no-anim')));
  };

  snavs.forEach(btn=>{
    btn.onclick = () => {
      snavs.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll(`${rootSelector} .slide`).forEach(s=>s.classList.remove('active'));
      document.getElementById(btn.dataset.slide).classList.add('active');
      move(btn);
    };
  });

  const settle = () => move(document.querySelector(`${rootSelector} .snav.active`) || snavs[0], true);
  settle();
  window.addEventListener('resize', settle);

  /* ---- swipe between tabs on touch ----
     Only tracks a gesture that starts on "empty" background — a chip,
     button, select, textarea or link swallows it instead, so this never
     fights the pitch's own drag-and-drop or a normal tap. */
  const slides = document.querySelector(`${rootSelector} .slides`);
  if(slides && !slides.dataset.swipeWired){
    slides.dataset.swipeWired = '1';
    let sx = 0, sy = 0, tracking = false;

    slides.addEventListener('touchstart', e=>{
      if(e.touches.length !== 1){ tracking = false; return; }
      if(e.target.closest('.chip, button, select, textarea, input, a')){ tracking = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true;
    }, { passive:true });

    slides.addEventListener('touchend', e=>{
      if(!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      if(Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.6) return;

      const all = [...document.querySelectorAll(`${rootSelector} .snav`)];
      const curIdx  = all.findIndex(b=>b.classList.contains('active'));
      const nextIdx = dx < 0 ? curIdx + 1 : curIdx - 1;   // swipe left → next tab
      if(nextIdx >= 0 && nextIdx < all.length) all[nextIdx].click();
    }, { passive:true });
  }
}

/* ---------- number count-up ----------
   Animates an element's text from 0 up to `target` — used on the hero
   stat tiles so a changed number reads as a change, not just a swap.
   Formatting is passed in explicitly rather than parsed back out of
   rendered text, so it stays correct for any prefix/suffix/decimals. */
export function animateNumber(el, target, opts={}){
  const { duration=650, decimals=0, prefix='', suffix='' } = opts;
  if(!el) return;
  if(target == null || !Number.isFinite(target)){ el.textContent = '—'; return; }

  const start = performance.now();
  const ease = t => 1 - Math.pow(1-t, 3);

  const fmt = v => decimals
    ? prefix + v.toFixed(decimals) + suffix
    : prefix + Math.round(v).toLocaleString() + suffix;

  function tick(now){
    const p = Math.min(1, (now - start) / duration);
    el.textContent = fmt(target * ease(p));
    if(p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ---------- toast ----------
   A brief, non-blocking notice — replaces window.alert() so an error
   or a confirmation doesn't drop a flat OS dialog into a custom UI.
   type: 'info' | 'error'. actionLabel + onAction adds a button
   (used for "Undo" after a removal). */
export function toast(message, type='info', { actionLabel, onAction, duration } = {}){
  let host = document.getElementById('toastHost');
  if(!host){
    host = document.createElement('div');
    host.id = 'toastHost';
    host.className = 'toast-host';
    document.body.appendChild(host);
  }

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-msg"></span>`;
  el.querySelector('.toast-msg').textContent = message;

  let dismissed = false;
  const dismiss = () => {
    if(dismissed) return;
    dismissed = true;
    el.classList.remove('show');
    setTimeout(()=>el.remove(), 260);
  };

  if(actionLabel){
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = actionLabel;
    btn.onclick = () => { onAction?.(); dismiss(); };
    el.appendChild(btn);
  }

  host.appendChild(el);
  requestAnimationFrame(()=>el.classList.add('show'));
  setTimeout(dismiss, duration ?? (actionLabel ? 5000 : (type === 'error' ? 4200 : 2600)));
}

/* ---------- choice / confirm dialogs ----------
   Replaces window.confirm() with a modal styled like the rest of the
   app. choice() is the primitive — pass any number of labelled options,
   get back whichever option's `value` was clicked (or undefined if the
   dialog is dismissed some other way). confirmDialog() is the common
   two-button case. */
export function choice({ title, body, options }){
  return new Promise(resolve=>{
    Modal.open(`
      <h3>${title}</h3>
      ${body ? `<div class="m-meta">${body}</div>` : ''}
      <div class="m-actions">
        ${options.map((o,i)=>`<button class="m-btn ${o.className||''}" data-i="${i}">${o.label}</button>`).join('')}
      </div>
    `);
    document.querySelectorAll('#modalContent .m-actions [data-i]').forEach(btn=>{
      btn.onclick = () => {
        const o = options[+btn.dataset.i];
        Modal.close();
        resolve(o.value);
      };
    });
  });
}

export function confirmDialog(title, body, confirmLabel='Confirm', danger=true){
  return choice({
    title, body,
    options: [
      { label:'Cancel', value:false },
      { label:confirmLabel, value:true, className: danger ? 'danger' : 'primary' }
    ]
  });
}

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

/* FPL's status letter → a short label and a colour. Doubtful and
   injured/suspended/unavailable get different colours since a doubtful
   player might still start; the rest are all "don't count on him". */
const STATUS_META = {
  d: { label:'D', title:'Doubtful',    cls:'doubt' },
  i: { label:'I', title:'Injured',     cls:'out'   },
  s: { label:'S', title:'Suspended',   cls:'out'   },
  u: { label:'U', title:'Unavailable', cls:'out'   },
  n: { label:'N', title:'Not in squad',cls:'out'   }
};

export function statusBadgeHTML(status, news){
  const meta = status && status !== 'a' ? STATUS_META[status] : null;
  if(!meta) return '';
  const title = (meta.title + (news ? ` — ${news}` : '')).replace(/"/g, '&quot;');
  return `<span class="status-flag ${meta.cls}" title="${title}">${meta.label}</span>`;
}

/*
  Build a player chip.
  opts:
    stripe    : { text, className }  what shows in the coloured bar
    grade     : 'blue'|'green'|'amber'|'red'|null
    meta      : small line under the name
    onClick   : handler
    showCap   : draw the captain / vice badges when cap/vice is set
    cap       : true → this player is captain in the current view
    vice      : true → this player is vice in the current view
    status    : FPL status letter (a/d/i/s/u/n) — shows a small badge
                when not available
    news      : injury/suspension note, used as the badge's tooltip

  Captain / vice are passed in because they now depend on which
  gameweek is being viewed (Store.captains is a per-GW map).
*/
export function chipEl(player, opts={}){
  const el = document.createElement('button');
  el.className = 'chip' + (opts.grade ? ` g-${opts.grade}` : '');
  el.dataset.pid = player.id;                 // used by drag-and-drop hit testing
  el.innerHTML = `
    ${opts.showCap && opts.cap  ? '<span class="capstar">C</span>'  : ''}
    ${opts.showCap && opts.vice ? '<span class="vicestar">V</span>'  : ''}
    ${player.inGW ? `<span class="in-tag">IN GW${player.inGW}</span>` : ''}
    ${shirtHTML(player.team)}
    ${opts.stripe ? `<div class="pstripe ${opts.stripe.className||''}">${opts.stripe.text}</div>` : ''}
    <div class="name">${player.name}${statusBadgeHTML(opts.status, opts.news)}</div>
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

/* ---------- chip picker ----------
   One of each chip per half of the season, so an option already spent
   in this half is labelled with the gameweek that used it and disabled.
   Store.setChip still refuses it if it gets picked anyway.
----------------------------------- */
export function chipSelectHTML(gw){
  const half = Store.chipHalf(gw);
  const cur  = Store.chipOf(gw);

  const opts = Object.keys(Store.CHIP_SHORT).map(code=>{
    const playedIn = Store.chipPlayedIn(code, half, gw);
    const spent    = playedIn != null;
    return `<option value="${code}" ${cur===code?'selected':''} ${spent?'disabled':''}>`
         + `${Store.CHIP_LABEL[code]}${CHIP_HINT[code]||''}${spent?` — used GW${playedIn}`:''}`
         + `</option>`;
  }).join('');

  return `<select class="sync-input" id="chipSel">
      <option value="" ${!cur ? 'selected' : ''}>None</option>
      ${opts}
    </select>
    <div class="hint-line">Half ${half} of the season${half===1?` — these expire after GW${CONFIG.CHIP_HALF_END}`:''}.</div>`;
}

const CHIP_HINT = {
  '3xc'   : ' (×3)',
  'bboost': ' (bench counts)',
  'wildcard': '',
  'freehit' : ''
};

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
