/* ============================================================
   Pods Win Tracker — Dallas  (display only — no calculations)
   Reads data/dallas.json (a faithful mirror of the "Dallas" tab,
   published by the Apps Script) and renders it.
   ============================================================ */
(() => {
  "use strict";

  const DATA_URL = "data/austin.json";
  // Optional per-pod brand accents. Add "Pod Name": "#hex" to colorize a card.
  const BRAND = {
    // "DOMINATE.": "#e23b3b",
    // "KILOWATT KINGS": "#f5b301",
  };

  // Pod logos (keyed by exact pod name from the data). Pods without an entry
  // fall back to a monogram. Add new pods here as their logos arrive.
  const POD_LOGOS = {
    // Austin pod logos go here as they arrive, e.g.:
    //   "POD NAME": "assets/pods/pod-name.png",
    // Until then, pods show a monogram automatically.
  };
  // Normalize pod names so logo lookup tolerates case/spacing differences from the sheet.
  const normName = (s) => String(s).toUpperCase().replace(/\s+/g, " ").trim();
  const POD_LOGOS_N = Object.keys(POD_LOGOS).reduce((m, k) => ((m[normName(k)] = POD_LOGOS[k]), m), {});
  const monogram = (name) =>
    name.replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  function podLogo(name) {
    const src = POD_LOGOS_N[normName(name)];
    return src
      ? `<img class="pod-logo" src="${src}" alt="" loading="lazy" />`
      : `<span class="pod-logo pod-logo--mono">${esc(monogram(name))}</span>`;
  }

  const $ = (id) => document.getElementById(id);
  const state = { data: null, week: null, pod: "__all__", rep: "" };

  // ---------- helpers ----------
  const num = (v) => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);

  // Today's date (YYYY-MM-DD) in the dashboard's timezone (Dallas / Central).
  function todayInTZ(tz) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(new Date());
      return parts; // en-CA yields YYYY-MM-DD
    } catch { return new Date().toISOString().slice(0, 10); }
  }

  function relTime(iso) {
    if (!iso) return "—";
    const then = new Date(iso), now = new Date();
    const mins = Math.round((now - then) / 60000);
    if (isNaN(mins)) return "—";
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs > 1 ? "s" : ""} ago`;
    const days = Math.round(hrs / 24);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  }

  function clockText(data) {
    if (!data.generatedAt) return "—";
    let abs = "";
    try {
      abs = new Intl.DateTimeFormat("en-US", {
        timeZone: data.timezone || "America/Chicago",
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      }).format(new Date(data.generatedAt)) + " CT";
    } catch { abs = ""; }
    return `${relTime(data.generatedAt)}${abs ? " · " + abs : ""}`;
  }

  // Weeks that have actually started (Monday <= today in TZ). This is the
  // Monday-midnight unlock rule: a week is viewable once its Monday arrives.
  function availableWeeks(data) {
    const today = todayInTZ(data.timezone || "America/Chicago");
    return (data.weeks || []).filter((w) => w.start <= today);
  }

  const podWeeklyValue = (pod, weekNo) => num(pod.weekly && pod.weekly[String(weekNo)]);
  const podHitWeek = (pod, weekNo) => podWeeklyValue(pod, weekNo) >= num(pod.target) && num(pod.target) > 0;

  function weeksHit(pod, throughWeek) {
    let n = 0;
    for (let w = 1; w <= throughWeek; w++) if (podHitWeek(pod, w)) n++;
    return n;
  }

  // ---------- render ----------
  function render() {
    const d = state.data;
    $("refreshClock").textContent = clockText(d);
    $("footNote").textContent = `Pods Win Tracker — Austin · ${(d.pods || []).length} pods`;
    $("demoBanner").hidden = !d.demo;

    renderControls();
    renderLeaderboard();
    renderSummary();
    renderPods();
  }

  // Cumulative SRA for a pod across played weeks (sum of its weekly results).
  function podQuarterSRA(pod, throughWeek) {
    let s = 0;
    for (let w = 1; w <= throughWeek; w++) s += podWeeklyValue(pod, w);
    return s;
  }

  // ---------- leaderboard (ranks ALL pods, ignores pod/rep filters) ----------
  function renderLeaderboard() {
    const d = state.data, pods = d.pods || [], wk = state.week, cur = d.currentWeekNo;
    if (!pods.length) { $("leaderboard").innerHTML = ""; return; }

    const top = (arr, valFn, fmt) => arr
      .map((p) => ({ name: p.name, v: valFn(p) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map((x) => ({ name: x.name, label: fmt(x.v) }));

    const weekSRA   = top(pods, (p) => podWeeklyValue(p, wk), (v) => `${round(v)} SRA`);
    const weekWin   = pods
      .map((p) => ({ name: p.name, margin: podWeeklyValue(p, wk) - num(p.target), won: podHitWeek(p, wk), val: podWeeklyValue(p, wk) }))
      .filter((x) => x.won)
      .sort((a, b) => b.margin - a.margin)
      .slice(0, 3)
      .map((x) => ({ name: x.name, label: `${round(x.val)} / ${round(x.val - x.margin)}` }));
    const qtrWins   = top(pods, (p) => weeksHit(p, cur), (v) => `${v} win${v > 1 ? "s" : ""}`);
    const qtrSRA    = top(pods, (p) => podQuarterSRA(p, cur), (v) => `${round(v)} SRA`);

    $("leaderboard").innerHTML =
      podium(`Week ${wk} · Top SRA`, "ti-bolt", weekSRA) +
      podium(`Week ${wk} · Winning`, "ti-trophy", weekWin) +
      podium("Quarter · Most Wins", "ti-award", qtrWins) +
      podium("Quarter · Top SRA", "ti-chart-bar", qtrSRA);
  }

  function podium(title, _icon, rows) {
    const medals = ["1", "2", "3"];
    const body = rows.length
      ? rows.map((r, i) =>
          `<li class="lb-row">
             <span class="lb-rank r${i + 1}">${medals[i]}</span>
             <span class="lb-name" title="${esc(r.name)}">${esc(r.name)}</span>
             <span class="lb-val">${esc(r.label)}</span>
           </li>`).join("")
      : `<li class="lb-empty">No pods yet</li>`;
    return `<div class="lb-card"><div class="lb-title">${esc(title)}</div><ol class="lb-list">${body}</ol></div>`;
  }

  function renderControls() {
    const d = state.data;
    const weeks = availableWeeks(d);
    // Week select
    const ws = $("weekSelect");
    ws.innerHTML = "";
    weeks.forEach((w) => {
      const o = document.createElement("option");
      o.value = String(w.weekNo);
      o.textContent = w.label || `Week ${w.weekNo}`;
      ws.appendChild(o);
    });
    if (!weeks.some((w) => w.weekNo === state.week)) {
      state.week = weeks.length ? weeks[weeks.length - 1].weekNo : 1; // default: current
    }
    ws.value = String(state.week);
    const wObj = weeks.find((w) => w.weekNo === state.week);
    $("weekRange").textContent = wObj ? `${fmtDate(wObj.start)} – ${fmtDate(wObj.end)}` : "";
    $("weekPrev").disabled = !weeks.length || state.week <= weeks[0].weekNo;
    $("weekNext").disabled = !weeks.length || state.week >= weeks[weeks.length - 1].weekNo;

    // Pod select
    const ps = $("podSelect");
    if (ps.options.length <= 1) {
      (d.pods || []).forEach((p) => {
        const o = document.createElement("option");
        o.value = p.name; o.textContent = p.name; ps.appendChild(o);
      });
    }
    ps.value = state.pod;

    // Rep datalist
    const dl = $("repList");
    if (!dl.childElementCount) {
      const reps = new Set();
      (d.pods || []).forEach((p) => (p.reps || []).forEach((r) => reps.add(r.name)));
      [...reps].sort().forEach((n) => {
        const o = document.createElement("option"); o.value = n; dl.appendChild(o);
      });
    }
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, dd] = iso.split("-");
    return `${Number(m)}/${Number(dd)}`;
  }

  function visiblePods() {
    const d = state.data;
    let pods = d.pods || [];
    if (state.pod !== "__all__") pods = pods.filter((p) => p.name === state.pod);
    if (state.rep.trim()) {
      const q = state.rep.trim().toLowerCase();
      pods = pods
        .map((p) => ({ ...p, reps: (p.reps || []).filter((r) => r.name.toLowerCase().includes(q)) }))
        .filter((p) => p.reps.length);
    }
    return pods;
  }

  function renderSummary() {
    const d = state.data;
    const pods = d.pods || [];
    const wk = state.week;
    const hitThisWeek = pods.filter((p) => podHitWeek(p, wk)).length;
    const totalWins = pods.reduce((s, p) => s + weeksHit(p, d.currentWeekNo), 0);
    const totalSRA = pods.reduce((s, p) => s + podWeeklyValue(p, wk), 0);
    const reps = pods.reduce((s, p) => s + (p.reps ? p.reps.length : 0), 0);

    $("summary").innerHTML = `
      ${stat(`${hitThisWeek}/${pods.length}`, `Pods hit target · Week ${wk}`, "win")}
      ${stat(round(totalSRA), `Total ${d.metricLabel || "SRA"} · Week ${wk}`, "accent")}
      ${stat(totalWins, "Pod-weeks won this quarter", "")}
      ${stat(reps, "Reps tracked", "")}
    `;
  }
  const round = (n) => (Number.isInteger(n) ? n : Math.round(n * 10) / 10);
  function stat(num, lbl, cls) {
    return `<div class="stat"><div class="num ${cls}">${num}</div><div class="lbl">${lbl}</div></div>`;
  }

  function renderPods() {
    const d = state.data;
    const grid = $("podGrid");
    const pods = visiblePods().slice().sort((a, b) => podWeeklyValue(b, state.week) - podWeeklyValue(a, state.week));
    if (!pods.length) {
      grid.innerHTML = `<div class="empty">No pods or reps match your filter.</div>`;
      return;
    }
    grid.innerHTML = pods.map((p) => podCard(p, d)).join("");
    // wire rep toggles
    grid.querySelectorAll(".rep-toggle").forEach((btn) => {
      btn.addEventListener("click", () => {
        const open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!open));
        const tbl = btn.nextElementSibling;
        if (tbl) tbl.hidden = open;
      });
    });
  }

  function podCard(p, d) {
    const wk = state.week;
    const val = podWeeklyValue(p, wk);
    const tgt = num(p.target);
    const hit = podHitWeek(p, wk);
    const pct = tgt > 0 ? Math.min(100, Math.round((val / tgt) * 100)) : 0;
    const hits = weeksHit(p, d.currentWeekNo);
    const accent = BRAND[p.name];
    const styleAccent = accent ? ` style="--pod-accent:${accent}"` : "";

    // weeks-hit dots
    let dots = "";
    for (let w = 1; w <= d.currentWeekNo; w++) {
      const cls = (podHitWeek(p, w) ? " hit" : "") + (w === wk ? " cur" : "");
      dots += `<span class="dot${cls}" title="Week ${w}">${w}</span>`;
    }

    const autoOpen = state.rep.trim() ? "true" : "false";
    return `
      <article class="pod-card"${styleAccent}>
        <div class="pod-head">
          <div class="pod-id">
            ${podLogo(p.name)}
            <div>
              <h3 class="pod-name">${esc(p.name)}</h3>
              <div class="pod-sub">${(p.reps || []).length} reps · target ${tgt} ${d.metricLabel || "SRA"}/wk</div>
            </div>
          </div>
         ${hit ? `<span class="badge win">● Win</span>` : ""}
        </div>

        <div class="progress-wrap">
          <div class="progress-top">
            <div class="progress-val">${round(val)} <span class="tgt">/ ${tgt}</span></div>
            <div class="progress-pct">${pct}% of target</div>
          </div>
          <div class="track"><div class="fill ${hit ? "win" : ""}" style="width:${pct}%"></div></div>
        </div>

        <div class="weeks-hit">
          <span class="wh-label">Weeks hit ${hits}/${d.currentWeekNo}</span>
          ${dots}
        </div>

        <button class="rep-toggle" aria-expanded="${autoOpen}">
         <span class="chev">▸</span> Rep SRAs · Week ${wk}
        </button>
        ${repTable(p, d, autoOpen === "false")}
      </article>`;
  }

    // SRA for a rep in ONE specific week (per-week, not cumulative).
  function repWeekSRA(r, wk) {
    return num(r.weekly && r.weekly[String(wk)]);
  }

  function repTable(p, d, hidden) {
    const q = state.rep.trim().toLowerCase();
    const wk = state.week;
    const reps = (p.reps || []).slice().sort((a, b) => repWeekSRA(b, wk) - repWeekSRA(a, wk));
    const rows = reps.map((r) => {
      const hl = q && r.name.toLowerCase().includes(q) ? " highlight" : "";
      const sra = repWeekSRA(r, wk);
      return `<tr class="${hl}">
        <td class="name">${esc(r.name)}</td>
        <td class="sra ${sra >= 1 ? "pos" : "zero"}">${sra}</td>
      </tr>`;
    }).join("");
    return `<table class="rep-table"${hidden ? " hidden" : ""}>
      <thead><tr><th>Rep</th><th>SRA</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- events ----------
  function wire() {
    $("weekSelect").addEventListener("change", (e) => { state.week = Number(e.target.value); render(); });
    $("weekPrev").addEventListener("click", () => { step(-1); });
    $("weekNext").addEventListener("click", () => { step(1); });
    $("podSelect").addEventListener("change", (e) => { state.pod = e.target.value; render(); });
    $("repSearch").addEventListener("input", (e) => { state.rep = e.target.value; render(); });
  }
  function step(dir) {
    const weeks = availableWeeks(state.data);
    const idx = weeks.findIndex((w) => w.weekNo === state.week);
    const next = weeks[idx + dir];
    if (next) { state.week = next.weekNo; render(); }
  }

  // ---------- boot ----------
  async function boot() {
    try {
      const res = await fetch(DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.data = await res.json();
    } catch (err) {
      document.getElementById("podGrid").innerHTML =
        `<div class="empty">Couldn't load data (${esc(err.message)}).<br>Once the Apps Script publishes <code>data/austin.json</code>, this will populate.</div>`;
      console.error("Load failed:", err);
      return;
    }
    wire();
    render();
    // keep the "last refreshed" clock live
    setInterval(() => { $("refreshClock").textContent = clockText(state.data); }, 30000);
  }
  boot();
})();
