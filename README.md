# FPL Companion — 2026/27

Personal planning tool. Your squad, how it actually performed, and your own
notes on what to do next. No suggestions, no AI, no weekly data entry.

---

## File map

Each page is three files you can edit in isolation. Change the Draft layout and
you only ever open `pages/draft.html`, `css/draft.css` and `js/draft.js`.

```
index.html              shell only — header, tabs, page containers, modal
├── css/
│   ├── app.css         design system: colours, pitch, chips, modal, tables
│   ├── performance.css
│   ├── draft.css
│   └── table.css
├── pages/
│   ├── performance.html   markup fragment, loaded into the shell
│   ├── draft.html
│   └── table.html
└── js/
    ├── config.js       ← every constant: API URLs, storage keys, squad rules
    ├── api.js          ← every network call. Nothing else touches the network
    ├── store.js        ← the single source of truth, shared by all three pages
    ├── ui.js           shared widgets: chips, modal, player search, banner
    ├── app.js          shell: loads fragments, wires tabs, boots the data
    ├── performance.js
    ├── draft.js
    └── table.js
```

### How the pages stay in sync

All three pages read and write the same `Store`. Nothing is duplicated.

- Add a player on Performance → he appears on the Draft board immediately.
- Flag him "Swap" on Draft → the flag persists and survives a reload.
- The league table sets each team's difficulty tier, which colours the fixture
  runs shown on Draft.

Every mutation persists to `localStorage` and fires a `store:change` event, so
whichever page is open re-renders itself. You never have to refresh.

---

## Going live — the one thing left to wire

The app runs right now, but the player list is empty because it has no data
connection yet. The FPL API is free and needs no key, but it sends no CORS
header, so a browser on GitHub Pages cannot call it directly.

**Fix: set one value in `js/config.js`.**

```js
API_PROXY: '',   // ← put your proxy URL here
```

Once that is set, everything below starts working with no other change:

| What fills in | Endpoint used |
|---|---|
| Player search on every screen | `/bootstrap-static/` |
| Your players' weekly points and breakdowns | `/element-summary/{id}/` |
| Position averages used for grading | `/event/{gw}/live/` |
| League table and all 380 fixtures | `/fixtures/` |

Options for the proxy: a public CORS proxy for testing, or your own tiny
Cloudflare Worker / Vercel function that forwards the request and adds the
header. The Worker route is about ten lines and keeps you off someone else's
rate limit.

Until then the app is in **local mode**: a banner says so, your squad and every
note still save to this browser, and only the search results are empty.

---

## Squad rules enforced

Straight from FPL, hard-coded so the app can't get into an illegal state:

- 15 players: **2 GK, 5 DEF, 5 MID, 3 FWD**
- 11 starters, 4 on the bench
- Exactly **one goalkeeper** starts; the other is always the backup
- A legal XI needs at least **3 DEF, 2 MID, 1 FWD** — formation follows your
  actual selection, so 3-4-3, 4-4-2, 5-3-2 and so on all draw correctly
- Transfers are **same position only**

Try to break any of these and the app tells you why instead of letting it happen.

---

## Grading

Nothing is hand-tuned. A player's colour is his points that week divided by the
average for his position that week.

- Blue — 1.8× the position average or better
- Green — 1.15× or better
- Amber — 0.6× or better
- Red — below that

The position average **excludes anyone who scored zero**, which is the
pragmatic stand-in for "did he actually play". Thresholds live in
`CONFIG.GRADE_CUTS` if you want to move them.

> Known gap, deliberately left alone for now: grading compares every player
> against his position average regardless of price, so a £4.0m bench filler is
> judged by the same yardstick as a £6.0m starter. A price-tier-aware version is
> the obvious next iteration.

---

## Page by page

**Performance** — your squad on the pitch. Pick any gameweek, or Season for
accumulated totals. Star players strip on top. Tap a shirt for the points
breakdown; in Season view that becomes a scouting report reading consistency,
variance, form trend, performance against strong versus weak opponents, and
rotation risk. Captain, bench and transfer slides fill in as weeks accumulate.

**Draft** — the same pitch, but season view only. Colour is his season form,
the label under each shirt is your flag: Hold, Watch or Swap. Tap for your own
notes; a small orange dot marks a player you've written about. Below the pitch,
four always-visible position sections hold your shortlist — each candidate shows
last gameweek, season average, season total, his next five fixtures coloured by
difficulty, and a swap plan you set yourself.

**Table & fixtures** — live table on top, all 20 teams A to Z below with their
full 38-gameweek run. Past results dim, the next five colour by opponent tier.
League position is what generates those tiers everywhere else in the app.

---

## Open items

- Transfer button placement on the Performance modal — flagged as feeling out of
  place, left as-is for now
- Price-tier-aware grading
- Highlighting your own teams in the alphabetical fixture list
