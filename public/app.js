// Cric Journal web client – framework-free SPA (ES modules, History API routing, SSE live updates).
const API = '/api/v1';
const $app = document.getElementById('app');
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const api = async (path) => {
  const r = await fetch(API + path, { headers: { accept: 'application/json' } });
  if (!r.ok) throw Object.assign(new Error((await r.json().catch(() => ({}))).error || r.statusText), { status: r.status });
  return r.json();
};

// ---------- Live connections (one per view) ----------
let streams = [];
const closeStreams = () => { streams.forEach((s) => s.close()); streams = []; };
function listen(path, onUpdate, throttleMs = 1500) {
  if (!('EventSource' in window)) return;
  let t = 0, pending;
  const es = new EventSource(API + path);
  const fire = (e) => {
    const data = JSON.parse(e.data);
    const now = Date.now();
    clearTimeout(pending);
    if (now - t >= throttleMs) { t = now; onUpdate(data); } else pending = setTimeout(() => { t = Date.now(); onUpdate(data); }, throttleMs - (now - t));
  };
  ['ball', 'toss', 'innings_end', 'match_end'].forEach((ev) => es.addEventListener(ev, fire));
  streams.push(es);
}

// ---------- Formatting helpers ----------
const fmtDate = (iso, opts = {}) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...opts });
const isLive = (m) => m.status === 'live' || m.status === 'innings_break';
const flag = (t) => `<span class="flag" style="background:${esc(t.color || '#678')}">${esc(t.shortName)}</span>`;
const avatar = (name, color = '#0b7a5a') => `<span class="avatar" style="background:${esc(color)}">${esc(name.split(' ').map((s) => s[0]).join('').slice(0, 2))}</span>`;
const scoreText = (t) => t.innings.map((i) => `${i.runs}${i.wickets === 10 ? '' : '/' + i.wickets}`).join(' & ');
const oversText = (t) => { const l = t.innings.at(-1); return l ? `(${l.overs})` : ''; };
const statusBadge = (m) => isLive(m) ? `<span class="badge live">${m.status === 'innings_break' ? 'Break' : 'Live'}</span>` : m.status === 'upcoming' ? `<span class="badge">Upcoming</span>` : `<span class="badge">Result</span>`;
const sitClass = (m) => isLive(m) ? '' : m.status === 'completed' ? 'done' : 'up';
const ballClass = (s) => s === 'W' ? 'bW' : s === '4' ? 'b4' : s === '6' ? 'b6' : /[a-z]/.test(s) ? 'bx' : '';
const ballsHtml = (arr) => arr.map((s) => `<span class="ball ${ballClass(s)}">${esc(s)}</span>`).join('');

function teamRows(m) {
  const battingNow = m.teams.find((t) => t.innings.some((i) => i.live));
  return m.teams.map((t) => {
    const dim = m.status === 'completed' ? m.winnerId && m.winnerId !== t.id : battingNow && battingNow.id !== t.id;
    return `<div class="team-row ${dim ? 'dim' : ''}">${flag(t)}<span class="name">${esc(t.name)}</span>
      <span class="score">${t.innings.length ? `${esc(scoreText(t))}<span class="ov">${esc(oversText(t))}</span>` : ''}</span></div>`;
  }).join('');
}
const matchCard = (m) => `
  <a class="card match-card" href="/match/${esc(m.id)}">
    <div class="top"><span class="series">${esc(m.title)} · ${esc(m.series?.name ?? '')}</span>${statusBadge(m)}</div>
    ${teamRows(m)}
    <div class="situation ${sitClass(m)}">${esc(m.status === 'upcoming' ? fmtDate(m.startTime) + ' · ' + m.venue : m.situation)}</div>
  </a>`;
