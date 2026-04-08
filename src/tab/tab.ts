import type { Bookmark, Cluster, ContentType, Session, SavedFilter } from "../models/types";
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
let savedFilters: SavedFilter[] = [];
let currentView = "dashboard";
let bookmarkSearchQuery = "";
let bookmarkTypeFilter = "";
let bookmarkSort = "date-newest";
let selectedIds = new Set<string>();
let activeClusterId = "";

// ── Messaging ──

function send<T>(message: Record<string, unknown>): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

// ── DOM helpers ──

function $(id: string): HTMLElement { return document.getElementById(id)!; }
function esc(s: string): string { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function fmtDate(ts: number): string { return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function fmtMonth(ts: number): string { return new Date(ts).toLocaleDateString("en-US", { month: "long", year: "numeric" }); }
function bmById(id: string): Bookmark | undefined { return allBookmarks.find((b) => b.id === id); }

function healthDot(score: number | undefined): string {
  const s = score ?? 50;
  const cls = s > 70 ? "health-green" : s > 40 ? "health-yellow" : "health-red";
  return `<span class="health-dot ${cls}" title="Health: ${s}"></span>`;
}

function favicon(domain: string): string {
  if (!domain) return "";
  return `<img class="bm-favicon" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=16" alt="" loading="lazy">`;
}

const typeColors: Record<string, string> = {
  "github-repo": "var(--green)", docs: "var(--blue)", article: "var(--purple)",
  video: "var(--orange)", shopping: "var(--red)", travel: "var(--cyan)",
  academic: "#dce775", social: "var(--pink)", forum: "var(--teal)",
  tool: "#b0bec5", reference: "#9fa8da", news: "#ef9a9a",
  "real-estate": "#a5d6a7", events: "#ffcc80", package: "#90caf9",
  music: "#ce93d8", unknown: "#555",
};

// ── Modal ──

const modalOverlay = $("modal-overlay");
const modalContent = $("modal-content");
function showModal(html: string) { modalContent.innerHTML = html; modalOverlay.classList.add("visible"); }
function hideModal() { modalOverlay.classList.remove("visible"); modalContent.innerHTML = ""; }
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) hideModal(); });

// ── Navigation ──

const navItems = document.querySelectorAll(".nav-item");
navItems.forEach((btn) => btn.addEventListener("click", () => switchView((btn as HTMLElement).dataset.view!)));

function switchView(view: string) {
  currentView = view;
  selectedIds.clear();
  navItems.forEach((n) => n.classList.toggle("active", (n as HTMLElement).dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));
  renderCurrentView();
}

function renderCurrentView() {
  const handlers: Record<string, () => void> = {
    dashboard: renderDashboard, bookmarks: renderBookmarks, clusters: renderClusters,
    sessions: renderSessions, review: renderReview, timeline: renderTimeline, insights: renderInsights,
  };
  (handlers[currentView] || renderDashboard)();
}

// ── Sorting ──

function sortBookmarks(list: Bookmark[]): Bookmark[] {
  const sorted = [...list];
  switch (bookmarkSort) {
    case "date-newest": sorted.sort((a, b) => b.dateAdded - a.dateAdded); break;
    case "date-oldest": sorted.sort((a, b) => a.dateAdded - b.dateAdded); break;
    case "domain-az": sorted.sort((a, b) => a.domain.localeCompare(b.domain)); break;
    case "health-best": sorted.sort((a, b) => (b.healthScore ?? 50) - (a.healthScore ?? 50)); break;
    case "health-worst": sorted.sort((a, b) => (a.healthScore ?? 50) - (b.healthScore ?? 50)); break;
    case "title-az": sorted.sort((a, b) => a.title.localeCompare(b.title)); break;
  }
  return sorted;
}

// ── Bulk toolbar ──

function updateBulkToolbar() {
  const actions = document.querySelector(".bulk-actions");
  if (!actions) return;
  const count = selectedIds.size;
  actions.classList.toggle("visible", count > 0);
  const countEl = document.querySelector(".bulk-count");
  if (countEl) countEl.textContent = count > 0 ? `${count} selected` : "Select items";
  const delBtn = document.getElementById("bulk-delete");
  if (delBtn) delBtn.textContent = `Delete Selected (${count})`;
  const exclBtn = document.getElementById("bulk-exclude");
  if (exclBtn) exclBtn.textContent = `Mark Excluded (${count})`;
  const removeBtn = document.getElementById("bulk-remove-cluster");
  if (removeBtn) removeBtn.textContent = `Remove from Cluster (${count})`;
  const selectAll = document.getElementById("select-all") as HTMLInputElement | null;
  if (selectAll) {
    const allChecks = document.querySelectorAll<HTMLInputElement>(".bm-row-check");
    selectAll.checked = allChecks.length > 0 && count === allChecks.length;
    selectAll.indeterminate = count > 0 && count < allChecks.length;
  }
}

function clearSelection() {
  selectedIds.clear();
  document.querySelectorAll<HTMLInputElement>(".bm-row-check").forEach((cb) => cb.checked = false);
  updateBulkToolbar();
}

function removeRowAndUpdateStats(bmId: string) {
  allBookmarks = allBookmarks.filter((b) => b.id !== bmId);
  selectedIds.delete(bmId);
  for (const c of allClusters) c.bookmarkIds = c.bookmarkIds.filter((id) => id !== bmId);
  const row = document.querySelector(`.bm-row[data-bm-id="${bmId}"]`);
  if (row) row.remove();
  $("nav-count-bm").textContent = String(allBookmarks.length);
  const rc = document.querySelector(".results-count");
  if (rc) rc.textContent = `${filterBM().length} bookmarks`;
  updateBulkToolbar();
}

function pruneClustersFromState(prunedIds: string[]) {
  if (!prunedIds?.length) return;
  allClusters = allClusters.filter((c) => !prunedIds.includes(c.id));
  $("nav-count-cl").textContent = String(allClusters.length);
  for (const id of prunedIds) document.querySelector(`.cluster-card[data-cluster-id="${id}"]`)?.remove();
}

function wireSelectAll() {
  const sa = document.getElementById("select-all") as HTMLInputElement | null;
  if (!sa) return;
  sa.addEventListener("change", () => {
    const checked = sa.checked;
    document.querySelectorAll<HTMLInputElement>(".bm-row-check").forEach((cb) => {
      cb.checked = checked;
      if (checked) selectedIds.add(cb.dataset.id!); else selectedIds.delete(cb.dataset.id!);
    });
    updateBulkToolbar();
  });
}

// ── Dashboard ──

