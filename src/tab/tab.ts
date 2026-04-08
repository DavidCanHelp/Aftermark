import type { Bookmark, Cluster, ContentType, Session } from "../models/types";
import type { BookmarkStats, ImportResult } from "../capture/import";
import {
  exportAllAsCSV,
  exportClusterAsMarkdown,
  exportClusterAsHTML,
  exportComparisonTable,
  downloadFile,
} from "../export/export";

// ── State ──

let allBookmarks: Bookmark[] = [];
let allClusters: Cluster[] = [];
let allSessions: Session[] = [];
let currentView = "dashboard";
let bookmarkSearchQuery = "";
let bookmarkTypeFilter = "";

// ── Messaging ──

function send<T>(message: Record<string, unknown>): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

// ── DOM helpers ──

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}
function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtMonth(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// ── Navigation ──

const navItems = document.querySelectorAll(".nav-item");
navItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    const view = (btn as HTMLElement).dataset.view!;
    switchView(view);
  });
});

function switchView(view: string) {
  currentView = view;
  navItems.forEach((n) => n.classList.toggle("active", (n as HTMLElement).dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  renderCurrentView();
}

function renderCurrentView() {
  switch (currentView) {
    case "dashboard": renderDashboard(); break;
    case "bookmarks": renderBookmarks(); break;
    case "clusters": renderClusters(); break;
    case "sessions": renderSessions(); break;
    case "review": renderReview(); break;
    case "timeline": renderTimeline(); break;
  }
}

// ── Dashboard ──

function renderDashboard() {
  const el = $("view-dashboard");
  const bm = allBookmarks;
  const dupes = bm.filter((b) => b.status === "duplicate").length;
  const dead = bm.filter((b) => b.status === "dead").length;
  const now = Date.now();
  const sixMonths = 180 * 24 * 60 * 60 * 1000;
  const oneYear = 365 * 24 * 60 * 60 * 1000;
  const stale = bm.filter((b) => b.status === "active" && (now - b.dateAdded > sixMonths) && (!b.dateLastUsed || b.dateLastUsed === b.dateAdded)).length;

  // Domain counts
  const domainCounts = new Map<string, number>();
  for (const b of bm) {
    if (b.domain) domainCounts.set(b.domain, (domainCounts.get(b.domain) || 0) + 1);
  }
  const topDomains = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxDomainCount = topDomains.length > 0 ? topDomains[0][1] : 1;

  // Content type counts
  const typeCounts = new Map<ContentType, number>();
  for (const b of bm) {
    typeCounts.set(b.contentType, (typeCounts.get(b.contentType) || 0) + 1);
  }
  const typesSorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
  const maxTypeCount = typesSorted.length > 0 ? typesSorted[0][1] : 1;

  // Monthly counts
  const monthlyCounts = new Map<string, number>();
  for (const b of bm) {
    const key = fmtMonth(b.dateAdded);
    monthlyCounts.set(key, (monthlyCounts.get(key) || 0) + 1);
  }
  const months = [...monthlyCounts.entries()];
  const maxMonth = months.length > 0 ? Math.max(...months.map((m) => m[1])) : 1;

  // Oldest/newest
  const dates = bm.map((b) => b.dateAdded).filter((d) => d > 0);
  const oldest = dates.length > 0 ? Math.min(...dates) : 0;
  const newest = dates.length > 0 ? Math.max(...dates) : 0;

  // Rates
  const daySpan = oldest > 0 ? Math.max(1, (newest - oldest) / (24 * 60 * 60 * 1000)) : 1;
  const perDay = (bm.length / daySpan).toFixed(1);
  const perWeek = (bm.length / (daySpan / 7)).toFixed(1);
  const perMonth = (bm.length / (daySpan / 30)).toFixed(1);

  const typeColors: Record<string, string> = {
    "github-repo": "var(--green)", docs: "var(--blue)", article: "var(--purple)",
    video: "var(--orange)", shopping: "var(--red)", travel: "var(--cyan)",
    academic: "#dce775", social: "var(--pink)", forum: "var(--teal)",
    tool: "#b0bec5", reference: "#9fa8da", unknown: "#555",
  };

  el.innerHTML = `
    <h2>Dashboard</h2>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${bm.length}</div><div class="stat-label">Total bookmarks</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--yellow)">${dupes}</div><div class="stat-label">Duplicates</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--red)">${dead}</div><div class="stat-label">Dead links</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--orange)">${stale}</div><div class="stat-label">Stale (&gt;6mo)</div></div>
      <div class="stat-card"><div class="stat-value">${allClusters.length}</div><div class="stat-label">Clusters</div></div>
      <div class="stat-card"><div class="stat-value">${allSessions.length}</div><div class="stat-label">Sessions</div></div>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value" style="font-size:15px">${oldest ? fmtDate(oldest) : "—"}</div><div class="stat-label">Oldest bookmark</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:15px">${newest ? fmtDate(newest) : "—"}</div><div class="stat-label">Newest bookmark</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:15px">${perDay}/d · ${perWeek}/w · ${perMonth}/mo</div><div class="stat-label">Bookmark rate</div></div>
    </div>

    <h3>Top 10 Domains</h3>
    <div class="bar-chart">
      ${topDomains.map(([d, c]) => `
        <div class="bar-row">
          <span class="bar-label">${esc(d)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(c / maxDomainCount * 100).toFixed(1)}%;background:var(--accent)"></div></div>
          <span class="bar-count">${c}</span>
        </div>`).join("")}
    </div>

    <h3>Content Types</h3>
    <div class="bar-chart">
      ${typesSorted.map(([t, c]) => `
        <div class="bar-row">
          <span class="bar-label">${esc(t)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(c / maxTypeCount * 100).toFixed(1)}%;background:${typeColors[t] || "var(--accent)"}"></div></div>
          <span class="bar-count">${c}</span>
        </div>`).join("")}
    </div>

    <h3>Bookmarks per Month</h3>
    <div class="bar-chart">
      ${months.slice(-12).map(([m, c]) => `
        <div class="bar-row">
          <span class="bar-label">${esc(m)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(c / maxMonth * 100).toFixed(1)}%;background:var(--accent)"></div></div>
          <span class="bar-count">${c}</span>
        </div>`).join("")}
    </div>

    <div class="export-row">
      <button class="filter-btn" id="export-csv">Export All as CSV</button>
    </div>
  `;

  $("export-csv").addEventListener("click", () => {
    downloadFile(exportAllAsCSV(allBookmarks), "aftermark-bookmarks.csv", "text/csv");
  });
}

// ── All Bookmarks ──

function filterBM(): Bookmark[] {
  let list = allBookmarks;
  if (bookmarkTypeFilter) {
    list = list.filter((b) => b.contentType === bookmarkTypeFilter);
  }
  if (bookmarkSearchQuery) {
    const terms = bookmarkSearchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter((b) => {
      const h = `${b.title} ${b.url} ${b.domain} ${b.contentType} ${b.tags.join(" ")} ${b.status}`.toLowerCase();
      return terms.every((t) => h.includes(t));
    });
  }
  return list;
}

function renderBookmarks() {
  const el = $("view-bookmarks");
  const types = [...new Set(allBookmarks.map((b) => b.contentType))].sort();
  const filtered = filterBM();

  el.innerHTML = `
    <h2>All Bookmarks</h2>
    <input class="search-bar" id="bm-search" type="text" placeholder="Search title, URL, domain, tags, content type…" value="${esc(bookmarkSearchQuery)}">
    <div class="filter-row">
      <button class="filter-btn ${bookmarkTypeFilter === "" ? "active" : ""}" data-type="">All</button>
      ${types.map((t) => `<button class="filter-btn ${bookmarkTypeFilter === t ? "active" : ""}" data-type="${t}">${t}</button>`).join("")}
    </div>
    <div class="results-count">${filtered.length} bookmarks</div>
    <div class="bm-table" id="bm-table"></div>
  `;

  renderBookmarkTable(filtered.slice(0, 300), $("bm-table"));

  if (filtered.length > 300) {
    const more = document.createElement("div");
    more.className = "empty-state";
    more.textContent = `${filtered.length - 300} more — refine your search`;
    $("bm-table").appendChild(more);
  }

  $("bm-search").addEventListener("input", (e) => {
    bookmarkSearchQuery = (e.target as HTMLInputElement).value;
    const f = filterBM();
    const table = $("bm-table");
    table.innerHTML = "";
    renderBookmarkTable(f.slice(0, 300), table);
    el.querySelector(".results-count")!.textContent = `${f.length} bookmarks`;
  });

  el.querySelectorAll(".filter-btn[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => {
      bookmarkTypeFilter = (btn as HTMLElement).dataset.type!;
      renderBookmarks();
    });
  });
}

