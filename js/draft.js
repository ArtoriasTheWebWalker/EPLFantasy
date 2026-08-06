/* =====================================================
   DRAFT PAGE

   Your planning notebook. Always season view — this
   page is about the shape of a player's season, not
   one gameweek.

   Nothing here is generated for you. Flags and notes
   are yours; the only automatic parts are the season
   grade colour and the fixture run, both of which come
   from the same Store the Performance page uses.
===================================================== */

import { CONFIG } from './config.js';
import { Store }  from './store.js';
import { Modal, chipEl, searchBox, apiBanner, fixtureRunHTML, emptyNote } from './ui.js';

const FLAGS = [
  { key:'hold',  label:'Hold'  },
  { key:'watch', label:'Watch' },
  { key:'swap',  label:'Swap'  }
];

const Draft = {

  mount(){ /* nothing to wire once — render handles it all */ },

  render(){
    document.getElementById('draftBanner').innerHTML = apiBanner(Store.apiState || 'offline');
    this.renderPitch();
    this.renderCandidates();
  },

  /* =================================================
     THE BOARD — same shape as Performance, but the
     stripe shows your flag and the colour shows his
     season form.
  ================================================= */
  renderPitch(){
    const pitch = document.getElementById('draftPitch');
    const bench = document.getElementById('draftBench');
    pitch.innerHTML = '<div class="goalmouth"></div>';
    bench.innerHTML = '';

    if(!Store.squad.length){
      pitch.innerHTML += emptyNote('Your squad is empty.<br>Add players on the <b>Performance</b> page first — they appear here automatically.');
      return;
    }

    CONFIG.POS_ORDER.forEach(pos=>{
      const inRow = Store.starters().filter(p=>p.pos===pos);
      if(!inRow.length) return;
      const row = document.createElement('div');
      row.className = 'p-row' + (pos==='GK' ? ' gk' : '');
      inRow.forEach(p=>row.appendChild(this.boardChip(p)));
      pitch.appendChild(row);
    });

    Store.bench().forEach(p=>bench.appendChild(this.boardChip(p)));
  },

  boardChip(p){
    const g  = Store.gradeSeason(p);          // season form drives the colour
    const st = Store.draftOf(p.id);
    const label = FLAGS.find(f=>f.key===st.flag)?.label || 'Hold';

    const el = chipEl(p, {
      grade : g.grade,
      meta  : `${p.team} · ${g.pts||0} pts`,
      onClick: () => this.openPlayerNotes(p)
    });

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
    return el;
  },

  /* =================================================
     PLAYER NOTES MODAL
  ================================================= */
  openPlayerNotes(p){
    const st = Store.draftOf(p.id);
    const g  = Store.gradeSeason(p);
    const runs = fixtureRunHTML(p.teamId, 5);

    Modal.open(`
      <h3>${p.name}</h3>
      <div class="m-meta">${p.team} · ${p.pos} · £${p.price.toFixed(1)}m · ${g.pts||0} pts this season</div>
      ${g.grade ? `<span class="m-grade" style="--grade:var(--${g.grade})">${CONFIG.GRADE_WORD[g.grade]} — season</span>` : ''}

      <div class="m-sec">
        <h4>Next 5 fixtures</h4>
        ${runs}
      </div>

      <div class="m-sec">
        <h4>Your flag</h4>
        <div class="flag-toggle">
          ${FLAGS.map(f=>`<button class="${f.key}${st.flag===f.key?' on':''}" data-flag="${f.key}">${f.label}</button>`).join('')}
        </div>
      </div>

      <div class="m-sec">
        <h4>Your notes</h4>
        <textarea class="note-box" id="playerNote"
          placeholder="What you've seen, what you're planning, when you'd move him…">${st.note||''}</textarea>
      </div>
    `, `var(--${g.grade||'lime'})`);

    document.querySelectorAll('.flag-toggle button').forEach(b=>{
      b.onclick = () => {
        Store.setFlag(p.id, b.dataset.flag);
        document.querySelectorAll('.flag-toggle button').forEach(x=>x.classList.toggle('on', x===b));
        this.renderPitch();
      };
    });

    const ta = document.getElementById('playerNote');
    let t;
    ta.addEventListener('input', e=>{
      clearTimeout(t);
      t = setTimeout(()=>{ Store.setNote(p.id, e.target.value); this.renderPitch(); }, 400);
    });
  },

  /* =================================================
     CANDIDATES — one section per position, always
     visible so a note is never hidden behind a click.
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

    /* last completed gameweek + season average, as agreed */
    const lastGW  = Math.max(1, Store.currentGW - 1);
    const lastPts = pool?.lastGWPoints ?? null;
    const seasonAvg = pool && Store.currentGW > 1
      ? (pool.total / Math.max(1, Store.currentGW - 1)).toFixed(1)
      : '—';

    const card = document.createElement('div');
    card.className = 'cand-card';
    card.style.setProperty('--cg', g.grade ? `var(--${g.grade})` : 'var(--line-strong)');

    const mySquadSamePos = Store.squad.filter(p=>p.pos===c.pos);

    card.innerHTML = `
      <div class="cand-top">
        <div>
          <div class="cand-name">${c.name}</div>
          <div class="cand-sub">${c.team} · ${c.pos} · £${c.price.toFixed(1)}m</div>
        </div>
        <button class="cand-x" title="Remove from shortlist">✕</button>
      </div>

      <div class="cand-stats">
        <div class="cand-stat">GW${lastGW}<b>${lastPts ?? '—'}</b></div>
        <div class="cand-stat">Season avg<b>${seasonAvg}</b></div>
        <div class="cand-stat">Season total<b class="graded">${pool?.total ?? '—'}</b></div>
      </div>

      ${fixtureRunHTML(c.teamId, 5)}

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
            .filter(gw=>gw >= Store.currentGW)
            .map(gw=>`<option value="${gw}" ${c.targetGW===gw?'selected':''}>GW${gw}</option>`).join('')}
        </select>
      </div>

      ${c.swapWith && c.targetGW ? `<div class="plan-tag">Planned: ${c.name} in for ${Store.squad.find(p=>p.id===c.swapWith)?.name || '?'} at GW${c.targetGW}</div>` : ''}

      <textarea class="note-box" placeholder="Why him — form, fixtures, price, when you'd pull the trigger…">${c.note||''}</textarea>`;

    card.querySelector('.cand-x').onclick = () => {
      if(confirm(`Remove ${c.name} from your shortlist?`)) Store.removeCandidate(c.id);
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

  openAddCandidate(pos){
    const sb = searchBox({
      pos,
      exclude: [...Store.squad.map(p=>p.id), ...Object.keys(Store.candidates).map(Number)],
      placeholder: `Add a ${CONFIG.POS_LABEL[pos].replace(/s$/,'').toLowerCase()} to watch…`,
      note: `Anyone you add here sits on your shortlist with his season form and fixture run — he is not in your squad until you transfer him on the Performance page.`,
      onPick: player => {
        const res = Store.addCandidate(player);
        if(!res.ok){ alert(res.reason); return; }
        Modal.close();
      }
    });

    Modal.open(`
      <h3>Watch a ${CONFIG.POS_LABEL[pos].replace(/s$/,'')}</h3>
      <div class="m-meta">Shortlist · ${Store.candidatesFor(pos).length} already watching</div>
      ${sb.html}`);
    sb.bind();
  }
};

export default Draft;