function renderDashboard() {
  const el = $("view-dashboard");
  const bm = allBookmarks;
  const dupes = bm.filter((b) => b.status === "duplicate" || b.status === "likely-duplicate").length;
  const dead = bm.filter((b) => b.status === "dead").length;
  const now = Date.now();
  const sixMonths = 180 * 24 * 60 * 60 * 1000;
  const stale = bm.filter((b) => b.status === "active" && (now - b.dateAdded > sixMonths) && (!b.dateLastUsed || b.dateLastUsed === b.dateAdded)).length;
  const avgHealth = bm.length > 0 ? Math.round(bm.reduce((s, b) => s + (b.healthScore ?? 50), 0) / bm.length) : 0;

  const domainCounts = new Map<string, number>();
  for (const b of bm) if (b.domain) domainCounts.set(b.domain, (domainCounts.get(b.domain) || 0) + 1);
  const topDomains = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxDC = topDomains[0]?.[1] || 1;

  const typeCounts = new Map<ContentType, number>();
  for (const b of bm) typeCounts.set(b.contentType, (typeCounts.get(b.contentType) || 0) + 1);
  const typesSorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
  const maxTC = typesSorted[0]?.[1] || 1;

  const monthlyCounts = new Map<string, number>();
  for (const b of bm) { const k = fmtMonth(b.dateAdded); monthlyCounts.set(k, (monthlyCounts.get(k) || 0) + 1); }
  const months = [...monthlyCounts.entries()];
  const maxMC = months.length > 0 ? Math.max(...months.map((m) => m[1])) : 1;

  const dates = bm.map((b) => b.dateAdded).filter((d) => d > 0);
  const oldest = dates.length ? Math.min(...dates) : 0;
  const newest = dates.length ? Math.max(...dates) : 0;
  const daySpan = oldest > 0 ? Math.max(1, (newest - oldest) / 86400000) : 1;
  const hc = avgHealth > 70 ? "var(--green)" : avgHealth > 40 ? "var(--yellow)" : "var(--red)";

  el.innerHTML = `
    <h2>Dashboard</h2>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${bm.length}</div><div class="stat-label">Total bookmarks</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--yellow)">${dupes}</div><div class="stat-label">Duplicates</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--red)">${dead}</div><div class="stat-label">Dead links</div></div>
      <div class="stat-card"><div class="stat-value" style="color:var(--orange)">${stale}</div><div class="stat-label">Stale (&gt;6mo)</div></div>
      <div class="stat-card"><div class="stat-value" style="color:${hc}">${avgHealth}</div><div class="stat-label">Avg Health Score</div></div>
      <div class="stat-card"><div class="stat-value">${allClusters.length}</div><div class="stat-label">Clusters</div></div>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value" style="font-size:15px">${oldest ? fmtDate(oldest) : "—"}</div><div class="stat-label">Oldest bookmark</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:15px">${newest ? fmtDate(newest) : "—"}</div><div class="stat-label">Newest bookmark</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:15px">${(bm.length/daySpan).toFixed(1)}/d · ${(bm.length/(daySpan/7)).toFixed(1)}/w · ${(bm.length/(daySpan/30)).toFixed(1)}/mo</div><div class="stat-label">Bookmark rate</div></div>
    </div>
    <h3>Top 10 Domains</h3>
    <div class="bar-chart">${topDomains.map(([d,c])=>`<div class="bar-row"><span class="bar-label">${esc(d)}</span><div class="bar-track"><div class="bar-fill" style="width:${(c/maxDC*100).toFixed(1)}%;background:var(--accent)"></div></div><span class="bar-count">${c}</span></div>`).join("")}</div>
    <h3>Content Types</h3>
    <div class="bar-chart">${typesSorted.map(([t,c])=>`<div class="bar-row"><span class="bar-label">${esc(t)}</span><div class="bar-track"><div class="bar-fill" style="width:${(c/maxTC*100).toFixed(1)}%;background:${typeColors[t]||"var(--accent)"}"></div></div><span class="bar-count">${c}</span></div>`).join("")}</div>
    <h3>Bookmarks per Month</h3>
    <div class="bar-chart">${months.slice(-12).map(([m,c])=>`<div class="bar-row"><span class="bar-label">${esc(m)}</span><div class="bar-track"><div class="bar-fill" style="width:${(c/maxMC*100).toFixed(1)}%;background:var(--accent)"></div></div><span class="bar-count">${c}</span></div>`).join("")}</div>
    <div class="export-row"><button class="filter-btn" id="export-csv">Export All as CSV</button></div>`;
  $("export-csv").addEventListener("click", () => downloadFile(exportAllAsCSV(allBookmarks), "aftermark-bookmarks.csv", "text/csv"));
}

// ── All Bookmarks ──

function filterBM(): Bookmark[] {
  let list = allBookmarks;
  if (bookmarkTypeFilter) list = list.filter((b) => b.contentType === bookmarkTypeFilter);
  if (bookmarkSearchQuery) {
    const terms = bookmarkSearchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter((b) => {
      const h = `${b.title} ${b.url} ${b.domain} ${b.contentType} ${b.tags.join(" ")} ${b.status}`.toLowerCase();
      return terms.every((t) => h.includes(t));
    });
  }
  return sortBookmarks(list);
}

