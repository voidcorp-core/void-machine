// The page shell served by `void-harness ui`.
//
// Inlined as a string rather than copied as an asset: the command must work
// from an installed npm package with no build step and no network, and a page
// that fetches anything from a CDN is a page that fails on a plane.
//
// The rule the markup follows: it renders what `/api/projects` returned and
// NOTHING ELSE. No derived total, no score, no client-side recomputation. It
// also shows when the data was read, because a tab left open all afternoon is
// showing the morning's answer and must say so.
//
// Absent fields are absent, never null: `JSON.stringify` drops `undefined`
// rather than converting it, so the page checks for absence and nothing else.

export const COMMAND_CENTER_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Void projects</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #fbfbfa;
    --panel: #ffffff;
    --ink: #1a1a19;
    --muted: #6b6b66;
    --line: #e6e6e1;
    --warn: #b45309;
    --accent: #4338ca;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #131315;
      --panel: #1a1a1d;
      --ink: #ececea;
      --muted: #8d8d88;
      --line: #2a2a2e;
      --warn: #f0b429;
      --accent: #a5b4fc;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font: 14px/1.5 ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 60rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
  header { display: flex; align-items: baseline; gap: .75rem; flex-wrap: wrap; }
  h1 { font-size: 1.05rem; font-weight: 650; margin: 0; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: .8rem; }
  .sub code { font-size: .78rem; }
  .bar {
    margin: 1.5rem 0 .5rem;
    display: flex; justify-content: space-between; align-items: baseline;
    border-bottom: 1px solid var(--line); padding-bottom: .5rem;
  }
  .bar h2 { font-size: .74rem; font-weight: 600; text-transform: uppercase;
            letter-spacing: .07em; color: var(--muted); margin: 0; }
  .card {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: .6rem; padding: .85rem 1rem; margin-top: .6rem;
  }
  .card.flag { border-left: 3px solid var(--warn); }
  .row { display: flex; align-items: baseline; gap: .6rem; flex-wrap: wrap; }
  .name { font-weight: 600; }
  .branch {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: .78rem; color: var(--muted);
    max-width: 22rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .when { margin-left: auto; font-size: .78rem; color: var(--muted); }
  .facts { margin-top: .4rem; font-size: .8rem; color: var(--muted); }
  .facts b { font-weight: 600; color: var(--ink); }
  .att { margin-top: .5rem; font-size: .82rem; color: var(--warn); }
  .drift { margin-top: .3rem; font-size: .78rem; color: var(--muted); }
  .resume { margin-top: .5rem; font-size: .82rem; }
  .resume span { color: var(--muted); }
  .path { margin-top: .45rem; font-family: ui-monospace, monospace;
          font-size: .72rem; color: var(--muted); }
  .empty { margin-top: 2rem; color: var(--muted); }
  .empty code { background: var(--panel); padding: .1rem .3rem; border-radius: .2rem; }
  .err { color: var(--warn); margin-top: 2rem; }
  ul { margin: .3rem 0 0; padding-left: 1.1rem; }
  li { font-size: .8rem; color: var(--muted); }
</style>
</head>
<body>
<main>
  <header>
    <h1>Void projects</h1>
    <span class="sub" id="meta"></span><span class="sub" id="stale"></span>
  </header>
  <div id="out"><p class="sub" style="margin-top:2rem">reading…</p></div>
</main>
<script>
const out = document.getElementById('out');
const meta = document.getElementById('meta');

const esc = (value) => String(value === undefined ? '' : value).replace(/[&<>"]/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

function when(project) {
  if (project.idleDays === undefined) return 'no git history';
  if (project.commitsToday > 0) return project.commitsToday + ' commits today';
  if (project.idleDays === 0) return 'active today';
  return 'idle ' + project.idleDays + 'd';
}

function facts(project) {
  const parts = [];
  const decisions = project.decisions;
  if (decisions !== undefined && decisions.count > 0) {
    const legacy = decisions.format === 'live-monolith' ? ' <i>(legacy format)</i>' : '';
    parts.push('<b>' + decisions.count + '</b> decisions' + legacy);
  } else {
    parts.push('no decisions recorded');
  }
  if (project.planCount > 0) parts.push('<b>' + project.planCount + '</b> plans');
  if (project.program !== undefined) {
    parts.push('program <b>' + esc(project.program.program) + '</b> ('
      + project.program.unitCount + ' units)');
  }
  return parts.join(' &middot; ');
}

function card(project) {
  const attention = project.attention === undefined ? [] : project.attention;
  const bits = [];
  bits.push('<div class="card' + (attention.length > 0 ? ' flag' : '') + '">');
  bits.push('<div class="row"><span class="name">' + esc(project.name) + '</span>');
  bits.push('<span class="branch">'
    + esc(project.branch === undefined ? 'detached' : project.branch) + '</span>');
  bits.push('<span class="when">' + esc(when(project)) + '</span></div>');
  bits.push('<div class="facts">' + facts(project) + '</div>');

  if (project.resumeLine !== undefined) {
    bits.push('<div class="resume"><span>stopped at</span> ' + esc(project.resumeLine) + '</div>');
  }
  for (const item of attention) {
    bits.push('<div class="att">&rarr; ' + esc(item.detail) + '</div>');
  }
  for (const item of (project.conformance === undefined ? [] : project.conformance)) {
    bits.push('<div class="drift">&middot; ' + esc(item.detail) + '</div>');
  }
  const recent = project.decisions === undefined || project.decisions.recent === undefined
    ? []
    : project.decisions.recent;
  if (recent.length > 0) {
    bits.push('<ul>' + recent.slice(0, 3).map((decision) =>
      '<li>' + (decision.date === undefined ? '' : esc(decision.date) + ' &mdash; ')
      + esc(decision.title) + '</li>').join('') + '</ul>');
  }
  bits.push('<div class="path">' + esc(project.path) + '</div>');
  bits.push('</div>');
  return bits.join('');
}

function readClock(iso) {
  // LOCAL time, not the ISO slice: the payload is UTC, and a header that showed
  // 16:42 while the wall clock said 18:42 is a timestamp nobody can use.
  if (iso === undefined) return 'unknown';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? 'unknown' : at.toLocaleTimeString();
}

function render(data) {
  const projects = data.projects === undefined ? [] : data.projects;
  // The read time is shown because a tab left open is showing an old answer.
  meta.innerHTML = 'roots <code>'
    + esc((data.roots === undefined ? [] : data.roots).join(', ')) + '</code> &middot; '
    + esc(data.rootsSource) + ' &middot; read at ' + esc(readClock(data.readAt));
  // Clear any previous failure note: this answer is fresh.
  const note = document.getElementById('stale');
  if (note !== null) note.textContent = '';

  if (projects.length === 0) {
    out.innerHTML = '<p class="empty">No project found. A project is any directory carrying '
      + '<code>.void/config.json</code>.</p>';
    return;
  }

  const flagged = projects.filter((project) =>
    project.attention !== undefined && project.attention.length > 0);
  const quiet = projects.filter((project) =>
    project.attention === undefined || project.attention.length === 0);
  const html = [];

  if (flagged.length > 0) {
    html.push('<div class="bar"><h2>Needs attention</h2><span class="sub">'
      + flagged.length + ' of ' + projects.length + '</span></div>');
    html.push(flagged.map(card).join(''));
  }
  if (quiet.length > 0) {
    html.push('<div class="bar"><h2>Quiet</h2><span class="sub">' + quiet.length + '</span></div>');
    html.push(quiet.map(card).join(''));
  }
  for (const item of (data.unreadable === undefined ? [] : data.unreadable)) {
    html.push('<div class="drift">? ' + esc(item.path) + ': ' + esc(item.reason) + '</div>');
  }
  out.innerHTML = html.join('');
}

// Refreshing is the point of the page, not a nicety: the whole use case is
// coming back to the tab after working in several projects and seeing where
// things stand NOW, not at launch. The server already reads per request, so
// staleness lived entirely in this fetch happening once.
//
// Two triggers, and one deliberate silence. Coming back to the tab refreshes
// immediately, because that is the exact moment the answer is consulted. A
// steady interval keeps a tab on a second screen honest. A HIDDEN tab polls
// nothing: reading eight projects spawns git processes in each, and doing that
// for a tab nobody is looking at is pure waste.
const REFRESH_MS = 10000;
let inFlight = false;
let timer = undefined;
let loaded = false;

function refresh() {
  // Guard against stacking: a slow read must not queue more reads behind it.
  if (inFlight || document.hidden) return;
  inFlight = true;
  fetch('/api/projects')
    .then((response) => response.ok ? response.json() : Promise.reject(new Error(response.status)))
    .then((data) => {
      loaded = true;
      render(data);
    })
    .catch((error) => {
      // A failed refresh keeps the last good answer on screen. Blanking a view
      // that was correct a moment ago is worse than showing it slightly old,
      // as long as the page says so.
      if (loaded) {
        const note = document.getElementById('stale');
        if (note !== null) note.textContent = ' · refresh failed, showing last read';
      } else {
        out.innerHTML = '<p class="err">Could not read the projects: ' + esc(error.message) + '</p>';
      }
    })
    .then(() => { inFlight = false; });
}

function schedule() {
  if (timer !== undefined) clearInterval(timer);
  timer = document.hidden ? undefined : setInterval(refresh, REFRESH_MS);
}

document.addEventListener('visibilitychange', () => {
  schedule();
  refresh();
});
window.addEventListener('focus', refresh);

schedule();
refresh();
</script>
</body>
</html>
`;