const miniCard = (m) => `
  <a class="mini" href="/match/${esc(m.id)}">
    <div class="meta"><span>${esc(m.title)} · ${esc(m.format)}</span>${isLive(m) ? '<span class="badge live">Live</span>' : ''}</div>
    ${m.teams.map((t) => `<div class="row"><span>${esc(t.shortName)}</span><span>${t.innings.length ? esc(scoreText(t)) + ' ' + esc(oversText(t)) : ''}</span></div>`).join('')}
    <div class="sit">${esc(m.status === 'upcoming' ? fmtDate(m.startTime) : m.situation)}</div>
  </a>`;
const newsCard = (n) => `<a class="card news-card" href="/news/${esc(n.id)}"><h3>${esc(n.title)}</h3><p>${esc(n.summary)}</p><div class="small muted" style="margin-top:6px">${esc(fmtDate(n.publishedAt, { hour: undefined, minute: undefined }))}</div></a>`;
const empty = (msg) => `<div class="card empty">${esc(msg)}</div>`;

// ---------- Live strip ----------
async function refreshStrip() {
  const ms = await api('/matches?limit=12').catch(() => []);
  const strip = document.getElementById('live-strip');
  strip.hidden = !ms.length;
  document.getElementById('live-strip-inner').innerHTML = ms.map(miniCard).join('');
}