function renderBookmarks() {
  activeClusterId = "";
  selectedIds.clear();
  const el = $("view-bookmarks");
  const types = [...new Set(allBookmarks.map((b) => b.contentType))].sort();
  const filtered = filterBM();

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <h2 style="margin:0">All Bookmarks</h2>
      <button class="filter-btn" id="btn-add-bm" style="font-size:12px">+ Add Bookmark</button>
    </div>
    <input class="search-bar" id="bm-search" type="text" placeholder="Search title, URL, domain, tags, content type…" value="${esc(bookmarkSearchQuery)}">
    <div class="saved-filters" id="saved-filters"></div>
    <div class="controls-row">
      <select class="sort-select" id="bm-sort">
        <option value="date-newest" ${bookmarkSort==="date-newest"?"selected":""}>Date (Newest)</option>
        <option value="date-oldest" ${bookmarkSort==="date-oldest"?"selected":""}>Date (Oldest)</option>
        <option value="domain-az" ${bookmarkSort==="domain-az"?"selected":""}>Domain A-Z</option>
        <option value="health-best" ${bookmarkSort==="health-best"?"selected":""}>Health (Best)</option>
        <option value="health-worst" ${bookmarkSort==="health-worst"?"selected":""}>Health (Worst)</option>
        <option value="title-az" ${bookmarkSort==="title-az"?"selected":""}>Title A-Z</option>
      </select>
      <button class="filter-btn" id="btn-save-filter" style="font-size:10px">Save Filter</button>
    </div>
    <div class="filter-row">
      <button class="filter-btn ${bookmarkTypeFilter===""?"active":""}" data-type="">All</button>
      ${types.map((t) => `<button class="filter-btn ${bookmarkTypeFilter===t?"active":""}" data-type="${t}">${t}</button>`).join("")}
    </div>
    <div class="results-count">${filtered.length} bookmarks</div>
    <div class="bulk-header">
      <input type="checkbox" class="bm-check" id="select-all" title="Select all">
      <span class="bulk-count">Select items</span>
      <div class="bulk-actions">
        <button id="bulk-delete" class="danger">Delete Selected (0)</button>
        <button id="bulk-exclude">Mark Excluded (0)</button>
        <button id="bulk-export">Export Selected</button>
      </div>
    </div>
    <div class="bm-table" id="bm-table"></div>`;

  renderBookmarkRows(filtered.slice(0, 300), $("bm-table"));
  if (filtered.length > 300) $("bm-table").insertAdjacentHTML("beforeend", `<div class="empty-state">${filtered.length-300} more — refine your search</div>`);

  renderSavedFilters();

  $("bm-search").addEventListener("input", (e) => {
    bookmarkSearchQuery = (e.target as HTMLInputElement).value;
    selectedIds.clear();
    refreshBookmarkTable(el);
  });
  $("bm-sort").addEventListener("change", (e) => {
    bookmarkSort = (e.target as HTMLSelectElement).value;
    refreshBookmarkTable(el);
  });
  el.querySelectorAll(".filter-btn[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => { bookmarkTypeFilter = (btn as HTMLElement).dataset.type!; renderBookmarks(); });
  });
  $("btn-add-bm").addEventListener("click", showAddBookmarkModal);
  $("btn-save-filter").addEventListener("click", saveCurrentFilter);
  wireSelectAll();
  $("bulk-delete").addEventListener("click", () => bulkDeleteSelected());
  $("bulk-exclude").addEventListener("click", () => bulkExcludeSelected());
  $("bulk-export").addEventListener("click", () => {
    downloadFile(exportAllAsCSV([...selectedIds].map(bmById).filter(Boolean) as Bookmark[]), "aftermark-selected.csv", "text/csv");
  });
}

function refreshBookmarkTable(el: HTMLElement) {
  const f = filterBM();
  $("bm-table").innerHTML = "";
  renderBookmarkRows(f.slice(0, 300), $("bm-table"));
  el.querySelector(".results-count")!.textContent = `${f.length} bookmarks`;
  updateBulkToolbar();
}

function renderSavedFilters() {
  const el = document.getElementById("saved-filters");
  if (!el) return;
  el.innerHTML = savedFilters.map((f, i) =>
    `<span class="saved-filter-btn" data-sf-idx="${i}">${esc(f.name)} <span class="sf-remove" data-sf-del="${i}">x</span></span>`
  ).join("");
  el.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const delIdx = target.dataset.sfDel;
    if (delIdx !== undefined) {
      e.stopPropagation();
      send({ type: "deleteFilter", index: parseInt(delIdx) }).then(async () => {
        const res = await send<{ filters: SavedFilter[] }>({ type: "getSavedFilters" });
        savedFilters = res.filters;
        renderBookmarks();
      });
      return;
    }
    const idx = target.closest("[data-sf-idx]") as HTMLElement | null;
    if (idx) {
      const f = savedFilters[parseInt(idx.dataset.sfIdx!)];
      if (f) {
        bookmarkSearchQuery = f.query;
        bookmarkTypeFilter = f.contentType;
        bookmarkSort = f.sort;
        renderBookmarks();
      }
    }
  });
}

async function saveCurrentFilter() {
  const name = prompt("Filter name:");
  if (!name) return;
  const filter: SavedFilter = { name, query: bookmarkSearchQuery, contentType: bookmarkTypeFilter, sort: bookmarkSort };
  await send({ type: "saveFilter", filter });
  const res = await send<{ filters: SavedFilter[] }>({ type: "getSavedFilters" });
  savedFilters = res.filters;
  renderSavedFilters();
}

function renderBookmarkRows(bookmarks: Bookmark[], container: HTMLElement) {
  const html = bookmarks.map((bm) => {
    const ct = bm.contentType || "unknown";
    const badges = [`<span class="badge badge-ct-${ct}">${esc(ct)}</span>`];
    if (bm.status === "dead") badges.push('<span class="badge badge-dead">dead</span>');
    if (bm.status === "duplicate") badges.push('<span class="badge badge-duplicate">duplicate</span>');
    if (bm.status === "likely-duplicate") badges.push('<span class="badge badge-likely-duplicate">likely dupe</span>');
    return `<div class="bm-row" data-bm-id="${esc(bm.id)}" data-url="${esc(bm.url)}">
      <input type="checkbox" class="bm-check bm-row-check" data-id="${esc(bm.id)}" ${selectedIds.has(bm.id)?"checked":""}>
      ${healthDot(bm.healthScore)}
      ${favicon(bm.domain)}
      <span class="bm-title">${esc(bm.title || bm.url)}</span>
      <span class="bm-domain">${esc(bm.domain)}</span>
      <span class="bm-badges">${badges.join("")}</span>
      <span class="bm-date">${fmtDate(bm.dateAdded)}</span>
      <span class="row-actions">
        <button class="icon-btn" data-edit="${esc(bm.id)}" title="Edit">&#9998;</button>
        <button class="icon-btn danger" data-delete="${esc(bm.id)}" title="Delete">&#128465;</button>
      </span>
    </div>`;
  }).join("");
  container.innerHTML = html;
  wireRowActions(container);
}

function wireRowActions(container: HTMLElement) {
  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("bm-row-check")) {
      e.stopPropagation();
      const id = (target as HTMLInputElement).dataset.id!;
      if ((target as HTMLInputElement).checked) selectedIds.add(id); else selectedIds.delete(id);
      updateBulkToolbar();
      return;
    }
    const editBtn = target.closest("[data-edit]") as HTMLElement | null;
    if (editBtn) { e.stopPropagation(); showEditModal(editBtn.dataset.edit!); return; }
    const delBtn = target.closest("[data-delete]") as HTMLElement | null;
    if (delBtn) { e.stopPropagation(); showDeleteConfirm(delBtn.dataset.delete!); return; }
    const removeBtn = target.closest("[data-remove-from-cluster]") as HTMLElement | null;
    if (removeBtn) { e.stopPropagation(); removeFromCluster(removeBtn.dataset.removeFromCluster!, removeBtn.dataset.clusterId!); return; }
    const row = target.closest(".bm-row") as HTMLElement | null;
    if (row?.dataset.url) chrome.tabs.create({ url: row.dataset.url });
  });
}

// ── CRUD Modals ──

function showAddBookmarkModal() {
  showModal(`<h3>Add Bookmark</h3><label>URL (required)</label><input id="add-url" type="url" placeholder="https://…"><label>Title (optional)</label><input id="add-title" type="text" placeholder="Page title"><label>Tags (comma-separated)</label><input id="add-tags" type="text" placeholder="tag1, tag2"><div class="modal-actions"><button class="btn-cancel" id="add-cancel">Cancel</button><button class="btn-primary" id="add-save">Add</button></div>`);
  $("add-cancel").addEventListener("click", hideModal);
  $("add-save").addEventListener("click", async () => {
    const url = ($("add-url") as HTMLInputElement).value.trim();
    if (!url) return;
    const title = ($("add-title") as HTMLInputElement).value.trim() || undefined;
    const tagsStr = ($("add-tags") as HTMLInputElement).value.trim();
    const tags = tagsStr ? tagsStr.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
    await send({ type: "createBookmark", url, title, tags });
    hideModal(); await loadData(); renderBookmarks();
  });
}

function showEditModal(bmId: string) {
  const bm = bmById(bmId);
  if (!bm) return;
  showModal(`<h3>Edit Bookmark</h3><label>Title</label><input id="edit-title" type="text" value="${esc(bm.title)}"><label>Tags (comma-separated)</label><input id="edit-tags" type="text" value="${esc(bm.tags.join(", "))}"><label>Status</label><select id="edit-status"><option value="active" ${bm.status==="active"?"selected":""}>Active</option><option value="excluded" ${bm.status==="excluded"?"selected":""}>Excluded</option></select><div style="margin-top:12px;font-size:12px;color:var(--text-dim)">${esc(bm.url)}</div><div class="modal-actions"><button class="btn-cancel" id="edit-cancel">Cancel</button><button class="btn-primary" id="edit-save">Save</button></div>`);
  $("edit-cancel").addEventListener("click", hideModal);
  $("edit-save").addEventListener("click", async () => {
    const title = ($("edit-title") as HTMLInputElement).value.trim();
    const tags = ($("edit-tags") as HTMLInputElement).value.trim().split(",").map((t) => t.trim()).filter(Boolean);
    const status = ($("edit-status") as HTMLSelectElement).value;
    await send({ type: "updateBookmark", bookmarkId: bmId, title, tags, status });
    hideModal(); await loadData(); renderCurrentView();
  });
}

function showDeleteConfirm(bmId: string) {
  const bm = bmById(bmId);
  if (!bm) return;
  showModal(`<h3>Delete Bookmark?</h3><p style="color:var(--text-muted);font-size:13px;margin-bottom:8px">${esc(bm.title||bm.url)}</p><p style="color:var(--text-dim);font-size:12px">This removes it from Chrome and Aftermark.</p><div class="modal-actions"><button class="btn-cancel" id="del-cancel">Cancel</button><button class="btn-danger" id="del-confirm">Delete</button></div>`);
  $("del-cancel").addEventListener("click", hideModal);
  $("del-confirm").addEventListener("click", async () => {
    const res = await send<{ ok: boolean; prunedClusters?: string[] }>({ type: "deleteBookmark", bookmarkId: bmId });
    hideModal(); removeRowAndUpdateStats(bmId); pruneClustersFromState(res.prunedClusters || []);
    if (activeClusterId && (res.prunedClusters||[]).includes(activeClusterId)) { activeClusterId = ""; await loadData(); renderClusters(); }
  });
}

// ── Bulk actions ──

function bulkDeleteSelected() {
  const count = selectedIds.size;
  if (!count) return;
  showModal(`<h3>Delete ${count} bookmark${count>1?"s":""}?</h3><p style="color:var(--text-muted);font-size:13px">This will also remove them from Chrome. This cannot be undone.</p><div class="modal-actions"><button class="btn-cancel" id="bd-cancel">Cancel</button><button class="btn-danger" id="bd-confirm">Delete ${count} bookmarks</button></div>`);
  $("bd-cancel").addEventListener("click", hideModal);
  $("bd-confirm").addEventListener("click", async () => {
    const ids = [...selectedIds];
    const res = await send<{ ok: boolean; prunedClusters?: string[] }>({ type: "bulkDelete", bookmarkIds: ids });
    hideModal(); ids.forEach(removeRowAndUpdateStats); clearSelection();
    pruneClustersFromState(res.prunedClusters || []);
    if (activeClusterId && (res.prunedClusters||[]).includes(activeClusterId)) { activeClusterId = ""; await loadData(); renderClusters(); }
  });
}

async function bulkExcludeSelected() {
  if (!selectedIds.size) return;
  await send({ type: "bulkExclude", bookmarkIds: [...selectedIds] });
  clearSelection(); await loadData();
  if (activeClusterId) showClusterDetail(activeClusterId); else renderBookmarks();
}

async function bulkRemoveFromCluster(clusterId: string) {
  if (!selectedIds.size) return;
  let deleted = false;
  for (const id of selectedIds) {
    const r = await send<{ ok: boolean; clusterDeleted?: boolean }>({ type: "removeFromCluster", bookmarkId: id, clusterId });
    if (r.clusterDeleted) deleted = true;
  }
  clearSelection(); await loadData();
  if (deleted) { activeClusterId = ""; renderClusters(); } else showClusterDetail(clusterId);
}

// ── Clusters ──

function renderClusters() {
  const el = $("view-clusters");
  const byType = new Map<string, Cluster[]>();
  for (const c of allClusters) { const l = byType.get(c.type); if (l) l.push(c); else byType.set(c.type, [c]); }

  const sections = [...byType.entries()].map(([type, clusters]) => {
    const sorted = clusters.sort((a, b) => b.bookmarkIds.length - a.bookmarkIds.length);
    return `<h3>${esc(type)} <span style="color:var(--text-dim);font-weight:normal;font-size:12px">${clusters.length} clusters</span></h3>
      <div class="cluster-grid">${sorted.map((c) => {
        const bms = c.bookmarkIds.map(bmById).filter(Boolean) as Bookmark[];
        const tcMap = new Map<string, number>();
        for (const b of bms) tcMap.set(b.contentType, (tcMap.get(b.contentType) || 0) + 1);
        const total = bms.length || 1;
        const miniBar = [...tcMap.entries()].map(([t, n]) => `<div class="cc-minibar-seg" style="width:${(n/total*100).toFixed(1)}%;background:${typeColors[t]||"#555"}"></div>`).join("");
        return `<div class="cluster-card" data-cluster-id="${esc(c.id)}">
          <div class="cc-name">${esc(c.name)}</div>
          <div class="cc-meta">${c.bookmarkIds.length} bookmarks<span class="cc-type">${esc(c.type)}</span></div>
          <div class="cc-minibar">${miniBar}</div>
        </div>`;
      }).join("")}</div>`;
  }).join("");

  el.innerHTML = `<h2>Clusters</h2>${sections || '<div class="empty-state">No clusters yet. Reimport to build.</div>'}`;
  el.querySelectorAll(".cluster-card").forEach((card) => card.addEventListener("click", () => showClusterDetail((card as HTMLElement).dataset.clusterId!)));
}

function showClusterDetail(clusterId: string) {
  activeClusterId = clusterId; selectedIds.clear();
  const cluster = allClusters.find((c) => c.id === clusterId);
  if (!cluster) return;
  const bms = cluster.bookmarkIds.map(bmById).filter(Boolean) as Bookmark[];
  const el = $("view-clusters");
  const others = allClusters.filter((c) => c.id !== clusterId);

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
      <h2 style="margin:0">${esc(cluster.name)}</h2>
      <button class="icon-btn" id="cl-rename" title="Rename">&#9998;</button>
    </div>
    <div style="margin-bottom:12px;font-size:13px;color:var(--text-muted)">${cluster.type} · ${bms.length} bookmarks</div>
    <div class="export-row">
      <button class="filter-btn" id="cl-export-md">Export Markdown</button>
      <button class="filter-btn" id="cl-export-html">Export HTML Bookmarks</button>
      ${cluster.type==="decision"?'<button class="filter-btn" id="cl-export-compare">Export Comparison</button>':""}
      ${others.length?'<button class="filter-btn" id="cl-merge">Merge Into…</button>':""}
      <button class="filter-btn" id="cl-back">Back to Clusters</button>
    </div>
    <div class="bulk-header">
      <input type="checkbox" class="bm-check" id="select-all" title="Select all">
      <span class="bulk-count">Select items</span>
      <div class="bulk-actions">
        <button id="bulk-delete" class="danger">Delete Selected (0)</button>
        <button id="bulk-exclude">Mark Excluded (0)</button>
        <button id="bulk-remove-cluster">Remove from Cluster (0)</button>
      </div>
    </div>
    <div class="bm-table" id="cl-table"></div>`;

  renderClusterBookmarkRows(bms, $("cl-table"), clusterId);
  wireSelectAll();
  $("bulk-delete").addEventListener("click", () => bulkDeleteSelected());
  $("bulk-exclude").addEventListener("click", () => bulkExcludeSelected());
  $("bulk-remove-cluster").addEventListener("click", () => bulkRemoveFromCluster(clusterId));

  const sn = cluster.name.replace(/[^a-z0-9]/gi, "_");
  $("cl-export-md").addEventListener("click", () => downloadFile(exportClusterAsMarkdown(cluster, bms), `${sn}.md`, "text/markdown"));
  $("cl-export-html").addEventListener("click", () => downloadFile(exportClusterAsHTML(cluster, bms), `${sn}.html`, "text/html"));
  document.getElementById("cl-export-compare")?.addEventListener("click", () => downloadFile(exportComparisonTable(cluster, bms), `${sn}_comparison.md`, "text/markdown"));
  $("cl-back").addEventListener("click", () => renderClusters());

  $("cl-rename").addEventListener("click", () => {
    showModal(`<h3>Rename Cluster</h3><label>Name</label><input id="rename-input" type="text" value="${esc(cluster.name)}"><div class="modal-actions"><button class="btn-cancel" id="rename-cancel">Cancel</button><button class="btn-primary" id="rename-save">Save</button></div>`);
    $("rename-cancel").addEventListener("click", hideModal);
    $("rename-save").addEventListener("click", async () => { const n=($("rename-input") as HTMLInputElement).value.trim(); if(!n) return; await send({type:"renameCluster",clusterId,name:n}); hideModal(); await loadData(); showClusterDetail(clusterId); });
  });

  document.getElementById("cl-merge")?.addEventListener("click", () => {
    showModal(`<h3>Merge into…</h3><label>Target</label><select id="merge-target">${others.map((c)=>`<option value="${esc(c.id)}">${esc(c.name)} (${c.bookmarkIds.length})</option>`).join("")}</select><div class="modal-actions"><button class="btn-cancel" id="merge-cancel">Cancel</button><button class="btn-primary" id="merge-confirm">Merge</button></div>`);
    $("merge-cancel").addEventListener("click", hideModal);
    $("merge-confirm").addEventListener("click", async () => { await send({type:"mergeClusters",sourceId:clusterId,targetId:($("merge-target") as HTMLSelectElement).value}); hideModal(); await loadData(); renderClusters(); });
  });
}

