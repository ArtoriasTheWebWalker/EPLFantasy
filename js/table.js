/* =====================================================
   TABLE & FIXTURES PAGE

   The live table drives everything else in the app:
   a team's league position becomes its difficulty tier,
   and those tiers colour the fixture runs shown on the
   Draft page. One page, table first, fixtures below,
   teams A to Z.
===================================================== */

import { CONFIG, KITS } from './config.js';
import { Store }        from './store.js';
import { apiBanner, emptyNote } from './ui.js';

const TablePage = {

  mount(){},

  render(){
    document.getElementById('tableBanner').innerHTML = apiBanner(Store.apiState || 'offline');
    this.renderTable();
    this.renderFixtures();
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

      return `<div class="team-fix">
        <div class="team-fix-head">
          <span class="badge" style="--kit:${KITS[t.short] || '#8892a0'}"></span>
          <b>${t.name}</b>
          ${row ? `<span class="pos-chip">${row.position} · ${row.Pts} pts</span>` : ''}
        </div>
        <div class="fix-strip">${cells}</div>
      </div>`;
    }).join('');
  }
};

export default TablePage;