// ---------- Views ----------
const views = {
  async home() {
    const [live, upcoming, recent, news] = await Promise.all([
      api('/matches?status=live'), api('/matches?status=upcoming&limit=4'), api('/matches?status=recent&limit=4'), api('/news?limit=6'),
    ]);
    $app.innerHTML = `
      <div class="cols">
        <div>
          <h2>Live now <a class="more" href="/matches?tab=live">All matches ›</a></h2>
          <div class="grid two">${live.map(matchCard).join('') || empty('No live matches right now')}</div>
          <h2>Recent results <a class="more" href="/matches?tab=recent">More ›</a></h2>
          <div class="grid two">${recent.map(matchCard).join('')}</div>
          <h2>Upcoming <a class="more" href="/matches?tab=upcoming">Schedule ›</a></h2>
          <div class="grid two">${upcoming.map(matchCard).join('')}</div>
        </div>
        <aside>
          <h2>Latest news <a class="more" href="/news">All ›</a></h2>
          <div class="grid">${news.map(newsCard).join('')}</div>
        </aside>
      </div>`;
    listen('/stream', () => { if (location.pathname === '/') rerender(); }, 4000);
  },

  async matches(_, qs) {
    const tab = qs.get('tab') || 'live';
    const fmt = qs.get('format') || '';
    const list = await api(`/matches?status=${tab}${fmt ? '&format=' + fmt : ''}`);
    const link = (k, v, label, cur) => {
      const p = new URLSearchParams({ tab, format: fmt, [k]: v });
      if (!p.get('format')) p.delete('format');
      return `<a class="chip ${cur === v ? 'active' : ''}" href="/matches?${p}">${label}</a>`;
    };
    $app.innerHTML = `
      <h1>Matches</h1>
      <div class="chips">${link('tab', 'live', 'Live', tab)}${link('tab', 'upcoming', 'Upcoming', tab)}${link('tab', 'recent', 'Recent', tab)}</div>
      <div class="chips">${link('format', '', 'All formats', fmt)}${link('format', 'T20', 'T20', fmt)}${link('format', 'ODI', 'ODI', fmt)}${link('format', 'TEST', 'Test', fmt)}</div>
      <div class="grid two">${list.map(matchCard).join('') || empty('No matches found')}</div>`;
    if (tab === 'live') listen('/stream', () => rerender(), 4000);
  },

  async match([id], qs) {
    const m = await api(`/matches/${encodeURIComponent(id)}`);
    const tab = qs.get('tab') || (m.status === 'upcoming' ? 'info' : isLive(m) ? 'live' : 'scorecard');
    const tabs = [['live', isLive(m) ? 'Live' : 'Commentary'], ['scorecard', 'Scorecard'], ['squads', 'Squads'], ['info', 'Info']];
    let body = '';
    if (tab === 'live') body = await liveTab(m);
    if (tab === 'scorecard') body = await scorecardTab(m);
    if (tab === 'squads') body = await squadsTab(m);
    if (tab === 'info') body = infoTab(m);
    document.title = `${m.teams.map((t) => t.shortName + ' ' + scoreText(t)).join(' v ')} | Cric Journal`;
    $app.innerHTML = `<div class="match-page">
      <div class="hero">
        <div class="small muted" style="margin-bottom:8px;display:flex;justify-content:space-between;gap:8px">
          <a href="/series/${esc(m.series?.id)}">${esc(m.title)} · ${esc(m.series?.name)}</a>${statusBadge(m)}
        </div>
        ${teamRows(m)}
        <div class="situation">${esc(m.situation)}</div>
        ${m.live ? `<div class="rates"><span>CRR <b>${m.live.currentRunRate.toFixed(2)}</b></span>${m.live.requiredRunRate !== undefined ? `<span>RRR <b>${m.live.requiredRunRate.toFixed(2)}</b></span>` : ''}${m.live.target ? `<span>Target <b>${m.live.target}</b></span>` : ''}</div>` : ''}
      </div>
      <div class="card" style="margin-top:12px">
        <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<a role="tab" class="tab ${k === tab ? 'active' : ''}" href="/match/${esc(m.id)}?tab=${k}">${l}</a>`).join('')}</div>
        <div style="padding-top:12px" id="tab-body">${body}</div>
      </div></div>`;
    if (isLive(m) || m.status === 'upcoming') listen(`/matches/${encodeURIComponent(id)}/stream`, (u) => {
      if (u.type === 'match_end') toast('Match finished: ' + (u.data?.summary?.situation ?? ''));
      if (u.type === 'innings_end') toast('Innings break');
      rerender({ flash: true });
    }, 1200);
  },

  async series([id]) {
    if (!id) {
      const all = await api('/series');
      $app.innerHTML = `<h1>Series</h1><div class="card flush list">${all.map((s) => `
        <a href="/series/${esc(s.id)}"><div style="flex:1;min-width:0"><div style="font-weight:600">${esc(s.name)}</div>
        <div class="small muted">${esc(s.startDate)} – ${esc(s.endDate)} · ${s.matches} matches</div></div>
        ${s.live ? '<span class="badge live">Live</span>' : ''}<span class="badge fmt">${esc(s.format)}</span></a>`).join('')}</div>`;
      return;
    }
    const s = await api(`/series/${encodeURIComponent(id)}`);
    $app.innerHTML = `
      <h1>${esc(s.name)}</h1>
      <div class="small muted" style="margin:-6px 0 12px">${esc(s.startDate)} – ${esc(s.endDate)} · ${esc(s.format)}</div>
      <h2>Points table</h2>
      <div class="card flush table-wrap"><table>
        <thead><tr><th>Team</th><th>P</th><th>W</th><th>L</th><th>T/NR</th><th>Pts</th><th>NRR</th></tr></thead>
        <tbody>${s.pointsTable.map((r) => `<tr><td><a href="/team/${esc(r.teamId)}">${esc(r.team)}</a></td><td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td><td>${r.tied + r.noResult}</td><td><b>${r.points}</b></td><td>${r.netRunRate > 0 ? '+' : ''}${r.netRunRate.toFixed(2)}</td></tr>`).join('')}</tbody>
      </table></div>
      <h2>Fixtures &amp; results</h2>
      <div class="grid two">${s.matches.map(matchCard).join('')}</div>`;
  },

  async teams([id]) {
    if (!id) {
      const teams = await api('/teams');
      $app.innerHTML = `<h1>Teams</h1><div class="card flush list">${teams.map((t) => `<a href="/team/${esc(t.id)}">${avatar(t.shortName, t.color)}<b>${esc(t.name)}</b></a>`).join('')}</div>`;
      return;
    }
    const t = await api(`/teams/${encodeURIComponent(id)}`);
    $app.innerHTML = `
      <div class="hero" style="background:${esc(t.color)}"><div style="display:flex;gap:12px;align-items:center">${avatar(t.shortName, 'rgba(255,255,255,.2)')}<div><div class="big" style="font-size:22px">${esc(t.name)}</div><div class="muted small">Men's national team</div></div></div></div>
      <div class="cols" style="margin-top:4px">
        <div>
          <h2>Recent results</h2><div class="grid">${t.recentResults.map(matchCard).join('') || empty('No results yet')}</div>
          <h2>Upcoming</h2><div class="grid">${t.upcomingFixtures.map(matchCard).join('') || empty('No fixtures scheduled')}</div>
        </div>
        <aside><h2>Squad</h2><div class="card flush list">${t.squad.map((p) => `<a href="/player/${esc(p.id)}">${avatar(p.name, t.color)}<div><div style="font-weight:600">${esc(p.name)}</div><div class="small muted">${esc(p.role)}</div></div></a>`).join('')}</div></aside>
      </div>`;
  },

  async player([id]) {
    const p = await api(`/players/${encodeURIComponent(id)}`);
    const stat = (v, l) => `<div class="stat"><b>${v ?? '–'}</b><span>${l}</span></div>`;
    $app.innerHTML = `
      <div class="card" style="display:flex;gap:14px;align-items:center">${avatar(p.name)}<div><h1 style="margin:0">${esc(p.name)}</h1><div class="muted"><a href="/team/${esc(p.teamId)}">${esc(p.team)}</a> · ${esc(p.role)}</div></div></div>
      <div class="card" style="margin-top:12px"><dl class="kv">
        <dt>Born</dt><dd>${esc(new Date(p.born).toLocaleDateString(undefined, { dateStyle: 'long' }))}</dd>
        <dt>Batting</dt><dd>${esc(p.battingStyle)}</dd><dt>Bowling</dt><dd>${esc(p.bowlingStyle ?? '–')}</dd>
      </dl></div>
      ${p.stats.map((s) => `
        <h2>${esc(s.format === 'TEST' ? 'Test' : s.format)} career</h2>
        <div class="card"><div class="small muted" style="margin-bottom:6px">Batting</div><div class="stat-grid">
          ${stat(s.batting.matches, 'Mat')}${stat(s.batting.runs, 'Runs')}${stat(s.batting.highest, 'HS')}${stat(s.batting.average, 'Avg')}${stat(s.batting.strikeRate, 'SR')}${stat(s.batting.fifties + '/' + s.batting.hundreds, '50/100')}${stat(s.batting.fours, '4s')}${stat(s.batting.sixes, '6s')}
        </div>
        ${s.bowling.balls ? `<div class="small muted" style="margin:12px 0 6px">Bowling</div><div class="stat-grid">${stat(s.bowling.wickets, 'Wkts')}${stat(s.bowling.average, 'Avg')}${stat(s.bowling.economy, 'Econ')}${stat(s.bowling.best, 'Best')}${stat(Math.floor(s.bowling.balls / 6) + '.' + (s.bowling.balls % 6), 'Overs')}</div>` : ''}
        </div>`).join('') || empty('No matches played yet')}`;
  },

  async rankings(_, qs) {
    const format = qs.get('format') || 'T20', category = qs.get('category') || 'teams';
    const r = await api(`/rankings?format=${format}&category=${category}`);
    const chip = (k, v, l, cur) => `<a class="chip ${v === cur ? 'active' : ''}" href="/rankings?${new URLSearchParams({ format, category, [k]: v })}">${l}</a>`;
    $app.innerHTML = `
      <h1>Rankings</h1>
      <div class="chips">${chip('format', 'T20', 'T20', format)}${chip('format', 'ODI', 'ODI', format)}${chip('format', 'TEST', 'Test', format)}</div>
      <div class="chips">${chip('category', 'teams', 'Teams', category)}${chip('category', 'batting', 'Batting', category)}${chip('category', 'bowling', 'Bowling', category)}</div>
      <div class="card flush table-wrap"><table><thead><tr><th>#</th><th style="text-align:left">${category === 'teams' ? 'Team' : 'Player'}</th><th>Rating</th></tr></thead><tbody>
      ${r.entries.map((e) => `<tr><td>${e.rank}</td><td style="text-align:left">${e.teamId ? `<a href="/team/${esc(e.teamId)}">${esc(e.name)}</a>` : `<a href="/player/${esc(e.playerId)}">${esc(e.name)}</a> <span class="muted small">${esc(e.team)}</span>`}</td><td><b>${e.rating}</b></td></tr>`).join('')}
      </tbody></table></div>`;
  },

  async news([id]) {
    if (!id) {
      const list = await api('/news?limit=50');
      $app.innerHTML = `<h1>News</h1><div class="grid two">${list.map(newsCard).join('')}</div>`;
      return;
    }
    const n = await api(`/news/${encodeURIComponent(id)}`);
    $app.innerHTML = `<article class="card"><div class="small muted">${esc(fmtDate(n.publishedAt))}</div><h1>${esc(n.title)}</h1>
      <p style="font-weight:600">${esc(n.summary)}</p><p>${esc(n.body)}</p>
      ${n.matchId ? `<a class="chip active" href="/match/${esc(n.matchId)}?tab=scorecard">View scorecard</a>` : ''}
      <div class="chips" style="margin-top:12px">${n.tags.map((t) => `<span class="badge">${esc(t)}</span>`).join('')}</div></article>`;
  },

  async search(_, qs) {
    const q = qs.get('q') || '';
    document.getElementById('search-input').value = q;
    const r = await api(`/search?q=${encodeURIComponent(q)}`);
    const sec = (title, items) => items ? `<h2>${title}</h2>${items}` : '';
    $app.innerHTML = `<h1>Results for “${esc(q)}”</h1>
      ${sec('Teams', r.teams.length && `<div class="card flush list">${r.teams.map((t) => `<a href="/team/${esc(t.id)}">${avatar(t.shortName, t.color)}${esc(t.name)}</a>`).join('')}</div>`)}
      ${sec('Players', r.players.length && `<div class="card flush list">${r.players.map((p) => `<a href="/player/${esc(p.id)}">${avatar(p.name)}<div>${esc(p.name)}<div class="small muted">${esc(p.team)} · ${esc(p.role)}</div></div></a>`).join('')}</div>`)}
      ${sec('Series', r.series.length && `<div class="card flush list">${r.series.map((s) => `<a href="/series/${esc(s.id)}">${esc(s.name)}</a>`).join('')}</div>`)}
      ${sec('Matches', r.matches.length && `<div class="grid two">${r.matches.map(matchCard).join('')}</div>`)}
      ${!r.teams.length && !r.players.length && !r.series.length && !r.matches.length ? empty('Nothing found') : ''}`;
  },
};

// ---------- Match tabs ----------
async function liveTab(m) {
  const comm = await api(`/matches/${encodeURIComponent(m.id)}/commentary?limit=60`);
  const L = m.live;
  const crease = L ? `
    <div class="table-wrap" style="margin:0 -14px"><table>
      <thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
      <tbody>${L.batters.map((b) => `<tr class="${b.onStrike ? 'strike' : ''}"><td><a href="/player/${esc(b.playerId)}">${esc(b.name)}</a></td><td><b>${b.runs}</b></td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${b.strikeRate.toFixed(1)}</td></tr>`).join('')}</tbody>
      ${L.bowler ? `<thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
      <tbody><tr><td><a href="/player/${esc(L.bowler.playerId)}">${esc(L.bowler.name)}</a></td><td>${L.bowler.overs}</td><td>${L.bowler.maidens}</td><td>${L.bowler.runs}</td><td><b>${L.bowler.wickets}</b></td><td>${L.bowler.economy.toFixed(2)}</td></tr></tbody>` : ''}
    </table></div>
    <div class="small muted" style="margin:10px 0">Partnership <b>${L.partnership.runs}(${L.partnership.balls})</b>${L.lastWicket ? ` · Last wkt: ${esc(L.lastWicket)}` : ''}</div>
    <div class="balls" style="margin-bottom:14px"><span class="small muted">Recent:</span>${L.recentOvers.map((o) => `<span class="over-sep">Ov ${o.over}</span>${ballsHtml(o.balls)}`).join('')}</div>` : '';
  const items = comm.items.map((c, i) => {
    const sym = c.event === 'wicket' ? 'W' : c.event === 'four' ? '4' : c.event === 'six' ? '6' : c.event === 'ball' ? String(c.runs) : c.event === 'wide' ? 'wd' : c.event === 'noball' ? 'nb' : c.event === 'legbye' ? 'lb' : 'b';
    return `<li class="${c.event === 'wicket' ? 'wicket' : ''} ${i === 0 && rerender.flash ? 'flash' : ''}"><div class="ov">${esc(c.over)}<span class="ball ${ballClass(sym)}">${esc(sym)}</span></div><div class="txt">${esc(c.text)}</div></li>`;
  }).join('');
  return `${crease}<ul class="comm">${items || '<li class="empty">Commentary will appear once the match starts.</li>'}</ul>`;
}

async function scorecardTab(m) {
  const sc = await api(`/matches/${encodeURIComponent(m.id)}/scorecard`);
  if (!sc.innings.length) return empty('Scorecard will be available once the match starts.');
  return `<div style="margin:0 -14px">` + sc.innings.map((inn) => `
    <div class="inn-head"><span>${esc(inn.battingTeam.name)} · ${inn.number > 2 ? '2nd' : '1st'} inns</span><span>${inn.totals.runs}/${inn.totals.wickets} (${inn.totals.overs})</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
      <tbody>${inn.batting.map((b) => `<tr class="${b.onStrike ? 'strike' : ''}"><td><a href="/player/${esc(b.playerId)}">${esc(b.name)}</a><span class="dis">${esc(b.dismissal)}</span></td><td><b>${b.runs}</b></td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${b.strikeRate.toFixed(1)}</td></tr>`).join('')}</tbody>
    </table></div>
    <div class="extras"><span>Extras</span><span><b>${inn.totals.extras.total}</b> <span class="muted small">(b ${inn.totals.extras.byes}, lb ${inn.totals.extras.legbyes}, w ${inn.totals.extras.wides}, nb ${inn.totals.extras.noballs})</span></span></div>
    <div class="extras"><span>Total</span><span><b>${inn.totals.runs}/${inn.totals.wickets}</b> <span class="muted small">(${inn.totals.overs} ov, RR ${inn.totals.runRate.toFixed(2)})</span></span></div>
    ${inn.yetToBat.length ? `<div class="fow"><b>Yet to bat:</b> ${inn.yetToBat.map((p) => esc(p.name)).join(', ')}</div>` : ''}
    <div class="table-wrap"><table>
      <thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>NB</th><th>WD</th><th>Econ</th></tr></thead>
      <tbody>${inn.bowling.map((b) => `<tr><td><a href="/player/${esc(b.playerId)}">${esc(b.name)}</a></td><td>${b.overs}</td><td>${b.maidens}</td><td>${b.runs}</td><td><b>${b.wickets}</b></td><td>${b.noballs}</td><td>${b.wides}</td><td>${b.economy.toFixed(2)}</td></tr>`).join('')}</tbody>
    </table></div>
    ${inn.fallOfWickets.length ? `<div class="fow"><b>Fall of wickets:</b> ${inn.fallOfWickets.map((f) => `${f.score}-${f.wicket} (${esc(f.name)}, ${f.over})`).join(', ')}</div>` : ''}
  `).join('') + `</div>`;
}

async function squadsTab(m) {
  const sq = await api(`/matches/${encodeURIComponent(m.id)}/squads`);
  return `<div class="grid two">${sq.map((s) => `<div><h2 style="margin-top:0">${esc(s.team.name)}</h2><div class="list" style="margin:0 -14px">${s.playingXI.map((p) => `<a href="/player/${esc(p.id)}">${avatar(p.name, s.team.color)}<div>${esc(p.name)}<div class="small muted">${esc(p.role)}</div></div></a>`).join('')}</div></div>`).join('')}</div>`;
}

function infoTab(m) {
  return `<dl class="kv">
    <dt>Match</dt><dd>${esc(m.title)}, ${esc(m.series?.name)}</dd>
    <dt>Format</dt><dd>${esc(m.format)}${m.oversPerInnings ? ` (${m.oversPerInnings} overs)` : ''}</dd>
    <dt>Date</dt><dd>${esc(fmtDate(m.startTime))}</dd>
    <dt>Venue</dt><dd>${esc(m.venue)}</dd>
    ${m.toss ? `<dt>Toss</dt><dd>${esc(m.toss)}</dd>` : ''}
    ${m.result ? `<dt>Result</dt><dd>${esc(m.result)}</dd>` : ''}
    ${m.playerOfMatch ? `<dt>Player of match</dt><dd><a href="/player/${esc(m.playerOfMatch.id)}" style="color:var(--brand);font-weight:600">${esc(m.playerOfMatch.name)}</a></dd>` : ''}
  </dl>`;
}

// ---------- Router ----------
const routes = [
  [/^\/$/, 'home', 'home'], [/^\/matches$/, 'matches', 'matches'], [/^\/match\/([^/]+)$/, 'match', 'matches'],
  [/^\/series(?:\/([^/]+))?$/, 'series', 'series'], [/^\/teams$/, 'teams', 'teams'], [/^\/team\/([^/]+)$/, 'teams', 'teams'],
  [/^\/player\/([^/]+)$/, 'player', 'teams'], [/^\/rankings$/, 'rankings', 'rankings'], [/^\/news(?:\/([^/]+))?$/, 'news', 'news'],
  [/^\/search$/, 'search', ''],
];

let renderToken = 0;
async function render({ keepScroll = false, flash = false } = {}) {
  const token = ++renderToken;
  closeStreams();
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const qs = new URLSearchParams(location.search);
  const route = routes.find(([re]) => re.test(path));
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', !!route && a.dataset.nav === route[2]));
  if (!keepScroll) { document.title = 'Cric Journal – Live Cricket Scores'; window.scrollTo(0, 0); }
  const y = window.scrollY;
  rerender.flash = flash;
  try {
    if (!route) throw Object.assign(new Error('Page not found'), { status: 404 });
    const args = path.match(route[0]).slice(1).filter(Boolean);
    await views[route[1]](args, qs);
    if (token !== renderToken) return;
    if (keepScroll) window.scrollTo(0, y);
  } catch (e) {
    if (token !== renderToken) return;
    $app.innerHTML = `<div class="card empty"><h1>${e.status === 404 ? 'Not found' : 'Something went wrong'}</h1><p>${esc(e.message)}</p><a class="chip active" href="/">Go home</a></div>`;
  }
  refreshStrip();
}
function rerender(opts = {}) { return render({ keepScroll: true, ...opts }); }

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || a.origin !== location.origin || a.pathname.startsWith('/api') || a.pathname === '/docs') return;
  e.preventDefault();
  if (a.href !== location.href) history.pushState({}, '', a.href);
  render();
});
window.addEventListener('popstate', () => render());
document.getElementById('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  history.pushState({}, '', `/search?q=${encodeURIComponent(q)}`);
  document.getElementById('search-input').blur();
  render();
});

// ---------- Theme, toast, PWA ----------
const themeKey = 'cj-theme';
const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
try { applyTheme(localStorage.getItem(themeKey)); } catch {}
document.getElementById('theme-btn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem(themeKey, next); } catch {}
});
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
window.addEventListener('online', () => { toast('Back online'); rerender(); });
window.addEventListener('offline', () => toast('You are offline – showing cached data'));

render();