function renderClusterBookmarkRows(bookmarks: Bookmark[], container: HTMLElement, clusterId: string) {
  const html = bookmarks.map((bm) => {
    const ct = bm.contentType || "unknown";
    const badges = [`<span class="badge badge-ct-${ct}">${esc(ct)}</span>`];
    if (bm.status === "dead") badges.push('<span class="badge badge-dead">dead</span>');
    if (bm.status === "duplicate") badges.push('<span class="badge badge-duplicate">duplicate</span>');
    if (bm.status === "likely-duplicate") badges.push('<span class="badge badge-likely-duplicate">likely dupe</span>');
    return `<div class="bm-row" data-bm-id="${esc(bm.id)}" data-url="${esc(bm.url)}">
      <input type="checkbox" class="bm-check bm-row-check" data-id="${esc(bm.id)}" ${selectedIds.has(bm.id)?"checked":""}>
      ${healthDot(bm.healthScore)}
      ${favicon(bm.domain)}
      <span class="bm-title">${esc(bm.title || bm.url)}</span>
      <span class="bm-domain">${esc(bm.domain)}</span>
      <span class="bm-badges">${badges.join("")}</span>
      <span class="bm-date">${fmtDate(bm.dateAdded)}</span>
      <span class="row-actions">
        <button class="icon-btn" data-edit="${esc(bm.id)}" title="Edit">&#9998;</button>
        <button class="icon-btn" data-remove-from-cluster="${esc(bm.id)}" data-cluster-id="${esc(clusterId)}" title="Remove from cluster">&#10005;</button>
        <button class="icon-btn danger" data-delete="${esc(bm.id)}" title="Delete">&#128465;</button>
      </span>
    </div>`;
  }).join("");
  container.innerHTML = html;
  wireRowActions(container);
}