function renderBookmarkTable(bookmarks: Bookmark[], container: HTMLElement) {
  const html = bookmarks.map((bm) => {
    const badges: string[] = [];
    const ct = bm.contentType || "unknown";
    badges.push(`<span class="badge badge-ct-${ct}">${esc(ct)}</span>`);
    if (bm.status === "dead") badges.push('<span class="badge badge-dead">dead</span>');
    if (bm.status === "duplicate") badges.push('<span class="badge badge-duplicate">duplicate</span>');
    return `<div class="bm-row" data-url="${esc(bm.url)}">
      <span class="bm-title">${esc(bm.title || bm.url)}</span>
      <span class="bm-domain">${esc(bm.domain)}</span>
      <span class="bm-badges">${badges.join("")}</span>
      <span class="bm-date">${fmtDate(bm.dateAdded)}</span>
    </div>`;
  }).join("");
  container.innerHTML = html;
  container.addEventListener("click", (e) => {
    const row = (e.target as HTMLElement).closest(".bm-row") as HTMLElement | null;
    if (row?.dataset.url) chrome.tabs.create({ url: row.dataset.url });
  });
}

// ── Clusters ──

function renderClusters() {
  const el = $("view-clusters");
  const byType = new Map<string, Cluster[]>();
  for (const c of allClusters) {
    const list = byType.get(c.type);
    if (list) list.push(c);
    else byType.set(c.type, [c]);
  }

  const sections = [...byType.entries()].map(([type, clusters]) => {
    const sorted = clusters.sort((a, b) => b.bookmarkIds.length - a.bookmarkIds.length);
    return `
      <h3>${esc(type)} <span style="color:var(--text-dim);font-weight:normal;font-size:12px">${clusters.length} clusters</span></h3>
      <div class="cluster-grid">
        ${sorted.map((c) => `
          <div class="cluster-card" data-cluster-id="${esc(c.id)}">
            <div class="cc-name">${esc(c.name)}</div>
            <div class="cc-meta">${c.bookmarkIds.length} bookmarks<span class="cc-type">${esc(c.type)}</span></div>
          </div>
        `).join("")}
      </div>`;
  }).join("");

  el.innerHTML = `<h2>Clusters</h2>${sections || '<div class="empty-state">No clusters yet. Reimport to build.</div>'}`;

  el.querySelectorAll(".cluster-card").forEach((card) => {
    card.addEventListener("click", () => {
      const cid = (card as HTMLElement).dataset.clusterId!;
      showClusterDetail(cid);
    });
  });
}

