/* =====================================================
   DRAFT PAGE — YOUR EDITING & PLANNING NOTEBOOK

   This page is where you build the squad and plan moves:
     • add / remove players
     • set captain and vice (per-GW)
     • toggle XI vs bench
     • transfer same-position
     • drag-and-drop XI ↔ bench
     • per-player flag (Hold / Watch / Swap) and free notes
     • shortlist of candidates per position

   Colours on the pitch = season form. The armband badges
   show the captain / vice for the gameweek you are actually
   editing — which is the NEXT one once the current
   gameweek's deadline has passed.
===================================================== */

import { CONFIG } from './config.js';
import { API }    from './api.js';
import { Store }  from './store.js';
import { Modal, chipEl, slotEl, searchBox, apiBanner, fixtureRunHTML, emptyNote, chipSelectHTML, wireSlideNav, toast, confirmDialog } from './ui.js';

const FLAGS = [
  { key:'hold',  label:'Hold'  },
  { key:'watch', label:'Watch' },
  { key:'swap',  label:'Swap'  }
];

const Draft = {

  /* id of a player who was just made captain — boardChip() gives him a
     one-shot glow, then this clears so it doesn't repeat on the next
     unrelated re-render */
  _burstPid: null,

  mount(){ wireSlideNav('#page-draft'); },

  render(){
    document.getElementById('draftBanner').innerHTML = apiBanner(Store.apiState || 'offline');
    this.renderChipBar();
    this.renderPitch();
    this.renderCandidates();
  },

  /* =================================================
     CHIP — its own control, not tucked inside a
     specific player's modal. A chip is a squad-wide
     decision, so it gets a squad-wide place to live.
  ================================================= */
  renderChipBar(){
    const gw = Store.editableGW();
    document.getElementById('chipBarGW').textContent = `GW${gw}`;

    const code = Store.chipOf(gw);
    const btn = document.getElementById('chipBtn');
    btn.textContent = code ? `${Store.CHIP_LABEL[code]} ✓` : 'Play a chip';
    btn.classList.toggle('active', !!code);
    btn.onclick = () => this.openChipPicker(gw);
  },

  openChipPicker(gw){
    Modal.open(`
      <h3>Chip</h3>
      <div class="m-meta">GW${gw}</div>
      <div class="m-sec">${chipSelectHTML(gw)}</div>
    `);

    document.getElementById('chipSel').onchange = e => {
      const r = Store.setChip(gw, e.target.value);
      if(!r.ok){
        toast(r.reason, 'error');
        e.target.value = Store.chipOf(gw) || '';
        return;
      }
      Modal.close();
      this.render();
    };
  },

  /* =================================================
     THE PITCH — same shape as Performance, but editable.
     Chip colour = season form. Flag stripe under each
     shirt shows your Hold/Watch/Swap tag. Captain badge
     is the current-GW captain.
  ================================================= */
  renderPitch(){
    const pitch = document.getElementById('draftPitch');
    const bench = document.getElementById('draftBench');
    pitch.innerHTML = '<div class="goalmouth"></div>';
    bench.innerHTML = '';

    CONFIG.POS_ORDER.forEach(pos=>{
      const inRow = Store.starters().filter(p=>p.pos===pos);

      /* draw the row even if empty, so the empty slots can appear */
      const row = document.createElement('div');
      row.className = 'p-row' + (pos==='GK' ? ' gk' : '');

      inRow.forEach(p => row.appendChild(this.boardChip(p)));

      const wanted  = Store.MIN_START[pos];
      const missing = Math.max(0, Math.min(wanted - inRow.length, Store.spaceFor(pos)));
      for(let i=0;i<missing;i++){
        row.appendChild(slotEl(pos, ()=>this.openAddPlayer(pos)));
      }

      if(row.children.length) pitch.appendChild(row);
    });

    /* bench */
    const benched = Store.bench();
    benched.forEach(p => bench.appendChild(this.boardChip(p)));

    const benchMissing = CONFIG.SQUAD.BENCH - benched.length;
    for(let i=0;i<benchMissing;i++){
      const nextPos = this.nextNeededPosition();
      bench.appendChild(slotEl(nextPos || 'ADD', ()=>this.openAddPlayer(nextPos)));
    }
  },

  nextNeededPosition(){
    return CONFIG.POS_ORDER.find(pos => Store.spaceFor(pos) > 0) || null;
  },

  boardChip(p){
    const g  = Store.gradeSeason(p);           // season form drives colour
    const st = Store.draftOf(p.id);
    const label = FLAGS.find(f=>f.key===st.flag)?.label || 'Hold';

    const gwNow  = Store.editableGW();
    const capId  = Store.captainIdOf(gwNow);
    const viceId = Store.viceIdOf(gwNow);

    const el = chipEl(p, {
      grade  : g.grade,
      showCap: true,
      cap    : capId  != null && p.id === capId,
      vice   : viceId != null && p.id === viceId,
      meta   : `${p.team} · ${g.pts||0} pts`
      /* no onClick here — makeInteractive tells a tap from a drag */
    });

    if(this._burstPid === p.id){
      el.classList.add('cap-burst');
      this._burstPid = null;   // one-shot — spend it now that it's applied
    }

    /* swap the points stripe for the flag stripe */
    const stripe = document.createElement('div');
    stripe.className = `fstripe ${st.flag}`;
    stripe.textContent = label;
    el.querySelector('.shirt').after(stripe);

    if(st.note?.trim()){
      const dot = document.createElement('span');
      dot.className = 'has-note';
      el.appendChild(dot);
    }

    this.makeInteractive(el, p);
    return el;
  },

  /* =================================================
     DRAG-AND-DROP (desktop + mobile via Pointer Events)
       • short press that doesn't move = tap = open modal
       • press that moves past the threshold = drag
       • drop onto another shirt = Store.swapLineup(...)
  ================================================= */
  makeInteractive(chip, p){
    chip.style.touchAction = 'none';   // let us own the gesture on touch
    const THRESH = 8;
    let sx = 0, sy = 0, dragging = false, ghost = null, target = null;

    const onMove = e => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if(!dragging && Math.hypot(dx, dy) < THRESH) return;

      if(!dragging){
        dragging = true;
        chip.classList.add('dragging');
        ghost = chip.cloneNode(true);
        ghost.classList.add('drag-ghost');
        ghost.classList.remove('dragging');
        ghost.removeAttribute('data-pid');
        document.body.appendChild(ghost);
      }
      ghost.style.left = e.clientX + 'px';
      ghost.style.top  = e.clientY + 'px';

      const t = this.chipUnder(e.clientX, e.clientY, chip);
      if(t !== target){
        target?.classList.remove('drop-hover');
        target = t;
        target?.classList.add('drop-hover');
      }
    };

    const onUp = e => {
      chip.removeEventListener('pointermove', onMove);
      chip.removeEventListener('pointerup', onUp);
      chip.removeEventListener('pointercancel', onUp);

      if(!dragging){
        /* Touch devices fire a synthetic click ~300ms after release. It
           hit-tests at the release point, and by then the modal we're
           opening sits under the finger. Swallow that one stray click. */
        const swallow = ev => { ev.stopPropagation(); ev.preventDefault(); };
        document.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => document.removeEventListener('click', swallow, true), 500);
        this.openPlayer(p);
        return;
      }

      chip.classList.remove('dragging');
      ghost?.remove(); ghost = null;
      target?.classList.remove('drop-hover');

      const drop = this.chipUnder(e.clientX, e.clientY, chip);
      if(drop){
        const otherId = +drop.dataset.pid;
        const r = Store.swapLineup(p.id, otherId);
        if(!r.ok && r.reason) toast(r.reason, 'error');
        this.render();
      }
    };

    chip.addEventListener('pointerdown', e => {
      if(e.pointerType === 'mouse' && e.button !== 0) return;
      sx = e.clientX; sy = e.clientY; dragging = false; target = null;
      chip.setPointerCapture?.(e.pointerId);
      chip.addEventListener('pointermove', onMove);
      chip.addEventListener('pointerup', onUp);
      chip.addEventListener('pointercancel', onUp);
    });
  },

  chipUnder(x, y, exclude){
    const els = document.elementsFromPoint(x, y);
    for(const el of els){
      const c = el.closest?.('.chip');
      if(c && c !== exclude && !c.classList.contains('drag-ghost') && c.dataset.pid) return c;
    }
    return null;
  },

  /* =================================================
     ADD PLAYER — same-position search
  ================================================= */
  openAddPlayer(pos){
    const targetPos = pos && Store.spaceFor(pos) > 0 ? pos : this.nextNeededPosition();
    if(!targetPos){
      Modal.open(`<h3>Squad is full</h3>
        <div class="m-meta">15 players · 2 GK, 5 DEF, 5 MID, 3 FWD</div>`);
      return;
    }

    const sb = searchBox({
      pos: targetPos,
      exclude: Store.activeSquad().map(p=>p.id),
      onPick: player => {
        const res = Store.addPlayer(player);
        if(!res.ok){ toast(res.reason, 'error'); return; }
        this.backfill(player.id);
        Modal.close();
        this.render();
      }
    });

    Modal.open(`
      <h3>Add a ${CONFIG.POS_LABEL[targetPos].replace(/s$/,'')}</h3>
      <div class="m-meta">${Store.countPos(targetPos)}/${CONFIG.SQUAD[targetPos]} ${CONFIG.POS_LABEL[targetPos].toLowerCase()} · ${Store.squad.length}/15 total</div>
      ${sb.html}`);
    sb.bind();
  },

  async backfill(id){
    const hist = await API.playerHistory(id);
    if(hist){
      const p = Store.squad.find(x=>x.id===id);
      if(p){ p.history = hist; Store.persistSquad(); }
    }
  },

  /* =================================================
     PLAYER MODAL — one place for flag/notes AND edits
  ================================================= */
  openPlayer(p){
    const st   = Store.draftOf(p.id);
    const g    = Store.gradeSeason(p);
    const runs = fixtureRunHTML(p.teamId, 5);

    const gw   = Store.editableGW();
    const isCap  = Store.captainIdOf(gw) === p.id;
    const isVice = Store.viceIdOf(gw)    === p.id;

    Modal.open(`
      <h3>${p.name}</h3>
      <div class="m-meta">${p.team} · ${p.pos} · £${p.price.toFixed(1)}m · ${g.pts||0} pts this season</div>
      ${g.grade ? `<span class="m-grade" style="--grade:var(--${g.grade})">${CONFIG.GRADE_WORD[g.grade]} — season</span>` : ''}

      <div class="m-sec">
        <h4>Armband &amp; selection — GW${gw}</h4>
        <div class="m-actions">
          <button class="m-btn ${isCap?'on':'primary'}" id="btnCap">${isCap?'Captain ✓':'Make captain'}</button>
          <button class="m-btn ${isVice?'on':''}" id="btnVice">${isVice?'Vice ✓':'Make vice'}</button>
          <button class="m-btn" id="btnStart">${p.start?'Move to bench':'Move to XI'}</button>
        </div>
      </div>

      <div class="m-sec">
        <h4>Your plan</h4>
        <div class="flag-toggle">
          ${FLAGS.map(f=>`<button class="${f.key}${st.flag===f.key?' on':''}" data-flag="${f.key}">${f.label}</button>`).join('')}
        </div>
        <textarea class="note-box" id="playerNote"
          placeholder="What you've seen, what you're planning, when you'd move him…">${st.note||''}</textarea>
      </div>

      <details class="m-disclose">
        <summary>Next 5 fixtures</summary>
        ${runs}
      </details>

      <details class="m-disclose">
        <summary>Transfer or remove</summary>
        <div class="m-actions">
          <button class="m-btn warn" id="btnSwap">⇄ Transfer this player</button>
          <button class="m-btn danger" id="btnRemove">Remove</button>
        </div>
        <div class="swap-panel" id="swapPanel"></div>
      </details>
    `, `var(--${g.grade||'lime'})`);

    /* wire actions */
    document.getElementById('btnCap').onclick = () => {
      Store.setCaptain(p.id);
      this._burstPid = p.id;   // one-shot glow on his shirt next render
      Modal.close();
      this.render();
    };
    document.getElementById('btnVice').onclick = () => {
      Store.setVice(p.id);
      Modal.close();
      this.render();
    };
    document.getElementById('btnStart').onclick = () => {
      const r = Store.toggleStart(p.id);
      if(!r.ok){ toast(r.reason, 'error'); return; }
      Modal.close();
      this.render();
    };
    document.getElementById('btnRemove').onclick = async () => {
      const ok = await confirmDialog('Remove player?', `Remove ${p.name} from your squad?`, 'Remove');
      if(!ok){ this.openPlayer(p); return; }   // back to his card, not a closed modal
      this.removeWithUndo(p);
      Modal.close();
      this.render();
    };
    document.getElementById('btnSwap').onclick = () => this.openSwap(p);

    /* flag toggle */
    document.querySelectorAll('.flag-toggle button').forEach(b=>{
      b.onclick = () => {
        Store.setFlag(p.id, b.dataset.flag);
        document.querySelectorAll('.flag-toggle button').forEach(x=>x.classList.toggle('on', x===b));
      };
    });

    /* debounced note save — never re-renders while typing */
    const ta = document.getElementById('playerNote');
    let t;
    ta.addEventListener('input', e => {
      clearTimeout(t);
      t = setTimeout(() => Store.setNote(p.id, e.target.value), 400);
    });
  },

  /* Remove a player, but keep everything Store.removePlayer touched so
     an "Undo" toast can put it all back exactly. removePlayer takes one
     of two paths depending on whether the player is locked into a past
     snapshot — soft (outGW set, row kept) or hard (row dropped outright)
     — so recovery checks which one actually happened rather than
     assuming either. */
  removeWithUndo(p){
    const before   = JSON.parse(JSON.stringify(p));
    const prevNote = Store.draft[p.id] ? { ...Store.draft[p.id] } : null;
    const cw       = Store.editableGW();
    const wasCap   = Store.captains[cw] === p.id;
    const wasVice  = Store.vices[cw]    === p.id;

    Store.removePlayer(p.id);

    toast(`${p.name} removed`, 'info', {
      actionLabel: 'Undo',
      onAction: () => {
        const row = Store.squad.find(x=>x.id===p.id);
        if(row){ row.outGW = before.outGW; row.start = before.start; }   // soft-remove path
        else    { Store.squad.push(before); }                            // hard-delete path

        if(prevNote) Store.draft[p.id] = prevNote;
        if(wasCap)  Store.captains[cw] = p.id;
        if(wasVice) Store.vices[cw]    = p.id;

        Store.persistSquad();
        Store.persistDraft();
        Store.persistCaps();
      }
    });
  },

  openSwap(p){
    const panel = document.getElementById('swapPanel');
    if(panel.dataset.open === '1'){ panel.innerHTML=''; panel.dataset.open='0'; return; }

    const sb = searchBox({
      pos: p.pos,
      exclude: Store.activeSquad().map(x=>x.id),
      placeholder: `Replace ${p.name} with…`,
      onPick: player => {
        const res = Store.transfer(p.id, player, Store.editableGW());
        if(!res.ok){ toast(res.reason, 'error'); return; }
        this.backfill(player.id);
        Modal.close();
        this.render();
      }
    });

    panel.innerHTML = sb.html;
    panel.dataset.open = '1';
    sb.bind();
  },

  /* =================================================
     CANDIDATES — one section per position. The vitals
     (form, fixtures) stay visible on the card; the plan
     (swap target, note) sits behind one tap so a long
     shortlist doesn't turn into a wall of open text boxes.
  ================================================= */
  renderCandidates(){
    const host = document.getElementById('candidateArea');
    host.innerHTML = '';

    CONFIG.POS_ORDER.forEach(pos=>{
      const sec = document.createElement('div');
      sec.className = 'cand-sec';

      const list = Store.candidatesFor(pos);

      sec.innerHTML = `
        <div class="cand-head">
          <div class="mini-title" style="margin:0">${CONFIG.POS_LABEL[pos]}</div>
          <button class="add-cand" data-pos="${pos}">+ Add ${pos}</button>
        </div>
        <div class="cand-list" id="cl-${pos}"></div>`;

      host.appendChild(sec);

      const listHost = sec.querySelector(`#cl-${pos}`);
      if(!list.length){
        listHost.innerHTML = `<div class="hint-line" style="padding:6px 0 2px">No ${CONFIG.POS_LABEL[pos].toLowerCase()} on the shortlist yet.</div>`;
      }else{
        list.forEach(c=>listHost.appendChild(this.candidateCard(c)));
      }

      sec.querySelector('.add-cand').onclick = () => this.openAddCandidate(pos);
    });
  },

  candidateCard(c){
    const pool = Store.pool.find(p=>p.id===c.id);
    const g    = pool ? Store.gradePool(pool) : { grade:null, pts:0 };

    /* bootstrap's event_points is the CURRENT gameweek, so label it that
       way — the old code read a lastGWPoints field nothing ever set and
       labelled it GW-1, so this stat always rendered "—". */
    const lastGW  = Store.currentGW;
    const lastPts = pool?.gwPoints ?? null;
    const seasonAvg = pool && Store.currentGW > 1
      ? (pool.total / Math.max(1, Store.currentGW - 1)).toFixed(1)
      : '—';

    const card = document.createElement('div');
    card.className = 'cand-card';
    card.style.setProperty('--cg', g.grade ? `var(--${g.grade})` : 'var(--line-strong)');

    const mySquadSamePos = Store.squad.filter(p=>p.pos===c.pos);
    const move = this.priceMoveTonight(pool);

    card.innerHTML = `
      <div class="cand-top">
        <div>
          <div class="cand-name">${c.name}</div>
          <div class="cand-sub">${c.team} · ${c.pos} · £${c.price.toFixed(1)}m
            ${move ? `<span class="price-move ${move}">${move==='up' ? '▲ rising tonight' : '▼ falling tonight'}</span>` : ''}
          </div>
        </div>
        <button class="cand-x" title="Remove from shortlist">✕</button>
      </div>

      <div class="cand-stats">
        <div class="cand-stat">GW${lastGW}<b>${lastPts ?? '—'}</b></div>
        <div class="cand-stat">Season avg<b>${seasonAvg}</b></div>
        <div class="cand-stat">Season total<b class="graded">${pool?.total ?? '—'}</b></div>
      </div>

      ${fixtureRunHTML(c.teamId, 5)}

      ${c.swapWith && c.targetGW ? `<div class="plan-tag">Planned: ${c.name} in for ${Store.squad.find(p=>p.id===c.swapWith)?.name || '?'} at GW${c.targetGW}</div>` : ''}

      <details class="m-disclose">
        <summary>Plan &amp; notes${c.note?.trim() ? '<span class="summary-dot"></span>' : ''}</summary>
        <div class="swap-plan">
          <label>Swap with</label>
          <select class="sel-swap">
            <option value="">— nobody yet —</option>
            ${mySquadSamePos.map(p=>`<option value="${p.id}" ${c.swapWith===p.id?'selected':''}>${p.name}</option>`).join('')}
          </select>
          <label>at</label>
          <select class="sel-gw">
            <option value="">— GW —</option>
            ${Array.from({length:CONFIG.TOTAL_GW},(_,i)=>i+1)
              .filter(gw=>gw >= Store.editableGW())
              .map(gw=>`<option value="${gw}" ${c.targetGW===gw?'selected':''}>GW${gw}</option>`).join('')}
          </select>
        </div>
        <textarea class="note-box" placeholder="Why him — form, fixtures, price, when you'd pull the trigger…">${c.note||''}</textarea>
      </details>`;

    card.querySelector('.cand-x').onclick = async () => {
      const ok = await confirmDialog('Remove from shortlist?', `Remove ${c.name} from your shortlist?`, 'Remove');
      if(ok) Store.removeCandidate(c.id);
    };
    card.querySelector('.sel-swap').onchange = e =>
      Store.updateCandidate(c.id, { swapWith: e.target.value ? +e.target.value : null });
    card.querySelector('.sel-gw').onchange = e =>
      Store.updateCandidate(c.id, { targetGW: e.target.value ? +e.target.value : null });

    let t;
    card.querySelector('.note-box').addEventListener('input', e=>{
      clearTimeout(t);
      t = setTimeout(()=>Store.updateCandidate(c.id, { note:e.target.value }), 400);
    });

    return card;
  },

  /* Verified against a real price change: everything that moved sat
     >=100%, the highest that didn't was 100.3% — so the threshold is
     exact, not a rough cutoff. offset 0 is tonight; anything further
     out is too likely to shift before it matters to flag here. */
  priceMoveTonight(pool){
    const p0 = pool?.priceChange?.find(x => x.offset === 0);
    if(!p0 || !Number.isFinite(p0.percent) || Math.abs(p0.percent) < 100) return null;
    return p0.percent > 0 ? 'up' : 'down';
  },

  openAddCandidate(pos){
    const sb = searchBox({
      pos,
      exclude: [...Store.activeSquad().map(p=>p.id), ...Object.keys(Store.candidates).map(Number)],
      placeholder: `Add a ${CONFIG.POS_LABEL[pos].replace(/s$/,'').toLowerCase()} to watch…`,
      onPick: player => {
        const res = Store.addCandidate(player);
        if(!res.ok){ toast(res.reason, 'error'); return; }
        Modal.close();
      }
    });

    Modal.open(`
      <h3>Watch a ${CONFIG.POS_LABEL[pos].replace(/s$/,'')}</h3>
      ${sb.html}`);
    sb.bind();
  }
};

export default Draft;