async function removeFromCluster(bmId: string, clusterId: string) {
  const r = await send<{ ok: boolean; clusterDeleted?: boolean }>({ type: "removeFromCluster", bookmarkId: bmId, clusterId });
  await loadData();
  if (r.clusterDeleted) { activeClusterId = ""; renderClusters(); } else showClusterDetail(clusterId);
}

// ── Sessions ──

function renderSessions() {
  const el = $("view-sessions");
  const sorted = [...allSessions].sort((a, b) => b.startTime - a.startTime);
  el.innerHTML = `<h2>Sessions</h2><div style="margin-bottom:16px;font-size:13px;color:var(--text-muted)">${sorted.length} browsing sessions</div>
    <div id="sessions-list">${sorted.map((s) => `<div class="session-card" data-session-id="${esc(s.id)}">
      <div class="sc-header"><span class="sc-domain">${esc(s.dominantDomain||"mixed")}</span><span class="sc-count">${s.bookmarkCount} bookmarks</span></div>
      <div class="sc-time">${fmtDate(s.startTime)}${s.startTime!==s.endTime?` — ${new Date(s.endTime).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}`:""}
      </div><div class="sc-bookmarks" id="sb-${esc(s.id)}"></div></div>`).join("")}</div>`;

  el.querySelectorAll(".session-card").forEach((card) => {
    card.addEventListener("click", () => {
      const was = card.classList.contains("expanded");
      card.classList.toggle("expanded");
      if (!was) {
        const sid = (card as HTMLElement).dataset.sessionId!;
        const session = allSessions.find((s) => s.id === sid);
        if (!session) return;
        const c = document.getElementById(`sb-${sid}`);
        if (c && c.children.length === 0) {
          const bms = session.bookmarkIds.map(bmById).filter(Boolean) as Bookmark[];
          renderSimpleRows(bms, c);
        }
      }
    });
  });
}

