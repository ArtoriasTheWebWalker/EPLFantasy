/* =====================================================
   SYNC — cross-device state via the Cloudflare Worker.

   Keeps one shared copy of your squad/draft/candidates in
   the cloud so phone and PC agree. localStorage stays the
   offline cache; this just mirrors it up and down.

   Identity is a single "sync code" you type once per
   device (same code = same data). It lives only in this
   browser, never in committed code.

   Flow:
     • boot()      — pull on load, reconcile with local
     • store:change — debounced push of the whole state
     • openSettings — the ☁ modal to set/clear the code
===================================================== */

import { Store } from './store.js';
import { API }   from './api.js';
import { Modal, choice, confirmDialog } from './ui.js';

const SYNC_BASE = 'https://fpl-sync.abdulelah12012.workers.dev';
const CODE_KEY  = 'fpl2627_sync_code';
const TS_KEY    = 'fpl2627_updated_at';
const MIN_LEN   = 12;
const DEBOUNCE  = 1200;

/* does a state blob actually hold anything worth syncing? */
function hasData(s){
  if(!s) return false;
  return (s.squad?.length || 0) > 0
      || Object.keys(s.draft || {}).length > 0
      || Object.keys(s.candidates || {}).length > 0;
}

export const Sync = {
  _applying: false,
  _timer: null,

  /* ---------- config ---------- */
  base(){ return SYNC_BASE; },
  code(){ return localStorage.getItem(CODE_KEY) || ''; },
  setCode(c){ c ? localStorage.setItem(CODE_KEY, c) : localStorage.removeItem(CODE_KEY); },
  enabled(){ return !!SYNC_BASE && this.code().length >= MIN_LEN; },

  localTs(){ return +localStorage.getItem(TS_KEY) || 0; },
  setLocalTs(t){ localStorage.setItem(TS_KEY, String(t || Date.now())); },

  /* ---------- network ---------- */
  async pull(){
    const r = await fetch(this.base() + '/state', { headers: { 'X-Sync-Code': this.code() } });
    if(!r.ok) throw new Error('pull ' + r.status);
    return r.json();                       // { ok, data, updatedAt }
  },

  async push(){
    if(!this.enabled()) return;
    const ts = this.localTs() || Date.now();
    const r = await fetch(this.base() + '/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Sync-Code': this.code() },
      body: JSON.stringify({ data: Store.exportState(), updatedAt: ts }),
    });
    if(!r.ok) throw new Error('push ' + r.status);
    this.setLocalTs(ts);
    return r.json();
  },

  /* debounced push on any local change (skipped while applying a pull) */
  schedulePush(){
    if(this._applying || !this.enabled()) return;
    this.setLocalTs(Date.now());
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.push().catch(()=>{}), DEBOUNCE);
  },

  /* write a remote blob into the store without echoing it back up */
  apply(data, updatedAt){
    this._applying = true;
    Store.importState(data);
    this.setLocalTs(updatedAt || Date.now());
    this._applying = false;
  },

  /* ---------- boot reconcile ---------- */
  async boot(){
    if(!this.enabled()) return;
    let res;
    try { res = await this.pull(); }
    catch { this.refreshButton('offline'); return; }   // offline → keep local

    const remote   = res && res.data;
    const remoteTs = (res && res.updatedAt) || 0;
    const local    = Store.exportState();
    const rFilled  = hasData(remote);
    const lFilled  = hasData(local);

    if(rFilled && !lFilled)               this.apply(remote, remoteTs);
    else if(!rFilled && lFilled)          await this.push().catch(()=>{});
    else if(rFilled && lFilled){
      if(remoteTs > this.localTs())        this.apply(remote, remoteTs);
      else if(this.localTs() > remoteTs)   await this.push().catch(()=>{});
    }
    this.refreshButton();
  },

  /* ---------- header button ---------- */
  refreshButton(state){
    const btn = document.getElementById('syncBtn');
    if(!btn) return;
    const on = this.enabled();
    btn.classList.toggle('synced', on && state !== 'offline');
    btn.classList.toggle('offline', state === 'offline');
    btn.title = on
      ? (state === 'offline' ? 'Sync — offline, using local copy' : 'Sync on — sharing across devices')
      : 'Sync across devices';
  },

  /* ---------- settings modal ---------- */
  openSettings(){
    const code = this.code();
    const mid  = Store.managerId;
    const meta = Store.entryMeta;

    const linkedBlock = mid
      ? `<div class="m-sec">
           <h4>Linked FPL account</h4>
           <div class="cap-rate" style="margin:0 0 8px">
             <b>${(meta?.teamName || 'FPL team').replace(/[<>]/g,'')}</b>
             ${meta?.managerName ? ` · ${meta.managerName.replace(/[<>]/g,'')}` : ''}
             · manager #${mid}
             ${meta?.rank ? ` · rank ${meta.rank.toLocaleString()}` : ''}
           </div>
           <div class="m-actions">
             <button class="m-btn" id="fplResync">Pull from FPL now</button>
             <button class="m-btn danger" id="fplUnlink">Unlink</button>
           </div>
           <div class="hint-line" style="padding:6px 0 0">
             The official picks endpoint is the source of truth for your squad, XI, captain and vice each week. Your notes, flags and shortlist stay local.
           </div>
         </div>`
      : `<div class="m-sec">
           <h4>Link your FPL account</h4>
           <input class="sync-input" id="fplIdInput" type="text" autocomplete="off" spellcheck="false"
                  inputmode="numeric" placeholder="your FPL manager id (e.g. 1234567)">
           <div class="hint-line">Open fantasy.premierleague.com, click your team — the id is the number in the URL: <code>/entry/&lt;this number&gt;/</code>. Read-only — nothing you do here changes the official app.</div>
           <div class="m-actions" style="margin-top:8px">
             <button class="m-btn primary" id="fplLink">Link &amp; pull</button>
           </div>
         </div>`;

    Modal.open(`
      <h3>Sync</h3>
      <div class="m-meta">Cross-device sync + linking your official FPL account.</div>

      ${linkedBlock}

      <div class="m-sec">
        <h4>Cross-device sync code</h4>
        <input class="sync-input" id="syncCodeInput" type="text" autocomplete="off" spellcheck="false"
               placeholder="a long private phrase (12+ characters)"
               value="${code.replace(/"/g,'&quot;')}">
        <div class="hint-line">Same code on phone and PC = same squad. Long and unguessable. Stored only in this browser.</div>
      </div>

      <div class="m-actions">
        <button class="m-btn primary" id="syncSave">${code ? 'Update &amp; sync' : 'Save &amp; sync'}</button>
      </div>
      ${code ? `<div class="m-actions">
        <button class="m-btn" id="syncNow">Sync now</button>
        <button class="m-btn danger" id="syncClear">Turn off</button>
      </div>` : ''}

      <div class="hint-line" id="syncStatus"></div>
    `, 'var(--cyan)');

    const input  = document.getElementById('syncCodeInput');
    const status = document.getElementById('syncStatus');
    const say = t => { if(status) status.textContent = t; };
    setTimeout(()=>input?.focus(), 40);

    /* ---- FPL-link wiring ---- */
    const link = document.getElementById('fplLink');
    if(link) link.onclick = async () => {
      const raw = (document.getElementById('fplIdInput').value || '').trim();
      const r = Store.linkManager(raw);
      if(!r.ok){ say(r.reason); return; }
      say('Pulling from FPL…');
      try{
        const res = await Store.syncFromFPL(API);
        if(!res.ok){ say(res.reason); return; }
        Modal.close();
      }catch(e){ say('Sync failed — check the id and your connection.'); }
    };

    const resync = document.getElementById('fplResync');
    if(resync) resync.onclick = async () => {
      say('Pulling from FPL…');
      try{
        const res = await Store.syncFromFPL(API);
        say(res.ok ? 'Pulled ✓' : (res.reason || 'Sync failed'));
      }catch(e){ say('Sync failed — check your connection.'); }
    };

    const unlink = document.getElementById('fplUnlink');
    if(unlink) unlink.onclick = async () => {
      const ok = await confirmDialog('Unlink your FPL account?',
        'Existing squad data stays; future boots stop syncing until you link again.', 'Unlink');
      if(!ok){ this.openSettings(); return; }   // back to the sync screen, not a closed modal
      Store.unlinkManager();
      Modal.close();
    };

    document.getElementById('syncSave').onclick = async () => {
      const val = (input.value || '').trim();
      if(val.length < MIN_LEN){ say(`Code must be at least ${MIN_LEN} characters.`); return; }

      this.setCode(val);
      say('Checking the cloud…');
      try{
        const res    = await this.pull();
        const remote = res && res.data;
        const rFilled = hasData(remote);
        const lFilled = hasData(Store.exportState());

        if(rFilled && lFilled){
          const useCloud = await choice({
            title: 'This code already has a squad saved',
            body: 'Load the cloud copy onto this device, or keep this device and overwrite the cloud?',
            options: [
              { label:'Keep this device', value:false },
              { label:'Load cloud', value:true, className:'primary' }
            ]
          });
          if(useCloud) this.apply(remote, res.updatedAt);
          else         await this.push();
        } else if(rFilled){
          this.apply(remote, res.updatedAt);
        } else {
          await this.push();                 // seed the cloud from this device
        }

        this.refreshButton();
        Modal.close();
      }catch(e){
        say('Could not reach the cloud. Check the code and your connection.');
      }
    };

    const now = document.getElementById('syncNow');
    if(now) now.onclick = async () => {
      say('Syncing…');
      this.setLocalTs(Date.now());
      try{ await this.push(); say('Synced ✓'); }
      catch{ say('Sync failed — check your connection.'); }
    };

    const clear = document.getElementById('syncClear');
    if(clear) clear.onclick = async () => {
      const ok = await confirmDialog('Turn off sync on this device?',
        'Your squad stays here; it just stops sharing.', 'Turn off');
      if(!ok){ this.openSettings(); return; }
      this.setCode('');
      this.refreshButton();
      Modal.close();
    };
  },
};

/* any local change → debounced push */
window.addEventListener('store:change', () => Sync.schedulePush());

export default Sync;
