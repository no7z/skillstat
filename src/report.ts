import { Analysis, daysAgo } from "./stats.js";
import { fmtTokens } from "./tokens.js";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Self-contained, offline HTML report — double-click to open, no server.
 * Styled after the "AI tool observability" menu-bar aesthetic (dark, mono).
 */
export function renderHtml(a: Analysis, zombieDays: number): string {
  const now = a.now;
  const active = a.skills.filter((s) => s.triggers > 0);
  const zombies = a.skills.filter((s) => {
    if (s.triggers === 0) return s.installed || a.offeredNames.has(s.name);
    const d = daysAgo(s.lastTriggered, now);
    return d !== null && d >= zombieDays;
  });
  const wasted = zombies.filter((s) => s.installed).length;
  const perSession = a.avgListingTokens;

  const row = (s: (typeof a.skills)[number]) => {
    const d = daysAgo(s.lastTriggered, now);
    const last = d === null ? "never" : d === 0 ? "today" : `${d}d`;
    const cls = s.triggers === 0 ? "zero" : d !== null && d >= zombieDays ? "stale" : "ok";
    return `<tr class="${cls}">
      <td class="name">${esc(s.name)}</td>
      <td class="num">${s.triggers}</td>
      <td class="num dim">${s.explicit}/${s.auto}</td>
      <td class="last">${last}</td>
      <td class="src">${esc(s.source)}</td>
      <td class="proj">${esc(s.projects.join(", "))}</td>
      <td class="desc">${esc(s.description).slice(0, 120)}</td>
    </tr>`;
  };

  const rows = a.skills.map(row).join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>skillstat report</title>
<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--fg:#e6edf3;--dim:#7d8590;
        --ok:#3fb950;--warn:#d29922;--bad:#f85149;--acc:#58a6ff;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
       font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:32px}
  h1{font-size:20px;margin:0 0 4px}
  .sub{color:var(--dim);margin-bottom:24px;font-size:12px}
  .cards{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:28px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:10px;
        padding:16px 20px;min-width:150px}
  .card .k{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
  .card .v{font-size:26px;font-weight:600;margin-top:6px}
  .card.bad .v{color:var(--bad)} .card.warn .v{color:var(--warn)} .card.ok .v{color:var(--ok)}
  table{width:100%;border-collapse:collapse;background:var(--panel);
        border:1px solid var(--line);border-radius:10px;overflow:hidden}
  th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);font-size:13px}
  th{color:var(--dim);font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.04em}
  td.num,td.last{text-align:right;font-variant-numeric:tabular-nums}
  tr.zero td.name{color:var(--bad)} tr.zero td.last{color:var(--bad)}
  tr.stale td.last{color:var(--warn)}
  tr.ok td.last{color:var(--ok)}
  td.dim,.desc{color:var(--dim)}
  td.desc{max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .foot{color:var(--dim);font-size:11px;margin-top:20px}
  input{background:var(--panel);border:1px solid var(--line);color:var(--fg);
        padding:7px 12px;border-radius:8px;width:260px;margin-bottom:14px;font:inherit}
</style></head>
<body>
  <h1>skillstat</h1>
  <div class="sub">generated ${new Date(now).toISOString().replace("T", " ").slice(0, 16)}
    · ${a.sessionCount} sessions · zombie threshold ${zombieDays}d</div>
  <div class="cards">
    <div class="card"><div class="k">Installed / offered</div><div class="v">${a.installed.length}</div></div>
    <div class="card ok"><div class="k">Active skills</div><div class="v">${active.length}</div></div>
    <div class="card bad"><div class="k">Zombie skills</div><div class="v">${zombies.length}</div></div>
    <div class="card warn"><div class="k">Ctx / session (est.)</div><div class="v">${fmtTokens(perSession)}</div></div>
    <div class="card"><div class="k">Total triggers</div><div class="v">${a.totalTriggers}</div></div>
  </div>
  <input id="q" placeholder="filter skills…" oninput="filter()">
  <table id="t"><thead><tr>
    <th>Skill</th><th class="num">Fires</th><th class="num">exp/auto</th>
    <th class="last">Last</th><th>Source</th><th>Projects</th><th>Description</th>
  </tr></thead><tbody>
${rows}
  </tbody></table>
  <div class="foot">Token figures are heuristic estimates (no tokenizer, offline). exp/auto =
    explicit /skill invocations vs auto-activations. "${wasted}" installed zombie skills are
    candidates for <code>skillstat slim</code>.</div>
<script>
function filter(){var q=document.getElementById('q').value.toLowerCase();
  document.querySelectorAll('#t tbody tr').forEach(function(r){
    r.style.display=r.textContent.toLowerCase().indexOf(q)>-1?'':'none';});}
</script>
</body></html>`;
}