function renderSimpleRows(bookmarks: Bookmark[], container: HTMLElement) {
  container.innerHTML = bookmarks.map((bm) => {
    const ct = bm.contentType || "unknown";
    return `<div class="bm-row" data-bm-id="${esc(bm.id)}" data-url="${esc(bm.url)}">
      ${healthDot(bm.healthScore)} ${favicon(bm.domain)}
      <span class="bm-title">${esc(bm.title||bm.url)}</span>
      <span class="bm-domain">${esc(bm.domain)}</span>
      <span class="bm-badges"><span class="badge badge-ct-${ct}">${esc(ct)}</span></span>
      <span class="bm-date">${fmtDate(bm.dateAdded)}</span>
      <span class="row-actions">
        <button class="icon-btn" data-edit="${esc(bm.id)}" title="Edit">&#9998;</button>
        <button class="icon-btn danger" data-delete="${esc(bm.id)}" title="Delete">&#128465;</button>
      </span></div>`;
  }).join("");
  wireRowActions(container);
}

// ── Review ──

function renderReview() {
  const el = $("view-review");
  const now = Date.now();
  const sixMonths = 180*24*60*60*1000;
  const oneYear = 365*24*60*60*1000;

  const stale = allBookmarks.filter((b) => b.status==="active" && (now-b.dateAdded>sixMonths) && (!b.dateLastUsed||b.dateLastUsed===b.dateAdded));
  const forgotten = allBookmarks.filter((b) => b.status==="active" && (now-b.dateAdded>oneYear) && (!b.dateLastUsed||b.dateLastUsed===b.dateAdded));
  const dupes = allBookmarks.filter((b) => b.status==="duplicate");
  const likelyDupes = allBookmarks.filter((b) => b.status==="likely-duplicate");
  const dead = allBookmarks.filter((b) => b.status==="dead");

  const dupeGroups = new Map<string, Bookmark[]>();
  for (const d of dupes) { const k = d.canonicalId||d.normalizedUrl; const l = dupeGroups.get(k); if(l) l.push(d); else dupeGroups.set(k,[d]); }
  const fuzzyGroups = new Map<string, Bookmark[]>();
  for (const d of likelyDupes) { const k = d.canonicalId||d.normalizedUrl; const l = fuzzyGroups.get(k); if(l) l.push(d); else fuzzyGroups.set(k,[d]); }

  // Folder insights
  const folders = new Map<string, Bookmark[]>();
  for (const b of allBookmarks) { if (!b.folderPath) continue; const l = folders.get(b.folderPath); if(l) l.push(b); else folders.set(b.folderPath,[b]); }
  const folderStats = [...folders.entries()].map(([name, bms]) => {
    const staleCount = bms.filter((b) => b.status==="active"&&(now-b.dateAdded>sixMonths)&&(!b.dateLastUsed||b.dateLastUsed===b.dateAdded)).length;
    const deadCount = bms.filter((b) => b.status==="dead").length;
    const dupeCount = bms.filter((b) => b.status==="duplicate"||b.status==="likely-duplicate").length;
    const total = bms.length;
    return { name, total, stalePct: total?Math.round(staleCount/total*100):0, deadPct: total?Math.round(deadCount/total*100):0, dupePct: total?Math.round(dupeCount/total*100):0, isDead: total>0&&(staleCount+deadCount)===total };
  }).sort((a, b) => b.stalePct - a.stalePct);

  el.innerHTML = `
    <h2>Review</h2>
    <div class="review-group"><h3>Stale Bookmarks <span class="review-count">${stale.length}</span></h3>${renderReviewItems(stale.slice(0,50),"exclude")}${stale.length>50?`<div class="empty-state">${stale.length-50} more</div>`:""}</div>
    <div class="review-group"><h3>Forgotten <span class="review-count">${forgotten.length}</span></h3>${renderReviewItems(forgotten.slice(0,50),"exclude")}</div>
    <div class="review-group"><h3>Dead Links <span class="review-count">${dead.length}</span></h3>${renderReviewItems(dead.slice(0,50),"remove")}</div>
    <div class="review-group"><h3>Exact Duplicates <span class="review-count">${dupes.length} in ${dupeGroups.size} groups</span></h3>${renderDupeGroups(dupeGroups)}</div>
    <div class="review-group"><h3>Likely Duplicates <span class="review-count">${likelyDupes.length} in ${fuzzyGroups.size} groups</span></h3>${renderDupeGroups(fuzzyGroups)}</div>
    <div class="review-group"><h3>Folder Insights <span class="review-count">${folderStats.length} folders</span></h3>
      <div style="margin-bottom:4px"><div class="folder-row" style="font-weight:500;color:var(--text-muted)"><span class="fr-name">Folder</span><span class="fr-stat">Total</span><span class="fr-stat">Stale%</span><span class="fr-stat">Dead%</span><span class="fr-stat">Dupe%</span></div></div>
      ${folderStats.slice(0,40).map((f)=>`<div class="folder-row ${f.isDead?"dead-folder":""}"><span class="fr-name" title="${esc(f.name)}">${esc(f.name)}</span><span class="fr-stat">${f.total}</span><span class="fr-stat" style="color:${f.stalePct>70?"var(--orange)":"inherit"}">${f.stalePct}%</span><span class="fr-stat" style="color:${f.deadPct>0?"var(--red)":"inherit"}">${f.deadPct}%</span><span class="fr-stat">${f.dupePct}%</span></div>`).join("")}
    </div>`;

  el.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const action = (btn as HTMLElement).dataset.action!;
      const bmId = (btn as HTMLElement).dataset.bmId!;
      if (action==="exclude"||action==="remove") { await send({type:"updateBookmarkStatus",bookmarkId:bmId,status:"excluded"}); (btn as HTMLElement).closest(".review-item")?.remove(); }
      else if (action==="recheck") { (btn as HTMLElement).textContent="…"; await send({type:"updateBookmarkStatus",bookmarkId:bmId,status:"active"}); (btn as HTMLElement).closest(".review-item")?.remove(); }
      else if (action==="keep") {
        const g = (btn as HTMLElement).dataset.group!;
        const items = Array.from(el.querySelectorAll(`[data-dupe-group="${g}"]`));
        for (const item of items) { const id = (item as HTMLElement).dataset.bmId!; if (id!==bmId) await send({type:"updateBookmarkStatus",bookmarkId:id,status:"excluded"}); }
        await loadData(); renderReview();
      }
    });
  });
}

