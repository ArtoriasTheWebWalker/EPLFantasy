/* =====================================================
   PERFORMANCE PAGE — READ ONLY

   The record of what actually happened: the squad as it
   performed, week by week, plus the captain, bench and
   transfer reviews.

   NOTHING on this page edits anything. No add slots, no
   drag-and-drop, no transfers, no armband, no chips. Tap
   a shirt and you get his points breakdown; that is the
   only interaction. All editing lives on the Draft page,
   which is the single place a team sheet is written.

   Keeping it that way matters: this page renders finished
   gameweeks from frozen snapshots, so an edit made here
   would be editing history.
===================================================== */

import { CONFIG } from './config.js';
import { Store }  from './store.js';
import { Modal, chipEl, apiBanner, emptyNote } from './ui.js';

/* concrete grade colours (kept in sync with css :root) — used where an
   inline SVG needs a real colour value rather than a CSS variable */
const GRADE_HEX = { blue:'#4FB8FF', green:'#4BE58A', amber:'#FFC43D', red:'#FF5A72', lime:'#B6FF3D' };

const Performance = {

  mount(){
    const nav   = document.querySelector('#page-performance .slide-nav');
    const snavs = document.querySelectorAll('#page-performance .snav');

    const move = (btn, instant) => {
      if(!btn || !nav) return;
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
        document.querySelectorAll('#page-performance .slide').forEach(s=>s.classList.remove('active'));
        document.getElementById(btn.dataset.slide).classList.add('active');
        move(btn);
      };
    });

    const settle = () => move(document.querySelector('#page-performance .snav.active') || snavs[0], true);
    settle();
    window.addEventListener('resize', settle);
  },

  /* A gameweek is "past" once its deadline has gone, not merely once
     FPL stops calling it current — otherwise the week you've just
     played renders today's working squad instead of what you fielded,
     and every Draft edit appears to rewrite its live score. */
  isPastGW(){ return !Store.seasonMode && Store.viewGW < Store.editableGW(); },

  render(){
    document.getElementById('perfBanner').innerHTML = apiBanner(Store.apiState || 'offline');
    this.renderHero();
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
     the pitch — per-GW lineup, display only. Past GWs
     read frozen snapshots from Store.lineups[gw]; the
     live one reads the working squad set on Draft.
  ------------------------------------------------- */
  renderPitch(){
    const pitch = document.getElementById('pitchArea');
    const bench = document.getElementById('benchArea');
    pitch.innerHTML = '<div class="goalmouth"></div>';
    bench.innerHTML = '';

    const past = this.isPastGW();
    const gw   = Store.seasonMode ? Store.currentGW : Store.viewGW;

    /* Past gameweeks read their frozen snapshot; the live one reads the
       working squad. No empty slots — this page never adds a player. */
    const starters = past ? Store.startersForGW(gw) : Store.starters();
    const benched  = past ? Store.benchForGW(gw)    : Store.bench();

    CONFIG.POS_ORDER.forEach(pos=>{
      const row = document.createElement('div');
      row.className = 'p-row' + (pos==='GK' ? ' gk' : '');
      starters.filter(p=>p.pos===pos).forEach(p => row.appendChild(this.playerChip(p)));
      if(row.children.length) pitch.appendChild(row);
    });

    benched.forEach(p => bench.appendChild(this.playerChip(p)));
  },

  /* one chip. Captain / vice come from the map keyed on the viewed GW
     (or currentGW in season mode). The effective captain of the viewed
     GW gets his points multiplied, with a ×2 (or ×3 under Triple
     Captain) badge on the stripe. */
  playerChip(p){
    const g = Store.seasonMode ? Store.gradeSeason(p) : Store.gradeGW(p, Store.viewGW);
    const pts = g.pts;

    const gwForBadge = Store.seasonMode ? Store.currentGW : Store.viewGW;
    const capId  = Store.captainIdOf(gwForBadge);
    const viceId = Store.viceIdOf(gwForBadge);
    const isCap  = capId  != null && p.id === capId;
    const isVice = viceId != null && p.id === viceId;

    const capMult = Store.capMultFor(Store.viewGW);
    let doubledPts = null;
    if(!Store.seasonMode && pts !== null){
      const eff = Store.effectiveCaptain(Store.viewGW).player;
      if(eff && eff.id === p.id) doubledPts = pts * capMult;
    }

    const stripeText = pts === null
      ? '—'
      : (doubledPts !== null
          ? `${doubledPts} <small>PTS · ×${capMult}</small>`
          : `${pts} <small>PTS</small>`);

    const chip = chipEl(p, {
      grade  : g.grade,
      showCap: true,
      cap    : isCap,
      vice   : isVice,
      stripe : { text: stripeText },
      meta   : Store.seasonMode
                 ? `${p.team} · season`
                 : `${p.team} · £${p.price.toFixed(1)}m`
      /* no onClick here — openOnTap wires it */
    });

    this.openOnTap(chip, p);
    return chip;
  },

  /* Tap a shirt for the breakdown. That is the only interaction on this
     page: Performance is a record, not an editor. Selection, transfers
     and the armband all live on the Draft page. */
  openOnTap(chip, p){
    chip.onclick = () => this.openPlayer(p);
  },

  renderStars(){
    const row = document.getElementById('starsRow');

    /* pool of players eligible for the "star" tiles for this view:
       past GW → the 15 who were in the squad that week (snapshot);
       current / season → today's active squad */
    const eligible = this.isPastGW()
      ? Store.squadForGW(Store.viewGW)
      : Store.activeSquad();
    if(eligible.length < 3 || !eligible.some(p=>p.history?.length)){
      row.innerHTML = '';
      return;
    }
    const startedThisView = new Set(
      (this.isPastGW() ? Store.startersForGW(Store.viewGW) : Store.starters())
        .map(p=>p.id)
    );

    const val = p => Store.seasonMode ? Store.seasonTotal(p) : (Store.pointsIn(p, Store.viewGW) ?? 0);
    const ratio = p => {
      const g = Store.seasonMode ? Store.gradeSeason(p) : Store.gradeGW(p, Store.viewGW);
      return g.ratio ?? 0;
    };
    const valueRatio = p => ratio(p) / Math.max(0.1, p.price / 6);

    const pool = eligible.filter(p=>p.history?.length);
    if(!pool.length){ row.innerHTML=''; return; }

    const top  = [...pool].sort((a,b)=>val(b)-val(a))[0];
    const out  = [...pool].filter(p=>p!==top).sort((a,b)=>valueRatio(b)-valueRatio(a))[0] || top;
    const dis  = [...pool].filter(p=>startedThisView.has(p.id)).sort((a,b)=>ratio(a)-ratio(b))[0] || pool[0];
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
     hero stat bar — GW points doubles for the effective
     captain of the viewed GW (0-min captain → vice).
  ------------------------------------------------- */
  renderHero(){
    const el = document.getElementById('heroStats');
    if(!el) return;

    if(!Store.activeSquad().length){ el.innerHTML = ''; return; }

    /* real team score — starters + captain doubling + Bench Boost /
       Triple Captain effects, minus transfer hits. Prefers the linked
       account's own totals when available. */
    const seasonPts = Store.seasonPointsTotal();
    const value     = Store.activeSquad().reduce((a,p)=>a + (p.price||0), 0);
    const weeks     = this.playedWeeks().length;
    const gwPts     = Store.gwPointsFor(Store.viewGW);
    const chipLabel = Store.CHIP_SHORT[Store.chipOf(Store.viewGW)] || null;

    const gwLabel = `GW${Store.viewGW} points${chipLabel ? ` · ${chipLabel}` : ''}`;
    const third = Store.seasonMode
      ? ['Points / week', weeks ? (seasonPts/weeks).toFixed(1) : '—', 'violet']
      : [gwLabel, gwPts, 'violet'];

    /* if the FPL account is linked, prefer live overall rank in the
       second slot; Squad value falls off. Otherwise keep Squad value. */
    const rank = Store.entryMeta?.rank;
    const second = rank
      ? ['Overall rank', rank.toLocaleString(), 'cyan']
      : ['Squad value', '£' + value.toFixed(1) + 'm', 'cyan'];

    const tiles = [
      ['Season points', seasonPts, 'lime'],
      second,
      third
    ];

    el.innerHTML = tiles.map(([label,val,accent])=>`
      <div class="hero-tile a-${accent}">
        <div class="ht-label">${label}</div>
        <div class="ht-val">${val}</div>
      </div>`).join('');
  },

  /* -------------------------------------------------
     form sparkline — tiny inline trend chart
  ------------------------------------------------- */
  sparklineSVG(history, color){
    const pts = (history||[]).map(h=>h.points);
    if(pts.length < 2) return '';

    const w=100, h=32, pad=3;
    const min=Math.min(...pts), max=Math.max(...pts), rng=Math.max(1, max-min);
    const stepX=(w - pad*2)/(pts.length - 1);
    const coords=pts.map((v,i)=>[ pad + i*stepX, pad + (h - pad*2)*(1 - (v-min)/rng) ]);

    const line=coords.map((c,i)=>(i?'L':'M') + c[0].toFixed(1) + ' ' + c[1].toFixed(1)).join(' ');
    const area=`${line} L ${coords.at(-1)[0].toFixed(1)} ${h-pad} L ${coords[0][0].toFixed(1)} ${h-pad} Z`;
    const last=coords.at(-1);
    const uid='sl' + Math.random().toString(36).slice(2,7);

    return `<svg class="sparkline" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.34"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#${uid})"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.6" fill="${color}"/>
    </svg>`;
  },

  /* -------------------------------------------------
     squad completeness readout (carries squad value)
  ------------------------------------------------- */
  renderStatus(){
    const el = document.getElementById('squadStatus');
    const quota = CONFIG.POS_ORDER.map(pos=>{
      const have = Store.countPos(pos), want = CONFIG.SQUAD[pos];
      return `<span class="${have===want?'done':''}">${pos} ${have}/${want}</span>`;
    }).join('');

    const n = Store.squad.length;
    const val = Store.squadValue();
    const issues = n === CONFIG.SQUAD.TOTAL ? Store.formationIssues() : [];

    const head = n === CONFIG.SQUAD.TOTAL
      ? `<b>Squad complete</b> · ${Store.starters().length} starting · ${Store.bench().length} benched · Formation <b>${Store.formation()}</b> · Value <b>£${val.toFixed(1)}m</b>`
      : `<b>${n}/${CONFIG.SQUAD.TOTAL} players</b> · Value <b>£${val.toFixed(1)}m</b>`;

    const warn = issues.length
      ? `<div style="color:var(--amber);margin-top:7px">Your XI ${issues.join(', ')}.</div>`
      : '';

    /* squad-level legality (club limit, budget) — always checked, since
       an over-limit squad can arrive from a sync as well as from editing */
    const legal = Store.squadIssues();
    const legalWarn = legal.length
      ? `<div style="color:var(--amber);margin-top:7px">${legal.join(' · ')}.</div>`
      : '';

    el.innerHTML = `${head}${warn}${legalWarn}<div class="quota">${quota}</div>`;
  },

  openPlayer(p){
    Store.seasonMode ? this.seasonModal(p) : this.gwModal(p);
  },

  gwModal(p){
    const g = Store.gradeGW(p, Store.viewGW);
    const h = p.history?.find(x=>x.gw===Store.viewGW);

    const breakdown = h ? this.breakdownRows(h, p.pos) : '';
    const spark = this.sparklineSVG(p.history, GRADE_HEX[g.grade] || GRADE_HEX.lime);

    const eff = Store.effectiveCaptain(Store.viewGW);
    const isEffCap = eff.player && eff.player.id === p.id;
    const capMult  = Store.capMultFor(Store.viewGW);
    const capTag = isEffCap
      ? `<span class="m-grade" style="--grade:var(--lime);margin-left:6px">Captain ×${capMult}${eff.fallback?' · via vice':''}</span>`
      : '';

    const chip = Store.chipOf(Store.viewGW);
    const started = this.isPastGW()
      ? Store.startersForGW(Store.viewGW).some(x => x.id === p.id)
      : p.start;

    Modal.open(`
      <h3>${p.name}</h3>
      <div class="m-meta">${p.team} · ${p.pos} · £${p.price.toFixed(1)}m · GW${Store.viewGW} · ${started ? 'started' : 'benched'}${chip ? ` · ${Store.CHIP_LABEL[chip]}` : ''}</div>
      ${g.grade ? `<span class="m-grade" style="--grade:var(--${g.grade})">${CONFIG.GRADE_WORD[g.grade]}</span>${capTag}` : capTag}

      ${spark ? `<div class="m-sec"><h4>Season form — last ${p.history.length} weeks</h4>${spark}</div>` : ''}

      ${h ? `<div class="m-sec"><h4>Points breakdown</h4>${breakdown}${isEffCap && h.points!=null ? `<div class="break-row total" style="border-top:none"><span>Captain ×${capMult}</span><span>${h.points*capMult}</span></div>` : ''}</div>`
          : `<div class="hint-line">No data for GW${Store.viewGW} yet.</div>`}

      <div class="hint-line">Transfers, the armband and chips are set on the Draft page.</div>
    `, `var(--${g.grade||'lime'})`);
  },

  seasonModal(p){
    const g = Store.gradeSeason(p);
    const hist = p.history || [];

    const cells = hist.map(h=>{
      const gg = Store.gradeGW(p, h.gw);
      return `<div class="gw-cell w-${gg.grade||'amber'}"><b>${h.points}</b><small>GW${h.gw}</small></div>`;
    }).join('');

    const insights = this.scoutingReport(p);
    const spark = this.sparklineSVG(hist, GRADE_HEX[g.grade] || GRADE_HEX.lime);

    Modal.open(`
      <h3>${p.name}</h3>
      <div class="m-meta">${p.team} · ${p.pos} · £${p.price.toFixed(1)}m · season to date</div>
      ${g.grade ? `<span class="m-grade" style="--grade:var(--${g.grade})">${CONFIG.GRADE_WORD[g.grade]} — season</span>` : ''}

      ${spark ? `<div class="m-sec"><h4>Form trend</h4>${spark}</div>` : ''}

      ${hist.length ? `
        <div class="m-sec"><h4>Week by week</h4><div class="gw-strip">${cells}</div></div>
        <div class="m-sec"><h4>Scouting report — ${Store.seasonTotal(p)} pts in ${hist.length} weeks</h4>
          ${insights.map(([em,tx])=>`<div class="insight"><span class="em">${em}</span><span>${tx}</span></div>`).join('')}
        </div>`
      : `<div class="hint-line">No season history yet.</div>`}

      <div class="hint-line">Transfers, the armband and chips are set on the Draft page.</div>
    `, `var(--${g.grade||'lime'})`);
  },

  breakdownRows(h, pos){
    const rows = [];
    if(h.minutes)     rows.push(['Minutes played', h.minutes]);
    if(h.goals)       rows.push(['Goals', h.goals]);
    if(h.assists)     rows.push(['Assists', h.assists]);
    if(h.cleanSheet)  rows.push(['Clean sheet', h.cleanSheet]);
    if(pos==='GK' && h.saves) rows.push(['Saves', h.saves]);
    if(h.pensSaved)   rows.push(['Penalty saved', h.pensSaved]);
    if(h.conceded)    rows.push(['Goals conceded', h.conceded]);

    /* Defensive contribution — a flat +2 once the position threshold
       is met, and nothing below it. Show the tally against the bar so
       a near miss is visible, since it's otherwise invisible points. */
    const bar = CONFIG.DEFCON[pos];
    if(bar != null && h.defCon != null){
      const hit = h.defCon >= bar;
      rows.push([
        'Defensive contribution',
        `${h.defCon} / ${bar}${hit ? ` &rarr; +${CONFIG.DEFCON_POINTS}` : ''}`
      ]);
    }

    if(h.bonus)       rows.push(['Bonus', h.bonus]);
    if(h.ownGoals)    rows.push(['Own goal', h.ownGoals]);
    if(h.pensMissed)  rows.push(['Penalty missed', h.pensMissed]);
    if(h.yellow)      rows.push(['Yellow card', h.yellow]);
    if(h.red)         rows.push(['Red card', h.red]);

    return rows.map(([k,v])=>`<div class="break-row"><span>${k}</span><span>${v}</span></div>`).join('')
      + `<div class="break-row total"><span>Total</span><span>${h.points}</span></div>`;
  },

  scoutingReport(p){
    const hist = p.history || [];
    const out = [];
    if(hist.length < 2) return [['·','Not enough weeks yet to read a pattern.']];

    const pts = hist.map(h=>h.points);
    const n = pts.length;

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

    const spread = Math.max(...pts) - Math.min(...pts);
    if(spread >= 9) out.push(['~','Streaky — big hauls separated by quiet weeks. Hard to bench, hard to trust.']);
    else if(spread <= 4 && n >= 4) out.push(['=','Low variance — you broadly know what you are getting each week.']);

    if(n >= 6){
      const first = pts.slice(0,3).reduce((a,b)=>a+b,0)/3;
      const last  = pts.slice(-3).reduce((a,b)=>a+b,0)/3;
      if(last - first >= 2.5) out.push(['↗','Trending up — his best football is the recent stuff.']);
      else if(first - last >= 2.5) out.push(['↘','Fading — early-season form has dropped off.']);
    }

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

    const started = hist.filter(h=>h.minutes >= 60).length;
    if(started <= Math.floor(n*0.6)) out.push(['◷',`Rotation risk — 60+ minutes in only ${started} of ${n} weeks.`]);

    if(!out.length) out.push(['·','Steady, unremarkable season so far — roughly what the position expects.']);
    return out;
  },

  /* -------------------------------------------------
     modal buttons — captain/vice target the ARMBAND GW
     (the viewed GW in single-GW mode, currentGW in season)
  ------------------------------------------------- */
  /* =================================================
     CAPTAIN / BENCH / TRANSFERS slides
  ================================================= */

  renderCaptain(){
    const el = document.getElementById('captainArea');
    const weeks = this.playedWeeks();

    if(!weeks.length){
      el.innerHTML = emptyNote('No gameweeks played yet.');
      return;
    }

    let hits = 0, counted = 0;

    const rows = weeks.map(gw=>{
      const eff  = Store.effectiveCaptain(gw);
      const capP = eff.player;
      /* "best in squad" that GW is picked from the roster that was
         in the squad THAT WEEK, not today's roster */
      const best = Store.squadForGW(gw)
        .map(p=>({ p, pts: Store.pointsIn(p, gw) ?? 0 }))
        .sort((a,b)=>b.pts-a.pts)[0];
      const capPts = capP ? (Store.pointsIn(capP, gw) ?? 0) : 0;
      const capMult = Store.capMultFor(gw);
      const right  = capP && best && capP.id === best.p.id;
      if(capP){ counted++; if(right) hits++; }

      return `<tr>
        <td class="num">GW${gw}</td>
        <td>${capP ? capP.name : '—'}${eff.fallback ? ' <span class="vtag">via vice</span>' : ''}</td>
        <td class="num">${capPts*capMult}${capMult !== 2 ? ` <span class="vtag">×${capMult}</span>` : ''}</td>
        <td>${best ? `${best.p.name} (${best.pts})` : '—'}</td>
        <td style="color:var(--${right?'lime':'amber'})">${capP ? (right?'Right call':'Missed') : '—'}</td>
      </tr>`;
    }).join('');

    const rate = counted ? Math.round(hits/counted*100) : 0;

    el.innerHTML = `<table class="tbl">
      <thead><tr><th>GW</th><th>Captain</th><th>Captain pts</th><th>Best in squad</th><th>Verdict</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="cap-rate">Right call in <b>${hits}/${counted}</b> weeks · <b>${rate}%</b></div>`;
  },

  renderBenchCalls(){
    const el = document.getElementById('benchCallsArea');
    const weeks = this.playedWeeks();

    if(!weeks.length){
      el.innerHTML = emptyNote('No gameweeks played yet.');
      return;
    }

    const rows = weeks.map(gw=>{
      /* the bench-vs-starter comparison uses the snapshot for that GW,
         so past weeks stay frozen when you make changes today */
      const benchBest = Store.benchForGW(gw)
        .map(p=>({ p, pts: Store.pointsIn(p, gw) ?? 0 }))
        .sort((a,b)=>b.pts-a.pts)[0];
      const startWorst = Store.startersForGW(gw).filter(p=>p.pos!=='GK')
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
      el.innerHTML = emptyNote('No transfers yet.');
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
      <tbody>${rows}</tbody></table>`;
  },

  playedWeeks(){
    const set = new Set();
    Store.squad.forEach(p=>(p.history||[]).forEach(h=>set.add(h.gw)));
    return [...set].sort((a,b)=>a-b);
  }
};

export default Performance;