function showClusterDetail(clusterId: string) {
  const cluster = allClusters.find((c) => c.id === clusterId);
  if (!cluster) return;
  const bms = cluster.bookmarkIds.map((id) => allBookmarks.find((b) => b.id === id)).filter(Boolean) as Bookmark[];
  const el = $("view-clusters");

  el.innerHTML = `
    <h2>${esc(cluster.name)}</h2>
    <div style="margin-bottom:12px;font-size:13px;color:var(--text-muted)">${cluster.type} · ${bms.length} bookmarks</div>
    <div class="export-row">
      <button class="filter-btn" id="cl-export-md">Export Markdown</button>
      <button class="filter-btn" id="cl-export-html">Export HTML Bookmarks</button>
      ${cluster.type === "decision" ? '<button class="filter-btn" id="cl-export-compare">Export Comparison</button>' : ""}
      <button class="filter-btn" id="cl-back">Back to Clusters</button>
    </div>
    <div class="bm-table" id="cl-table"></div>
  `;

  renderBookmarkTable(bms, $("cl-table"));

  $("cl-export-md").addEventListener("click", () => {
    downloadFile(exportClusterAsMarkdown(cluster, bms), `${cluster.name.replace(/[^a-z0-9]/gi, "_")}.md`, "text/markdown");
  });
  $("cl-export-html").addEventListener("click", () => {
    downloadFile(exportClusterAsHTML(cluster, bms), `${cluster.name.replace(/[^a-z0-9]/gi, "_")}.html`, "text/html");
  });
  const compareBtn = document.getElementById("cl-export-compare");
  if (compareBtn) {
    compareBtn.addEventListener("click", () => {
      downloadFile(exportComparisonTable(cluster, bms), `${cluster.name.replace(/[^a-z0-9]/gi, "_")}_comparison.md`, "text/markdown");
    });
  }
  $("cl-back").addEventListener("click", () => renderClusters());
}