function renderReviewItems(bookmarks: Bookmark[], actionType: string): string {
  return bookmarks.map((bm) => `<div class="review-item">
    ${favicon(bm.domain)}
    <span class="ri-title" title="${esc(bm.url)}">${esc(bm.title||bm.url)}</span>
    <span class="ri-domain">${esc(bm.domain)}</span>
    <span style="font-size:11px;color:var(--text-dim)">${fmtDate(bm.dateAdded)}</span>
    ${actionType==="remove"?`<button data-action="recheck" data-bm-id="${esc(bm.id)}">Recheck</button><button data-action="remove" data-bm-id="${esc(bm.id)}">Remove</button>`:`<button data-action="exclude" data-bm-id="${esc(bm.id)}">Exclude</button>`}
  </div>`).join("");
}

function renderDupeGroups(groups: Map<string, Bookmark[]>): string {
  const entries = [...groups.entries()].slice(0, 30);
  return entries.map(([key, dupes]) => {
    const canonical = bmById(key) || dupes[0];
    const all = [canonical, ...dupes].filter((b,i,a) => a.findIndex((x) => x.id===b.id)===i);
    return `<div style="margin-bottom:12px;padding:8px 12px;background:var(--bg-surface);border-radius:6px">
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px">${all.length} copies · ${esc(canonical.normalizedUrl||canonical.url)}</div>
      ${all.map((bm)=>`<div class="review-item" data-dupe-group="${esc(key)}" data-bm-id="${esc(bm.id)}">
        ${favicon(bm.domain)}<span class="ri-title">${esc(bm.title||bm.url)}</span><span class="ri-domain">${esc(bm.folderPath||bm.domain)}</span><span style="font-size:11px;color:var(--text-dim)">${fmtDate(bm.dateAdded)}</span>
        <button data-action="keep" data-bm-id="${esc(bm.id)}" data-group="${esc(key)}">Keep this</button></div>`).join("")}
    </div>`;
  }).join("") + (groups.size > 30 ? `<div class="empty-state">${groups.size-30} more groups</div>` : "");
}

// ── Timeline (sparkline) ──

function renderTimeline() {
  const el = $("view-timeline");
  const months = new Map<string, Bookmark[]>();
  for (const bm of allBookmarks) { const k = fmtMonth(bm.dateAdded); const l = months.get(k); if(l) l.push(bm); else months.set(k,[bm]); }

  const sorted = [...months.entries()].sort((a,b) => (b[1][0]?.dateAdded||0) - (a[1][0]?.dateAdded||0));
  const maxCount = sorted.length > 0 ? Math.max(...sorted.map(([,b]) => b.length)) : 1;

  el.innerHTML = `<h2>Timeline</h2><div style="margin-bottom:16px;font-size:13px;color:var(--text-muted)">${sorted.length} months</div>
    ${sorted.map(([month,bms]) => `<div class="timeline-month" data-month="${esc(month)}">
      <div class="timeline-header">
        <span class="tl-label">${esc(month)}</span>
        <div class="tl-sparkline">${buildSparkline(bms)}</div>
        <span class="tl-count">${bms.length}</span>
      </div>
      <div class="timeline-items" id="tl-${esc(month.replace(/\s+/g,"_"))}"></div>
    </div>`).join("")}`;

  el.querySelectorAll(".timeline-header").forEach((h) => {
    h.addEventListener("click", () => {
      const m = h.closest(".timeline-month")!;
      const was = m.classList.contains("expanded");
      m.classList.toggle("expanded");
      if (!was) {
        const month = (m as HTMLElement).dataset.month!;
        const bms = months.get(month) || [];
        const c = m.querySelector(".timeline-items") as HTMLElement;
        if (c && c.children.length === 0) renderSimpleRows(bms.sort((a,b) => b.dateAdded-a.dateAdded), c);
      }
    });
  });
}

function buildSparkline(bms: Bookmark[]): string {
  // Group by day within the month
  const days = new Map<number, number>();
  for (const b of bms) {
    const d = new Date(b.dateAdded).getDate();
    days.set(d, (days.get(d) || 0) + 1);
  }
  const maxDay = Math.max(...Array.from(days.values()), 1);
  const bars: string[] = [];
  for (let d = 1; d <= 31; d++) {
    const c = days.get(d) || 0;
    const h = c > 0 ? Math.max(2, Math.round((c / maxDay) * 24)) : 0;
    bars.push(c > 0 ? `<div class="tl-spark-bar" style="height:${h}px" data-count="${c}" title="Day ${d}: ${c}"></div>` : `<div style="flex:1;min-width:2px"></div>`);
  }
  return bars.join("");
}

// ── Insights ──

