/* =====================================================
   TABLE & FIXTURES PAGE

   The live table drives everything else in the app:
   a team's league position becomes its difficulty tier,
   and those tiers colour the fixture runs shown on the
   Draft page. Fixtures come first — by team (A to Z) or
   by gameweek — with the table itself as a third tab.
===================================================== */

import { CONFIG, KITS } from './config.js';
import { Store }        from './store.js';
import { apiBanner, emptyNote, wireSlideNav } from './ui.js';

const TablePage = {

  gwView: null,   // which gameweek the "By gameweek" tab is showing

  mount(){ wireSlideNav('#page-table'); },

  render(){
    document.getElementById('tableBanner').innerHTML = apiBanner(Store.apiState || 'offline');
    this.renderFixtures();
    this.renderByGW();
    this.renderTable();
  },

  /* =================================================
     LEAGUE TABLE
  ================================================= */
  renderTable(){
    const host  = document.getElementById('leagueTableArea');
    const stamp = document.getElementById('tableStamp');

    if(!Store.table.length){
      host.innerHTML = emptyNote('The table fills in from the FPL API.<br>It is built from finished fixtures, and every team\'s position sets its difficulty tier across the app.');
      stamp.textContent = '';
      return;
    }

    stamp.textContent = `${Store.table[0].P} matches played · refreshes 0${CONFIG.REFRESH_HOUR}:00`;

    const rows = Store.table.map(r=>{
      const tier = Store.tierOf(r.id);
      const meta = Store.tierMeta(tier);
      return `<tr>
        <td class="pos">${r.position}</td>
        <td>${r.name}</td>
        <td>${r.P}</td>
        <td>${r.W}</td>
        <td>${r.D}</td>
        <td>${r.L}</td>
        <td>${r.GD > 0 ? '+' : ''}${r.GD}</td>
        <td class="pts">${r.Pts}</td>
        <td><span class="tier" style="background:${meta.color}" title="${meta.label}">T${tier}</span></td>
      </tr>`;
    }).join('');

    host.innerHTML = `<div class="lg-wrap"><table class="lg">
      <thead><tr>
        <th></th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th><th>Tier</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  },

  /* =================================================
     FIXTURES — alphabetical by team
  ================================================= */
  renderFixtures(){
    const host = document.getElementById('fixtureArea');

    if(!Store.teams.length || !Store.fixtures.length){
      host.innerHTML = emptyNote('Fixtures arrive with the FPL API.<br>Each team gets its full 38-gameweek run, coloured by how hard the opponent is.');
      return;
    }

    const teams = [...Store.teams].sort((a,b)=>a.name.localeCompare(b.name));

    host.innerHTML = teams.map(t=>{
      const row = Store.table.find(r=>r.id === t.id);

      const mine = Store.fixtures
        .filter(f=>f.homeId===t.id || f.awayId===t.id)
        .sort((a,b)=>(a.gw??99)-(b.gw??99));

      const cells = mine.map(f=>{
        const home  = f.homeId === t.id;
        const oppId = home ? f.awayId : f.homeId;
        const opp   = Store.teamById[oppId]?.short || '???';
        const tier  = Store.tierOf(oppId);
        const meta  = Store.tierMeta(tier);

        const past = f.finished;
        const far  = !past && f.gw > Store.currentGW + 4;

        const cls = past ? 'fx past' : far ? 'fx far' : 'fx';
        const style = far ? '' : `style="--tc:${meta.color}"`;
        const score = past && f.homeScore != null
          ? `${home ? f.homeScore : f.awayScore}-${home ? f.awayScore : f.homeScore}`
          : `GW${f.gw ?? '—'}`;

        return `<span class="${cls}" ${style} title="GW${f.gw} ${home?'vs':'away to'} ${opp} — ${meta.label}">
          <b>${opp}</b><small>${score}</small>
        </span>`;
      }).join('');

      /* next-5 run summary, so a run can be read at a glance without
         hovering every cell — same tiers the Draft page fixture strip
         already uses, just averaged */
      const run = Store.nextFixtures(t.id, 5);
      const avgTier = run.length ? run.reduce((s,r)=>s+r.tier, 0) / run.length : null;
      const avgMeta = avgTier != null ? Store.tierMeta(Math.round(avgTier)) : null;
      const runBadge = avgMeta
        ? `<span class="run-chip" style="--tc:${avgMeta.color}" title="Average difficulty of the next ${run.length} fixtures">Next ${run.length}: ${avgMeta.label}</span>`
        : '';

      return `<div class="team-fix">
        <div class="team-fix-head">
          <span class="badge" style="--kit:${KITS[t.short] || '#8892a0'}"></span>
          <b>${t.name}</b>
          <div class="head-badges">
            ${row ? `<span class="pos-chip">${row.position} · ${row.Pts} pts</span>` : ''}
            ${runBadge}
          </div>
        </div>
        <div class="fix-strip">${cells}</div>
      </div>`;
    }).join('');
  },

  /* =================================================
     FIXTURES — by gameweek, all matches for one week
  ================================================= */
  renderByGW(){
    const pillRow = document.getElementById('fxGwRow');
    const host    = document.getElementById('fxGwArea');
    if(!pillRow || !host) return;

    if(!Store.fixtures.length){
      pillRow.innerHTML = '';
      host.innerHTML = emptyNote('Fixtures arrive with the FPL API.');
      return;
    }

    const gws = [...new Set(Store.fixtures.map(f=>f.gw))].filter(Boolean).sort((a,b)=>a-b);
    if(this.gwView == null || !gws.includes(this.gwView)){
      this.gwView = gws.includes(Store.currentGW) ? Store.currentGW : gws[0];
    }

    pillRow.innerHTML = '<button class="gw-step" id="fxGwPrev" aria-label="Previous gameweek">&lsaquo;</button>'
      + gws.map(gw=>`<button class="gw${gw===this.gwView?' active':''}" data-gw="${gw}">GW${gw}</button>`).join('')
      + '<button class="gw-step" id="fxGwNext" aria-label="Next gameweek">&rsaquo;</button>';

    pillRow.querySelectorAll('[data-gw]').forEach(b=>{
      b.onclick = () => { this.gwView = +b.dataset.gw; this.renderByGW(); };
    });
    document.getElementById('fxGwPrev').onclick = () => {
      const i = gws.indexOf(this.gwView);
      if(i > 0){ this.gwView = gws[i-1]; this.renderByGW(); }
    };
    document.getElementById('fxGwNext').onclick = () => {
      const i = gws.indexOf(this.gwView);
      if(i >= 0 && i < gws.length-1){ this.gwView = gws[i+1]; this.renderByGW(); }
    };

    const matches = Store.fixtures
      .filter(f=>f.gw === this.gwView)
      .sort((a,b)=>(a.kickoff||'').localeCompare(b.kickoff||''));

    if(!matches.length){
      host.innerHTML = emptyNote(`No fixtures found for GW${this.gwView}.`);
      return;
    }

    host.innerHTML = matches.map(f=>{
      const home = Store.teamById[f.homeId], away = Store.teamById[f.awayId];
      const hTier = Store.tierMeta(Store.tierOf(f.homeId));
      const aTier = Store.tierMeta(Store.tierOf(f.awayId));
      const score = f.finished && f.homeScore != null
        ? `${f.homeScore} &ndash; ${f.awayScore}`
        : 'vs';
      const kickoff = !f.finished && f.kickoff
        ? new Date(f.kickoff).toLocaleString(undefined, { weekday:'short', hour:'2-digit', minute:'2-digit' })
        : (f.finished ? 'FT' : '');

      return `<div class="gwm">
        <div class="gwm-team" style="--tc:${hTier.color}">
          <span class="badge" style="--kit:${KITS[home?.short] || '#8892a0'}"></span>
          <span class="gwm-name">${home?.name || '?'}</span>
        </div>
        <div class="gwm-mid"><b>${score}</b><small>${kickoff}</small></div>
        <div class="gwm-team right" style="--tc:${aTier.color}">
          <span class="gwm-name">${away?.name || '?'}</span>
          <span class="badge" style="--kit:${KITS[away?.short] || '#8892a0'}"></span>
        </div>
      </div>`;
    }).join('');
  }
};

export default TablePage;