// ── Sessions ──

function renderSessions() {
  const el = $("view-sessions");
  const sorted = [...allSessions].sort((a, b) => b.startTime - a.startTime);

  el.innerHTML = `
    <h2>Sessions</h2>
    <div style="margin-bottom:16px;font-size:13px;color:var(--text-muted)">${sorted.length} browsing sessions reconstructed from bookmark timestamps</div>
    <div id="sessions-list">
      ${sorted.map((s) => `
        <div class="session-card" data-session-id="${esc(s.id)}">
          <div class="sc-header">
            <span class="sc-domain">${esc(s.dominantDomain || "mixed")}</span>
            <span class="sc-count">${s.bookmarkCount} bookmarks</span>
          </div>
          <div class="sc-time">${fmtDate(s.startTime)}${s.startTime !== s.endTime ? ` — ${new Date(s.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}</div>
          <div class="sc-bookmarks" id="sb-${esc(s.id)}"></div>
        </div>
      `).join("")}
    </div>
  `;

  el.querySelectorAll(".session-card").forEach((card) => {
    card.addEventListener("click", () => {
      const wasExpanded = card.classList.contains("expanded");
      card.classList.toggle("expanded");
      if (!wasExpanded) {
        const sid = (card as HTMLElement).dataset.sessionId!;
        const session = allSessions.find((s) => s.id === sid);
        if (!session) return;
        const container = document.getElementById(`sb-${sid}`);
        if (container && container.children.length === 0) {
          const bms = session.bookmarkIds.map((id) => allBookmarks.find((b) => b.id === id)).filter(Boolean) as Bookmark[];
          renderBookmarkTable(bms, container);
        }
      }
    });
  });
}

// ── Review ──

function renderReview() {
  const el = $("view-review");
  const now = Date.now();
  const sixMonths = 180 * 24 * 60 * 60 * 1000;
  const oneYear = 365 * 24 * 60 * 60 * 1000;

  const stale = allBookmarks.filter((b) => b.status === "active" && (now - b.dateAdded > sixMonths) && (!b.dateLastUsed || b.dateLastUsed === b.dateAdded));
  const forgotten = allBookmarks.filter((b) => b.status === "active" && (now - b.dateAdded > oneYear) && (!b.dateLastUsed || b.dateLastUsed === b.dateAdded));
  const dupes = allBookmarks.filter((b) => b.status === "duplicate");
  const dead = allBookmarks.filter((b) => b.status === "dead");

  // Group dupes by canonical
  const dupeGroups = new Map<string, Bookmark[]>();
  for (const d of dupes) {
    const key = d.canonicalId || d.normalizedUrl;
    const list = dupeGroups.get(key);
    if (list) list.push(d);
    else dupeGroups.set(key, [d]);
  }

  el.innerHTML = `
    <h2>Review</h2>
    <div class="review-group">
      <h3>Stale Bookmarks <span class="review-count">${stale.length} older than 6 months, never revisited</span></h3>
      ${renderReviewItems(stale.slice(0, 50), "exclude")}
      ${stale.length > 50 ? `<div class="empty-state">${stale.length - 50} more</div>` : ""}
    </div>
    <div class="review-group">
      <h3>Forgotten <span class="review-count">${forgotten.length} older than 1 year</span></h3>
      ${renderReviewItems(forgotten.slice(0, 50), "exclude")}
      ${forgotten.length > 50 ? `<div class="empty-state">${forgotten.length - 50} more</div>` : ""}
    </div>
    <div class="review-group">
      <h3>Dead Links <span class="review-count">${dead.length} unreachable</span></h3>
      ${renderReviewItems(dead.slice(0, 50), "remove")}
      ${dead.length > 50 ? `<div class="empty-state">${dead.length - 50} more</div>` : ""}
    </div>
    <div class="review-group">
      <h3>Duplicates <span class="review-count">${dupes.length} duplicates in ${dupeGroups.size} groups</span></h3>
      ${renderDupeGroups(dupeGroups)}
    </div>
  `;

  // Wire up buttons
  el.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const action = (btn as HTMLElement).dataset.action!;
      const bmId = (btn as HTMLElement).dataset.bmId!;
      if (action === "exclude" || action === "remove") {
        await send({ type: "updateBookmarkStatus", bookmarkId: bmId, status: "excluded" });
        (btn as HTMLElement).closest(".review-item")?.remove();
      } else if (action === "recheck") {
        (btn as HTMLElement).textContent = "…";
        // Just re-activate so it gets rechecked next scan
        await send({ type: "updateBookmarkStatus", bookmarkId: bmId, status: "active" });
        (btn as HTMLElement).closest(".review-item")?.remove();
      } else if (action === "keep") {
        // Mark all others in this group as excluded
        const group = (btn as HTMLElement).dataset.group!;
        const groupItems = Array.from(el.querySelectorAll(`[data-dupe-group="${group}"]`));
        for (const item of groupItems) {
          const id = (item as HTMLElement).dataset.bmId!;
          if (id !== bmId) {
            await send({ type: "updateBookmarkStatus", bookmarkId: id, status: "excluded" });
          }
        }
        // Refresh
        await loadData();
        renderReview();
      }
    });
  });
}

function renderReviewItems(bookmarks: Bookmark[], actionType: string): string {
  return bookmarks.map((bm) => `
    <div class="review-item">
      <span class="ri-title" title="${esc(bm.url)}">${esc(bm.title || bm.url)}</span>
      <span class="ri-domain">${esc(bm.domain)}</span>
      <span style="font-size:11px;color:var(--text-dim)">${fmtDate(bm.dateAdded)}</span>
      ${actionType === "remove" ? `
        <button data-action="recheck" data-bm-id="${esc(bm.id)}">Recheck</button>
        <button data-action="remove" data-bm-id="${esc(bm.id)}">Remove</button>
      ` : `
        <button data-action="exclude" data-bm-id="${esc(bm.id)}">Exclude</button>
      `}
    </div>
  `).join("");
}

function renderDupeGroups(groups: Map<string, Bookmark[]>): string {
  const entries = [...groups.entries()].slice(0, 30);
  return entries.map(([key, dupes]) => {
    const canonical = allBookmarks.find((b) => b.id === key) || dupes[0];
    const all = [canonical, ...dupes].filter((b, i, arr) => arr.findIndex((x) => x.id === b.id) === i);
    return `
      <div style="margin-bottom:12px;padding:8px 12px;background:var(--bg-surface);border-radius:6px">
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px">${all.length} copies · ${esc(canonical.normalizedUrl || canonical.url)}</div>
        ${all.map((bm) => `
          <div class="review-item" data-dupe-group="${esc(key)}" data-bm-id="${esc(bm.id)}">
            <span class="ri-title">${esc(bm.title || bm.url)}</span>
            <span class="ri-domain">${esc(bm.folderPath || bm.domain)}</span>
            <span style="font-size:11px;color:var(--text-dim)">${fmtDate(bm.dateAdded)}</span>
            <button data-action="keep" data-bm-id="${esc(bm.id)}" data-group="${esc(key)}">Keep this</button>
          </div>
        `).join("")}
      </div>`;
  }).join("") + (groups.size > 30 ? `<div class="empty-state">${groups.size - 30} more groups</div>` : "");
}

// ── Timeline ──

function renderTimeline() {
  const el = $("view-timeline");
  // Group by month
  const months = new Map<string, Bookmark[]>();
  for (const bm of allBookmarks) {
    const key = fmtMonth(bm.dateAdded);
    const list = months.get(key);
    if (list) list.push(bm);
    else months.set(key, [bm]);
  }

  // Sort chronologically (newest first)
  const sorted = [...months.entries()].sort((a, b) => {
    const da = a[1][0]?.dateAdded || 0;
    const db = b[1][0]?.dateAdded || 0;
    return db - da;
  });
  const maxCount = sorted.length > 0 ? Math.max(...sorted.map(([, bms]) => bms.length)) : 1;

  el.innerHTML = `
    <h2>Timeline</h2>
    <div style="margin-bottom:16px;font-size:13px;color:var(--text-muted)">${sorted.length} months of bookmarking</div>
    ${sorted.map(([month, bms]) => `
      <div class="timeline-month" data-month="${esc(month)}">
        <div class="timeline-header">
          <span class="tl-label">${esc(month)}</span>
          <div class="tl-bar-track">
            <div class="tl-bar-fill" style="width:${(bms.length / maxCount * 100).toFixed(1)}%"></div>
          </div>
          <span class="tl-count">${bms.length}</span>
        </div>
        <div class="timeline-items" id="tl-items-${esc(month.replace(/\s+/g, "_"))}"></div>
      </div>
    `).join("")}
  `;

  el.querySelectorAll(".timeline-header").forEach((header) => {
    header.addEventListener("click", () => {
      const monthEl = header.closest(".timeline-month")!;
      const wasExpanded = monthEl.classList.contains("expanded");
      monthEl.classList.toggle("expanded");
      if (!wasExpanded) {
        const month = (monthEl as HTMLElement).dataset.month!;
        const bms = months.get(month) || [];
        const container = monthEl.querySelector(".timeline-items") as HTMLElement;
        if (container && container.children.length === 0) {
          renderBookmarkTable(bms.sort((a, b) => b.dateAdded - a.dateAdded), container);
        }
      }
    });
  });
}

// ── Data loading ──

async function loadData() {
  const [bmRes, clRes, ssRes] = await Promise.all([
    send<{ bookmarks: Bookmark[] }>({ type: "getAllBookmarks" }),
    send<{ clusters: Cluster[] }>({ type: "getClusters" }),
    send<{ sessions: Session[] }>({ type: "getSessions" }),
  ]);
  allBookmarks = bmRes.bookmarks;
  allClusters = clRes.clusters;
  allSessions = ssRes.sessions;

  // Update nav counts
  $("nav-count-bm").textContent = String(allBookmarks.length);
  $("nav-count-cl").textContent = String(allClusters.length);
  $("nav-count-ss").textContent = String(allSessions.length);
}

// ── Sidebar actions ──

$("btn-reimport").addEventListener("click", async () => {
  const btn = $("btn-reimport") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Importing…";
  await send<ImportResult>({ type: "reimportBookmarks" });
  await loadData();
  btn.disabled = false;
  btn.textContent = "Reimport Bookmarks";
  renderCurrentView();
});

$("btn-settings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// ── Init ──

async function init() {
  await loadData();
  renderCurrentView();
}

init();