function renderInsights() {
  const el = $("view-insights");
  const bm = allBookmarks;
  if (bm.length === 0) { el.innerHTML = '<h2>Insights</h2><div class="empty-state">No bookmarks yet.</div>'; return; }

  // Health
  const avgHealth = Math.round(bm.reduce((s,b) => s + (b.healthScore ?? 50), 0) / bm.length);
  const hc = avgHealth > 70 ? "var(--green)" : avgHealth > 40 ? "var(--yellow)" : "var(--red)";

  // Peak hours
  const hours = new Array(24).fill(0);
  for (const b of bm) hours[new Date(b.dateAdded).getHours()]++;
  const maxH = Math.max(...hours, 1);

  // Peak days
  const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const days = new Array(7).fill(0);
  for (const b of bm) days[new Date(b.dateAdded).getDay()]++;
  const maxD = Math.max(...days, 1);

  // Busiest month
  const monthlyCounts = new Map<string, number>();
  for (const b of bm) { const k = fmtMonth(b.dateAdded); monthlyCounts.set(k, (monthlyCounts.get(k)||0)+1); }
  let busiestMonth = ""; let busiestCount = 0;
  for (const [m,c] of monthlyCounts) { if (c > busiestCount) { busiestMonth = m; busiestCount = c; } }

  // Longest drought
  const sorted = bm.map((b) => b.dateAdded).sort((a,b) => a-b);
  let maxGap = 0; let gapStart = 0; let gapEnd = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i-1];
    if (gap > maxGap) { maxGap = gap; gapStart = sorted[i-1]; gapEnd = sorted[i]; }
  }
  const droughtDays = Math.round(maxGap / 86400000);

  // Most bookmarked domain
  const dc = new Map<string, number>();
  for (const b of bm) if (b.domain) dc.set(b.domain, (dc.get(b.domain)||0)+1);
  let topDomain = ""; let topDomainCount = 0;
  for (const [d,c] of dc) { if (c > topDomainCount) { topDomain = d; topDomainCount = c; } }

  // Most bookmarked URL
  const uc = new Map<string, number>();
  for (const b of bm) uc.set(b.normalizedUrl, (uc.get(b.normalizedUrl)||0)+1);
  let topUrl = ""; let topUrlCount = 0;
  for (const [u,c] of uc) { if (c > topUrlCount) { topUrl = u; topUrlCount = c; } }

  // Personality
  const tc = new Map<ContentType, number>();
  for (const b of bm) tc.set(b.contentType, (tc.get(b.contentType)||0)+1);
  const top3 = [...tc.entries()].sort((a,b) => b[1]-a[1]).slice(0,3).map(([t]) => t);
  const t3s = new Set(top3);
  let personality = "Generalist";
  if (t3s.has("github-repo") && (t3s.has("docs") || t3s.has("forum") || t3s.has("package"))) personality = "Developer";
  else if (t3s.has("article") && (t3s.has("academic") || t3s.has("reference"))) personality = "Researcher";
  else if (t3s.has("video") && (t3s.has("social") || t3s.has("news") || t3s.has("music"))) personality = "Explorer";
  else if (t3s.has("shopping") || t3s.has("real-estate")) personality = "Shopper";
  else if (t3s.has("news")) personality = "News Junkie";

  // Age distribution
  const now = Date.now();
  const ageBuckets = [
    { label: "<1mo", max: 30*86400000 },
    { label: "1-6mo", max: 180*86400000 },
    { label: "6-12mo", max: 365*86400000 },
    { label: "1-2yr", max: 730*86400000 },
    { label: "2-5yr", max: 1825*86400000 },
    { label: "5yr+", max: Infinity },
  ];
  const ageCounts = ageBuckets.map(() => 0);
  for (const b of bm) {
    const age = now - b.dateAdded;
    for (let i = 0; i < ageBuckets.length; i++) {
      if (age < ageBuckets[i].max || i === ageBuckets.length - 1) { ageCounts[i]++; break; }
    }
  }
  const maxAge = Math.max(...ageCounts, 1);

  el.innerHTML = `
    <h2>Insights</h2>
    <div class="stat-grid">
      <div class="stat-card" style="text-align:center"><div class="gauge-big" style="color:${hc}">${avgHealth}</div><div class="stat-label">Collection Health</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:18px">${esc(personality)}</div><div class="stat-label">Bookmark Personality</div><div style="font-size:11px;color:var(--text-dim);margin-top:4px">Based on: ${top3.join(", ")}</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:16px">${esc(busiestMonth)}</div><div class="stat-label">Busiest Month (${busiestCount})</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:16px">${droughtDays} days</div><div class="stat-label">Longest Drought</div><div style="font-size:10px;color:var(--text-dim)">${gapStart?fmtDate(gapStart):""} — ${gapEnd?fmtDate(gapEnd):""}</div></div>
    </div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value" style="font-size:16px">${esc(topDomain)}</div><div class="stat-label">Top Domain (${topDomainCount})</div></div>
      <div class="stat-card"><div class="stat-value" style="font-size:12px;word-break:break-all">${esc(topUrl.slice(0,60))}</div><div class="stat-label">Most Saved URL (${topUrlCount}x)</div></div>
    </div>

    <h3>Bookmarking by Hour</h3>
    <div class="insights-histogram-wrap">
      <div class="insights-histogram">${hours.map((c,i) => `<div class="ih-bar" style="height:${Math.max(2,Math.round(c/maxH*60))}px" title="${i}:00 — ${c} bookmarks"></div>`).join("")}</div>
      <div class="insights-histogram-labels">${hours.map((_,i) => `<span>${i%3===0?i:""}</span>`).join("")}</div>
    </div>

    <h3>Bookmarking by Day</h3>
    <div class="insights-histogram-wrap">
      <div class="insights-histogram">${days.map((c,i) => `<div class="ih-bar" style="height:${Math.max(2,Math.round(c/maxD*60))}px;min-width:30px" title="${dayNames[i]} — ${c} bookmarks"></div>`).join("")}</div>
      <div class="insights-histogram-labels">${dayNames.map((d) => `<span>${d}</span>`).join("")}</div>
    </div>

    <h3>Bookmark Age Distribution</h3>
    <div class="insights-histogram-wrap">
      <div class="insights-histogram">${ageCounts.map((c,i) => `<div class="ih-bar" style="height:${Math.max(2,Math.round(c/maxAge*60))}px;min-width:40px" title="${ageBuckets[i].label} — ${c} bookmarks"></div>`).join("")}</div>
      <div class="insights-histogram-labels">${ageBuckets.map((b) => `<span>${b.label}</span>`).join("")}</div>
    </div>`;
}

// ── Data loading ──

async function loadData() {
  const [bmRes, clRes, ssRes, sfRes] = await Promise.all([
    send<{ bookmarks: Bookmark[] }>({ type: "getAllBookmarks" }),
    send<{ clusters: Cluster[] }>({ type: "getClusters" }),
    send<{ sessions: Session[] }>({ type: "getSessions" }),
    send<{ filters: SavedFilter[] }>({ type: "getSavedFilters" }),
  ]);
  allBookmarks = bmRes.bookmarks;
  allClusters = clRes.clusters;
  allSessions = ssRes.sessions;
  savedFilters = sfRes.filters;
  $("nav-count-bm").textContent = String(allBookmarks.length);
  $("nav-count-cl").textContent = String(allClusters.length);
  $("nav-count-ss").textContent = String(allSessions.length);
}

// ── Sidebar ──

$("btn-reimport").addEventListener("click", async () => {
  const btn = $("btn-reimport") as HTMLButtonElement;
  btn.disabled = true; btn.textContent = "Importing…";
  await send<ImportResult>({ type: "reimportBookmarks" });
  await loadData(); btn.disabled = false; btn.textContent = "Reimport Bookmarks";
  renderCurrentView();
});

$("btn-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

// ── Live refresh on external bookmark changes ──

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "bookmarkChanged") {
    loadData().then(() => renderCurrentView());
  }
});

// ── Init ──

async function init() { await loadData(); renderCurrentView(); }
init();
