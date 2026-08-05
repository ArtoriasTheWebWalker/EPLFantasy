/* =====================================================
   PERFORMANCE PAGE

   Shows the squad as it actually performed. Everything
   here reads from Store; nothing is stored locally.
===================================================== */

import { CONFIG } from './config.js';
import { API }    from './api.js';
import { Store }  from './store.js';
import { Modal, chipEl, slotEl, searchBox, apiBanner, emptyNote } from './ui.js';

const Performance = {

  /* -------------------------------------------------
     mount — runs once, wires listeners
  ------------------------------------------------- */
  mount(){
    document.querySelectorAll('#page-performance .snav').forEach(btn=>{
      btn.onclick = () => {
        document.querySelectorAll('#page-performance .snav').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('#page-performance .slide').forEach(s=>s.classList.remove('active'));
        document.getElementById(btn.dataset.slide).classList.add('active');
      };
    });
  },

  /* -------------------------------------------------
     render — called on load and on any store change
  ------------------------------------------------- */
  render(){
    document.getElementById('perfBanner').innerHTML = apiBanner(Store.apiState || 'offline');
    this.renderGWRow();
    this.renderStars();
    this.renderPitch();
    this.renderStatus();
    this.renderCaptain();
    this.renderBenchCalls();
    this.renderTransfers();
  },

  /* -------------------------------------------------
     gameweek pills — current GW, every past GW, season
  ------------------------------------------------- */
  renderGWRow(){
    const row = document.getElementById('gwRow');
    const upTo = Store.currentGW;
    let html = '';

    for(let gw=1; gw<=upTo; gw++){
      const active = !Store.seasonMode && Store.viewGW === gw;
      html += `<button class="gw${active?' active':''}" data-gw="${gw}">GW${gw}</button>`;
    }
    html += `<button class="gw season-btn${Store.seasonMode?' active':''}" data-season="1">Season</button>`;
    row.innerHTML = html;

    row.querySelectorAll('[data-gw]').forEach(b=>{
      b.onclick = () => { Store.seasonMode = false; Store.viewGW = +b.dataset.gw; this.render(); };
    });
    row.querySelector('[data-season]').onclick = () => {
      Store.seasonMode = true; this.render();
    };
  },

  /* -------------------------------------------------
     the pitch — formation follows the actual XI
  ------------------------------------------------- */
  renderPitch(){
    const pitch = document.getElementById('pitchArea');
    const bench = document.getElementById('benchArea');
    pitch.innerHTML = '<div class="goalmouth"></div>';
    bench.innerHTML = '';

    const starters = Store.starters();

    /* one row per position, in order */
    CONFIG.POS_ORDER.forEach(pos=>{
      const row = document.createElement('div');
      row.className = 'p-row' + (pos==='GK' ? ' gk' : '');

      const inRow = starters.filter(p=>p.pos===pos);
      inRow.forEach(p => row.appendChild(this.playerChip(p)));

      /* Empty slots so you can add players straight from the pitch.
         We draw down to the legal minimum for each position; extra
         places fill themselves as you add more players. */
      const wanted  = Store.MIN_START[pos];
      const missing = Math.max(0, Math.min(wanted - inRow.length, Store.spaceFor(pos)));
      for(let i=0;i<missing;i++){
        row.appendChild(slotEl(pos, ()=>this.openAddPlayer(pos)));
      }

      if(row.children.length) pitch.appendChild(row);
    });

    /* bench */
    const benched = Store.bench();
    benched.forEach(p => bench.appendChild(this.playerChip(p)));

    /* Empty bench slots — label each with a position that still
       has room, so an empty squad doesn't show four GK slots.
       We tally what's already placed (starters + bench) and hand
       out the leftover quota in GK, DEF, MID, FWD order. */
    const benchMissing = CONFIG.SQUAD.BENCH - benched.length;
    if(benchMissing > 0){
      const remaining = [];
      CONFIG.POS_ORDER.forEach(pos=>{
        for(let i=0;i<Store.spaceFor(pos);i++) remaining.push(pos);
      });
      /* the pitch already claims the outfield minimums, so bench
         slots should advertise what's left after those */
      const forBench = remaining.slice(-benchMissing);
      for(let i=0;i<benchMissing;i++){
        const pos = forBench[i] || 'ADD';
        bench.appendChild(slotEl(pos, ()=>this.openAddPlayer(pos==='ADD'?null:pos)));
      }
    }

    /* formation label */
    const hint = document.getElementById('formationHint');
    hint.textContent = Store.squad.length
      ? `Formation ${Store.formation()} · tap a shirt for the breakdown`
      : 'Tap a slot to add your first player';
  },

  nextNeededPosition(){
    return CONFIG.POS_ORDER.find(pos => Store.spaceFor(pos) > 0) || null;
  },

  /* one chip, graded for the current view */
  playerChip(p){
    const g = Store.seasonMode ? Store.gradeSeason(p) : Store.gradeGW(p, Store.viewGW);
    const pts = g.pts;

    return chipEl(p, {
      grade  : g.grade,
      showCap: true,
      stripe : { text: pts === null ? '—' : `${pts} <small>PTS</small>` },
      meta   : Store.seasonMode
                 ? `${p.team} · season`
                 : `${p.team} · £${p.price.toFixed(1)}m`,
      onClick: () => this.openPlayer(p)
    });
  },

  /* -------------------------------------------------
     star players
  ------------------------------------------------- */
  renderStars(){
    const row = document.getElementById('starsRow');

    if(Store.squad.length < 3 || !Store.squad.some(p=>p.history?.length)){
      row.innerHTML = '';
      return;
    }

    const val = p => Store.seasonMode ? Store.seasonTotal(p) : (Store.pointsIn(p, Store.viewGW) ?? 0);
    const ratio = p => {
      const g = Store.seasonMode ? Store.gradeSeason(p) : Store.gradeGW(p, Store.viewGW);
      return g.ratio ?? 0;
    };
    const valueRatio = p => ratio(p) / Math.max(0.1, p.price / 6);

    const pool = Store.squad.filter(p=>p.history?.length);
    if(!pool.length){ row.innerHTML=''; return; }

    const top  = [...pool].sort((a,b)=>val(b)-val(a))[0];
    const out  = [...pool].filter(p=>p!==top).sort((a,b)=>valueRatio(b)-valueRatio(a))[0] || top;
    const dis  = [...pool].filter(p=>p.start).sort((a,b)=>ratio(a)-ratio(b))[0] || pool[0];
    const scope = Store.seasonMode ? 'season' : `GW${Store.viewGW}`;

    row.innerHTML = `
      <div class="star-card gold"><div class="ic">★</div><div>
        <div class="sc-label">Star of the ${Store.seasonMode?'season':'week'}</div>
        <div class="sc-name">${top.name}</div>
        <div class="sc-pts">${val(top)} pts · ${scope}</div></div></div>

      <div class="star-card lime"><div class="ic">▲</div><div>
        <div class="sc-label">Above expectation</div>
        <div class="sc-name">${out.name}</div>
        <div class="sc-pts">${val(out)} pts at £${out.price.toFixed(1)}m</div></div></div>

      <div class="star-card down"><div class="ic">▼</div><div>
        <div class="sc-label">Most disappointing</div>
        <div class="sc-name">${dis.name}</div>
        <div class="sc-pts">${val(dis)} pts · ${scope}</div></div></div>`;
  },

  /* -------------------------------------------------
     squad completeness readout
  ------------------------------------------------- */
  renderStatus(){
    const el = document.getElementById('squadStatus');
    const quota = CONFIG.POS_ORDER.map(pos=>{
      const have = Store.countPos(pos), want = CONFIG.SQUAD[pos];
      return `<span class="${have===want?'done':''}">${pos} ${have}/${want}</span>`;
    }).join('');

    const n = Store.squad.length;
    const issues = n === CONFIG.SQUAD.TOTAL ? Store.formationIssues() : [];

    const head = n === CONFIG.SQUAD.TOTAL
      ? `<b>Squad complete</b> — 15 players, ${Store.starters().length} starting, ${Store.bench().length} on the bench. Formation <b>${Store.formation()}</b>.`
      : `<b>${n}/${CONFIG.SQUAD.TOTAL} players added.</b> Tap a slot on the pitch to add the rest.`;

    const warn = issues.length
      ? `<div style="color:var(--amber);margin-top:7px">Your XI ${issues.join(', ')}.</div>`
      : '';

    el.innerHTML = `${head}${warn}<div class="quota">${quota}</div>`;
  },

  /* =================================================
     ADD PLAYER
  ================================================= */
  openAddPlayer(pos){
    const targetPos = pos && Store.spaceFor(pos) > 0 ? pos : this.nextNeededPosition();
    if(!targetPos){
      Modal.open(`<h3>Squad is full</h3>
        <div class="m-meta">15 players · 2 GK, 5 DEF, 5 MID, 3 FWD</div>
        <p class="hint-line">To bring someone new in, open a player and use Transfer.</p>`);
      return;
    }

    const sb = searchBox({
      pos: targetPos,
      exclude: Store.squad.map(p=>p.id),
      onPick: player => {
        const res = Store.addPlayer(player);
        if(!res.ok){ alert(res.reason); return; }
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

  /* pull a new player's season history in the background */
  async backfill(id){
    const hist = await API.playerHistory(id);
    if(hist){
      const p = Store.squad.find(x=>x.id===id);
      if(p){ p.history = hist; Store.persistSquad(); }
    }
  },

  /* =================================================
     PLAYER MODAL
  ================================================= */
  openPlayer(p){
    Store.seasonMode ? this.seasonModal(p) : this.gwModal(p);
  },

  gwModal(p){
    const g = Store.gradeGW(p, Store.viewGW);
    const h = p.history?.find(x=>x.gw===Store.viewGW);

    const breakdown = h ? this.breakdownRows(h, p.pos) : '';

    Modal.open(`
      <h3>${p.name}</h3>
      <div class="m-meta">${p.team} · ${p.pos} · £${p.price.toFixed(1)}m · GW${Store.viewGW}</div>
      ${g.grade ? `<span class="m-grade" style="--grade:var(--${g.grade})">${CONFIG.GRADE_WORD[g.grade]}</span>` : ''}

      ${h ? `<div class="m-sec"><h4>Points breakdown</h4>${breakdown}</div>`
          : `<div class="hint-line">No gameweek data yet — it arrives with the FPL connection.</div>`}

      <div class="m-actions">
        <button class="m-btn ${p.cap?'on':''}" id="btnCap">${p.cap?'Captain':'Make captain'}</button>
        <button class="m-btn" id="btnStart">${p.start?'Move to bench':'Move to XI'}</button>
      </div>
      <div class="m-actions">
        <button class="m-btn warn" id="btnSwap">⇄ Transfer this player</button>
        <button class="m-btn danger" id="btnRemove">Remove</button>
      </div>
      <div class="swap-panel" id="swapPanel"></div>
    `, `var(--${g.grade||'lime'})`);

    this.wireModalActions(p);
  },

  seasonModal(p){
    const g = Store.gradeSeason(p);
    const hist = p.history || [];

    const cells = hist.map(h=>{
      const gg = Store.gradeGW(p, h.gw);
      return `<div class="gw-cell w-${gg.grade||'amber'}"><b>${h.points}</b><small>GW${h.gw}</small></div>`;
    }).join('');

    const insights = this.scoutingReport(p);

    Modal.open(`
      <h3>${p.name}</h3>
      <div class="m-meta">${p.team} · ${p.pos} · £${p.price.toFixed(1)}m · season to date</div>
      ${g.grade ? `<span class="m-grade" style="--grade:var(--${g.grade})">${CONFIG.GRADE_WORD[g.grade]} — season</span>` : ''}

      ${hist.length ? `
        <div class="m-sec"><h4>Week by week</h4><div class="gw-strip">${cells}</div></div>
        <div class="m-sec"><h4>Scouting report — ${Store.seasonTotal(p)} pts in ${hist.length} weeks</h4>
          ${insights.map(([em,tx])=>`<div class="insight"><span class="em">${em}</span><span>${tx}</span></div>`).join('')}
        </div>`
      : `<div class="hint-line">Season history arrives with the FPL connection.</div>`}

      <div class="m-actions">
        <button class="m-btn warn" id="btnSwap">⇄ Transfer this player</button>
        <button class="m-btn danger" id="btnRemove">Remove</button>
      </div>
      <div class="swap-panel" id="swapPanel"></div>
    `, `var(--${g.grade||'lime'})`);

    this.wireModalActions(p);
  },

  breakdownRows(h, pos){
    const rows = [];
    if(h.minutes)     rows.push(['Minutes played', h.minutes]);
    if(h.goals)       rows.push(['Goals', h.goals]);
    if(h.assists)     rows.push(['Assists', h.assists]);
    if(h.cleanSheet)  rows.push(['Clean sheet', h.cleanSheet]);
    if(pos==='GK' && h.saves) rows.push(['Saves', h.saves]);
    if(h.conceded)    rows.push(['Goals conceded', h.conceded]);
    if(h.bonus)       rows.push(['Bonus', h.bonus]);
    if(h.yellow)      rows.push(['Yellow card', h.yellow]);
    if(h.red)         rows.push(['Red card', h.red]);

    return rows.map(([k,v])=>`<div class="break-row"><span>${k}</span><span>${v}</span></div>`).join('')
      + `<div class="break-row total"><span>Total</span><span>${h.points}</span></div>`;
  },

  /* -------------------------------------------------
     scouting report — accumulated season narrative
  ------------------------------------------------- */
  scoutingReport(p){
    const hist = p.history || [];
    const out = [];
    if(hist.length < 2) return [['·','Not enough weeks yet to read a pattern.']];

    const pts = hist.map(h=>h.points);
    const n = pts.length;

    /* consistency vs the position average */
    let above = 0, rated = 0;
    hist.forEach(h=>{
      const avg = Store.posAvg?.[h.gw]?.[p.pos];
      if(avg){ rated++; if(h.points >= avg) above++; }
    });
    if(rated){
      if(above >= rated - 1) out.push(['■','Consistent — at or above the position average almost every week.']);
      else if(above >= Math.ceil(rated*0.6)) out.push(['▲',`Above the position average in ${above} of ${rated} weeks.`]);
      else if(above <= Math.floor(rated*0.3)) out.push(['▼',`Below the position average in ${rated-above} of ${rated} weeks.`]);
    }

    /* variance */
    const spread = Math.max(...pts) - Math.min(...pts);
    if(spread >= 9) out.push(['~','Streaky — big hauls separated by quiet weeks. Hard to bench, hard to trust.']);
    else if(spread <= 4 && n >= 4) out.push(['=','Low variance — you broadly know what you are getting each week.']);

    /* form trend */
    if(n >= 6){
      const first = pts.slice(0,3).reduce((a,b)=>a+b,0)/3;
      const last  = pts.slice(-3).reduce((a,b)=>a+b,0)/3;
      if(last - first >= 2.5) out.push(['↗','Trending up — his best football is the recent stuff.']);
      else if(first - last >= 2.5) out.push(['↘','Fading — early-season form has dropped off.']);
    }

    /* opponent quality */
    let hardSum=0, hardN=0, easySum=0, easyN=0;
    hist.forEach(h=>{
      if(h.opponentId == null) return;
      const tier = Store.tierOf(h.opponentId);
      if(tier <= 2){ hardSum += h.points; hardN++; }
      if(tier >= 4){ easySum += h.points; easyN++; }
    });
    if(hardN && easyN){
      const hA = hardSum/hardN, eA = easySum/easyN;
      if(hA - eA >= 1.5) out.push(['◆','Raises his game against the strong sides — quieter in the easy ones.']);
      else if(eA - hA >= 1.5) out.push(['◇','Feasts on the weaker sides, but goes missing in the tough matches.']);
    }

    /* minutes */
    const started = hist.filter(h=>h.minutes >= 60).length;
    if(started <= Math.floor(n*0.6)) out.push(['◷',`Rotation risk — 60+ minutes in only ${started} of ${n} weeks.`]);

    if(!out.length) out.push(['·','Steady, unremarkable season so far — roughly what the position expects.']);
    return out;
  },

  /* -------------------------------------------------
     modal buttons
  ------------------------------------------------- */
  wireModalActions(p){
    const cap = document.getElementById('btnCap');
    if(cap) cap.onclick = () => { Store.setCaptain(p.id); Modal.close(); this.render(); };

    const st = document.getElementById('btnStart');
    if(st) st.onclick = () => {
      const r = Store.toggleStart(p.id);
      if(!r.ok){ alert(r.reason); return; }
      Modal.close(); this.render();
    };

    const rm = document.getElementById('btnRemove');
    if(rm) rm.onclick = () => {
      if(!confirm(`Remove ${p.name} from your squad?`)) return;
      Store.removePlayer(p.id); Modal.close(); this.render();
    };

    const sw = document.getElementById('btnSwap');
    if(sw) sw.onclick = () => this.openSwap(p);
  },

  openSwap(p){
    const panel = document.getElementById('swapPanel');
    if(panel.dataset.open === '1'){ panel.innerHTML=''; panel.dataset.open='0'; return; }

    const sb = searchBox({
      pos: p.pos,
      exclude: Store.squad.map(x=>x.id),
      placeholder: `Replace ${p.name} with…`,
      note: `FPL only allows same-position transfers, so this list is ${CONFIG.POS_LABEL[p.pos].toLowerCase()} only. His season history backfills automatically.`,
      onPick: player => {
        const res = Store.transfer(p.id, player, Store.viewGW);
        if(!res.ok){ alert(res.reason); return; }
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
     CAPTAIN / BENCH / TRANSFERS slides
     These fill in as gameweeks accumulate.
  ================================================= */

  renderCaptain(){
    const el = document.getElementById('captainArea');
    const weeks = this.playedWeeks();

    if(!weeks.length){
      el.innerHTML = emptyNote('Captain record builds up once gameweeks are played.<br>Each week it compares your armband pick against the best scorer in your squad.');
      return;
    }

    const rows = weeks.map(gw=>{
      const capP = Store.squad.find(p=>p.cap);
      const best = Store.squad
        .map(p=>({ p, pts: Store.pointsIn(p, gw) ?? 0 }))
        .sort((a,b)=>b.pts-a.pts)[0];
      const capPts = capP ? (Store.pointsIn(capP, gw) ?? 0) : 0;
      const right  = capP && best && capP.id === best.p.id;
      return `<tr>
        <td class="num">GW${gw}</td>
        <td>${capP ? capP.name : '—'}</td>
        <td class="num">${capPts*2}</td>
        <td>${best ? `${best.p.name} (${best.pts})` : '—'}</td>
        <td style="color:var(--${right?'lime':'amber'})">${right?'Right call':'Missed'}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `<table class="tbl">
      <thead><tr><th>GW</th><th>Captain</th><th>Pts ×2</th><th>Best in squad</th><th>Verdict</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  },

  renderBenchCalls(){
    const el = document.getElementById('benchCallsArea');
    const weeks = this.playedWeeks();

    if(!weeks.length){
      el.innerHTML = emptyNote('Bench calls appear once gameweeks are played.<br>Each week it checks whether your best bench player outscored your weakest starter.');
      return;
    }

    const rows = weeks.map(gw=>{
      const benchBest = Store.bench()
        .map(p=>({ p, pts: Store.pointsIn(p, gw) ?? 0 }))
        .sort((a,b)=>b.pts-a.pts)[0];
      const startWorst = Store.starters().filter(p=>p.pos!=='GK')
        .map(p=>({ p, pts: Store.pointsIn(p, gw) ?? 0 }))
        .sort((a,b)=>a.pts-b.pts)[0];
      if(!benchBest || !startWorst) return '';
      const wrong = benchBest.pts > startWorst.pts;
      return `<tr>
        <td class="num">GW${gw}</td>
        <td>${benchBest.p.name} <span class="num">(${benchBest.pts})</span></td>
        <td>${startWorst.p.name} <span class="num">(${startWorst.pts})</span></td>
        <td style="color:var(--${wrong?'red':'lime'})">${wrong?`Lost ${benchBest.pts-startWorst.pts}`:'Right call'}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `<table class="tbl">
      <thead><tr><th>GW</th><th>Best benched</th><th>Weakest starter</th><th>Verdict</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  },

  renderTransfers(){
    const el = document.getElementById('transferArea');
    const joined = Store.squad.filter(p=>p.inGW);

    if(!joined.length){
      el.innerHTML = emptyNote('No transfers yet.<br>Open any player and use <b>Transfer this player</b> — every swap is logged here and judged on the points each side scored afterwards.');
      return;
    }

    const rows = joined.map(p=>{
      const since = (p.history||[]).filter(h=>h.gw >= p.inGW).reduce((a,h)=>a+h.points,0);
      return `<tr>
        <td class="num">GW${p.inGW}</td>
        <td>${p.name}</td>
        <td class="num">${since}</td>
        <td class="num">${p.pos}</td>
      </tr>`;
    }).join('');

    el.innerHTML = `<table class="tbl">
      <thead><tr><th>In at</th><th>Player</th><th>Pts since</th><th>Pos</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="hint-line">Points for the outgoing player are tracked once the API connection is live, so each swap can be judged both ways.</div>`;
  },

  playedWeeks(){
    const set = new Set();
    Store.squad.forEach(p=>(p.history||[]).forEach(h=>set.add(h.gw)));
    return [...set].sort((a,b)=>a-b);
  }
};

export default Performance;
