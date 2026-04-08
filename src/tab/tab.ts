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
let selectedIds = new Set<string>();

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

// ── Modal ──

const modalOverlay = $("modal-overlay");
const modalContent = $("modal-content");

function showModal(html: string) {
  modalContent.innerHTML = html;
  modalOverlay.classList.add("visible");
}

function hideModal() {
  modalOverlay.classList.remove("visible");
  modalContent.innerHTML = "";
}

modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) hideModal();
});

// ── Navigation ──

const navItems = document.querySelectorAll(".nav-item");
navItems.forEach((btn) => {
  btn.addEventListener("click", () => {
    switchView((btn as HTMLElement).dataset.view!);
  });
});

function switchView(view: string) {
  currentView = view;
  selectedIds.clear();
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
  const stale = bm.filter((b) => b.status === "active" && (now - b.dateAdded > sixMonths) && (!b.dateLastUsed || b.dateLastUsed === b.dateAdded)).length;

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

  const tc: Record<string, string> = {
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
      <div class="stat-card"><div class="stat-value" style="font-size:15px">${(bm.length / daySpan).toFixed(1)}/d · ${(bm.length / (daySpan / 7)).toFixed(1)}/w · ${(bm.length / (daySpan / 30)).toFixed(1)}/mo</div><div class="stat-label">Bookmark rate</div></div>
    </div>
    <h3>Top 10 Domains</h3>
    <div class="bar-chart">${topDomains.map(([d, c]) => `<div class="bar-row"><span class="bar-label">${esc(d)}</span><div class="bar-track"><div class="bar-fill" style="width:${(c/maxDC*100).toFixed(1)}%;background:var(--accent)"></div></div><span class="bar-count">${c}</span></div>`).join("")}</div>
    <h3>Content Types</h3>
    <div class="bar-chart">${typesSorted.map(([t, c]) => `<div class="bar-row"><span class="bar-label">${esc(t)}</span><div class="bar-track"><div class="bar-fill" style="width:${(c/maxTC*100).toFixed(1)}%;background:${tc[t]||"var(--accent)"}"></div></div><span class="bar-count">${c}</span></div>`).join("")}</div>
    <h3>Bookmarks per Month</h3>
    <div class="bar-chart">${months.slice(-12).map(([m, c]) => `<div class="bar-row"><span class="bar-label">${esc(m)}</span><div class="bar-track"><div class="bar-fill" style="width:${(c/maxMC*100).toFixed(1)}%;background:var(--accent)"></div></div><span class="bar-count">${c}</span></div>`).join("")}</div>
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
  return list;
}

// Track which cluster detail view is active (for cluster bulk actions)
let activeClusterId = "";

function updateBulkToolbar() {
  const actions = document.querySelector(".bulk-actions");
  if (!actions) return;
  const count = selectedIds.size;
  actions.classList.toggle("visible", count > 0);
  const countEl = document.querySelector(".bulk-count");
  if (countEl) countEl.textContent = count > 0 ? `${count} selected` : "Select items";
  // Update button labels with count
  const delBtn = document.getElementById("bulk-delete");
  if (delBtn) delBtn.textContent = `Delete Selected (${count})`;
  const exclBtn = document.getElementById("bulk-exclude");
  if (exclBtn) exclBtn.textContent = `Mark Excluded (${count})`;
  const removeBtn = document.getElementById("bulk-remove-cluster");
  if (removeBtn) removeBtn.textContent = `Remove from Cluster (${count})`;
  // Sync select-all checkbox
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
  // Remove from cluster state
  for (const c of allClusters) {
    c.bookmarkIds = c.bookmarkIds.filter((id) => id !== bmId);
  }
  const row = document.querySelector(`.bm-row[data-bm-id="${bmId}"]`);
  if (row) row.remove();
  $("nav-count-bm").textContent = String(allBookmarks.length);
  const resultsCount = document.querySelector(".results-count");
  if (resultsCount) {
    const filtered = filterBM();
    resultsCount.textContent = `${filtered.length} bookmarks`;
  }
  updateBulkToolbar();
}

function pruneClustersFromState(prunedIds: string[]) {
  if (!prunedIds || prunedIds.length === 0) return;
  allClusters = allClusters.filter((c) => !prunedIds.includes(c.id));
  $("nav-count-cl").textContent = String(allClusters.length);
  // Remove cluster cards from DOM if visible
  for (const id of prunedIds) {
    const card = document.querySelector(`.cluster-card[data-cluster-id="${id}"]`);
    if (card) card.remove();
  }
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
    <div class="filter-row">
      <button class="filter-btn ${bookmarkTypeFilter === "" ? "active" : ""}" data-type="">All</button>
      ${types.map((t) => `<button class="filter-btn ${bookmarkTypeFilter === t ? "active" : ""}" data-type="${t}">${t}</button>`).join("")}
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
  if (filtered.length > 300) {
    $("bm-table").insertAdjacentHTML("beforeend", `<div class="empty-state">${filtered.length - 300} more — refine your search</div>`);
  }

  $("bm-search").addEventListener("input", (e) => {
    bookmarkSearchQuery = (e.target as HTMLInputElement).value;
    selectedIds.clear();
    const f = filterBM();
    $("bm-table").innerHTML = "";
    renderBookmarkRows(f.slice(0, 300), $("bm-table"));
    el.querySelector(".results-count")!.textContent = `${f.length} bookmarks`;
    updateBulkToolbar();
  });

  el.querySelectorAll(".filter-btn[data-type]").forEach((btn) => {
    btn.addEventListener("click", () => { bookmarkTypeFilter = (btn as HTMLElement).dataset.type!; renderBookmarks(); });
  });

  $("btn-add-bm").addEventListener("click", showAddBookmarkModal);
  wireSelectAll();
  $("bulk-delete").addEventListener("click", () => bulkDeleteSelected());
  $("bulk-exclude").addEventListener("click", () => bulkExcludeSelected());
  $("bulk-export").addEventListener("click", () => {
    const bms = [...selectedIds].map(bmById).filter(Boolean) as Bookmark[];
    downloadFile(exportAllAsCSV(bms), "aftermark-selected.csv", "text/csv");
  });
}

function wireSelectAll() {
  const selectAll = document.getElementById("select-all") as HTMLInputElement | null;
  if (!selectAll) return;
  selectAll.addEventListener("change", () => {
    const checked = selectAll.checked;
    const checkboxes = document.querySelectorAll<HTMLInputElement>(".bm-row-check");
    checkboxes.forEach((cb) => {
      cb.checked = checked;
      const id = cb.dataset.id!;
      if (checked) selectedIds.add(id); else selectedIds.delete(id);
    });
    updateBulkToolbar();
  });
}

function renderBookmarkRows(bookmarks: Bookmark[], container: HTMLElement) {
  const html = bookmarks.map((bm) => {
    const ct = bm.contentType || "unknown";
    const badges = [`<span class="badge badge-ct-${ct}">${esc(ct)}</span>`];
    if (bm.status === "dead") badges.push('<span class="badge badge-dead">dead</span>');
    if (bm.status === "duplicate") badges.push('<span class="badge badge-duplicate">duplicate</span>');
    return `<div class="bm-row" data-bm-id="${esc(bm.id)}" data-url="${esc(bm.url)}">
      <input type="checkbox" class="bm-check bm-row-check" data-id="${esc(bm.id)}" ${selectedIds.has(bm.id) ? "checked" : ""}>
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
    // Checkbox
    if (target.classList.contains("bm-row-check")) {
      e.stopPropagation();
      const id = (target as HTMLInputElement).dataset.id!;
      if ((target as HTMLInputElement).checked) selectedIds.add(id);
      else selectedIds.delete(id);
      updateBulkToolbar();
      return;
    }
    // Edit
    const editBtn = target.closest("[data-edit]") as HTMLElement | null;
    if (editBtn) { e.stopPropagation(); showEditModal(editBtn.dataset.edit!); return; }
    // Delete
    const delBtn = target.closest("[data-delete]") as HTMLElement | null;
    if (delBtn) { e.stopPropagation(); showDeleteConfirm(delBtn.dataset.delete!); return; }
    // Remove from cluster
    const removeBtn = target.closest("[data-remove-from-cluster]") as HTMLElement | null;
    if (removeBtn) { e.stopPropagation(); removeFromCluster(removeBtn.dataset.removeFromCluster!, removeBtn.dataset.clusterId!); return; }
    // Open URL
    const row = target.closest(".bm-row") as HTMLElement | null;
    if (row?.dataset.url) chrome.tabs.create({ url: row.dataset.url });
  });
}

// ── Bookmark CRUD Modals ──

function showAddBookmarkModal() {
  showModal(`
    <h3>Add Bookmark</h3>
    <label>URL (required)</label>
    <input id="add-url" type="url" placeholder="https://…">
    <label>Title (optional)</label>
    <input id="add-title" type="text" placeholder="Page title">
    <label>Tags (comma-separated)</label>
    <input id="add-tags" type="text" placeholder="tag1, tag2">
    <div class="modal-actions">
      <button class="btn-cancel" id="add-cancel">Cancel</button>
      <button class="btn-primary" id="add-save">Add</button>
    </div>
  `);
  $("add-cancel").addEventListener("click", hideModal);
  $("add-save").addEventListener("click", async () => {
    const url = ($("add-url") as HTMLInputElement).value.trim();
    if (!url) return;
    const title = ($("add-title") as HTMLInputElement).value.trim() || undefined;
    const tagsStr = ($("add-tags") as HTMLInputElement).value.trim();
    const tags = tagsStr ? tagsStr.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
    await send({ type: "createBookmark", url, title, tags });
    hideModal();
    await loadData();
    renderBookmarks();
  });
}

function showEditModal(bmId: string) {
  const bm = bmById(bmId);
  if (!bm) return;
  showModal(`
    <h3>Edit Bookmark</h3>
    <label>Title</label>
    <input id="edit-title" type="text" value="${esc(bm.title)}">
    <label>Tags (comma-separated)</label>
    <input id="edit-tags" type="text" value="${esc(bm.tags.join(", "))}">
    <label>Status</label>
    <select id="edit-status">
      <option value="active" ${bm.status === "active" ? "selected" : ""}>Active</option>
      <option value="excluded" ${bm.status === "excluded" ? "selected" : ""}>Excluded</option>
    </select>
    <div style="margin-top:12px;font-size:12px;color:var(--text-dim)">${esc(bm.url)}</div>
    <div class="modal-actions">
      <button class="btn-cancel" id="edit-cancel">Cancel</button>
      <button class="btn-primary" id="edit-save">Save</button>
    </div>
  `);
  $("edit-cancel").addEventListener("click", hideModal);
  $("edit-save").addEventListener("click", async () => {
    const title = ($("edit-title") as HTMLInputElement).value.trim();
    const tagsStr = ($("edit-tags") as HTMLInputElement).value.trim();
    const tags = tagsStr ? tagsStr.split(",").map((t) => t.trim()).filter(Boolean) : [];
    const status = ($("edit-status") as HTMLSelectElement).value;
    await send({ type: "updateBookmark", bookmarkId: bmId, title, tags, status });
    hideModal();
    await loadData();
    renderCurrentView();
  });
}

function showDeleteConfirm(bmId: string) {
  const bm = bmById(bmId);
  if (!bm) return;
  showModal(`
    <h3>Delete Bookmark?</h3>
    <p style="color:var(--text-muted);font-size:13px;margin-bottom:8px">${esc(bm.title || bm.url)}</p>
    <p style="color:var(--text-dim);font-size:12px">This removes it from Chrome and Aftermark.</p>
    <div class="modal-actions">
      <button class="btn-cancel" id="del-cancel">Cancel</button>
      <button class="btn-danger" id="del-confirm">Delete</button>
    </div>
  `);
  $("del-cancel").addEventListener("click", hideModal);
  $("del-confirm").addEventListener("click", async () => {
    const res = await send<{ ok: boolean; prunedClusters?: string[] }>({ type: "deleteBookmark", bookmarkId: bmId });
    hideModal();
    removeRowAndUpdateStats(bmId);
    pruneClustersFromState(res.prunedClusters || []);
    // If we were in a cluster detail that got pruned, go back to clusters list
    if (activeClusterId && (res.prunedClusters || []).includes(activeClusterId)) {
      activeClusterId = "";
      await loadData();
      renderClusters();
    }
  });
}

// ── Bulk actions ──

function bulkDeleteSelected() {
  const count = selectedIds.size;
  if (count === 0) return;
  showModal(`
    <h3>Delete ${count} bookmark${count > 1 ? "s" : ""}?</h3>
    <p style="color:var(--text-muted);font-size:13px">This will also remove them from Chrome. This cannot be undone.</p>
    <div class="modal-actions">
      <button class="btn-cancel" id="bd-cancel">Cancel</button>
      <button class="btn-danger" id="bd-confirm">Delete ${count} bookmarks</button>
    </div>
  `);
  $("bd-cancel").addEventListener("click", hideModal);
  $("bd-confirm").addEventListener("click", async () => {
    const idsToDelete = [...selectedIds];
    const res = await send<{ ok: boolean; prunedClusters?: string[] }>({ type: "bulkDelete", bookmarkIds: idsToDelete });
    hideModal();
    for (const id of idsToDelete) {
      removeRowAndUpdateStats(id);
    }
    clearSelection();
    pruneClustersFromState(res.prunedClusters || []);
    if (activeClusterId && (res.prunedClusters || []).includes(activeClusterId)) {
      activeClusterId = "";
      await loadData();
      renderClusters();
    }
  });
}

async function bulkExcludeSelected() {
  if (selectedIds.size === 0) return;
  await send({ type: "bulkExclude", bookmarkIds: [...selectedIds] });
  clearSelection();
  await loadData();
  if (activeClusterId) showClusterDetail(activeClusterId);
  else renderBookmarks();
}

async function bulkRemoveFromCluster(clusterId: string) {
  if (selectedIds.size === 0) return;
  let clusterDeleted = false;
  for (const bmId of selectedIds) {
    const res = await send<{ ok: boolean; clusterDeleted?: boolean }>({ type: "removeFromCluster", bookmarkId: bmId, clusterId });
    if (res.clusterDeleted) clusterDeleted = true;
  }
  clearSelection();
  await loadData();
  if (clusterDeleted) {
    activeClusterId = "";
    renderClusters();
  } else {
    showClusterDetail(clusterId);
  }
}

// ── Clusters ──

function renderClusters() {
  const el = $("view-clusters");
  const byType = new Map<string, Cluster[]>();
  for (const c of allClusters) {
    const list = byType.get(c.type);
    if (list) list.push(c); else byType.set(c.type, [c]);
  }

  const sections = [...byType.entries()].map(([type, clusters]) => {
    const sorted = clusters.sort((a, b) => b.bookmarkIds.length - a.bookmarkIds.length);
    return `
      <h3>${esc(type)} <span style="color:var(--text-dim);font-weight:normal;font-size:12px">${clusters.length} clusters</span></h3>
      <div class="cluster-grid">${sorted.map((c) => `
        <div class="cluster-card" data-cluster-id="${esc(c.id)}">
          <div class="cc-name">${esc(c.name)}</div>
          <div class="cc-meta">${c.bookmarkIds.length} bookmarks<span class="cc-type">${esc(c.type)}</span></div>
        </div>`).join("")}</div>`;
  }).join("");

  el.innerHTML = `<h2>Clusters</h2>${sections || '<div class="empty-state">No clusters yet. Reimport to build.</div>'}`;

  el.querySelectorAll(".cluster-card").forEach((card) => {
    card.addEventListener("click", () => showClusterDetail((card as HTMLElement).dataset.clusterId!));
  });
}

function showClusterDetail(clusterId: string) {
  activeClusterId = clusterId;
  selectedIds.clear();
  const cluster = allClusters.find((c) => c.id === clusterId);
  if (!cluster) return;
  const bms = cluster.bookmarkIds.map(bmById).filter(Boolean) as Bookmark[];
  const el = $("view-clusters");
  const otherClusters = allClusters.filter((c) => c.id !== clusterId);

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
      <h2 style="margin:0" id="cl-name-display">${esc(cluster.name)}</h2>
      <button class="icon-btn" id="cl-rename" title="Rename">&#9998;</button>
    </div>
    <div style="margin-bottom:12px;font-size:13px;color:var(--text-muted)">${cluster.type} · ${bms.length} bookmarks</div>
    <div class="export-row">
      <button class="filter-btn" id="cl-export-md">Export Markdown</button>
      <button class="filter-btn" id="cl-export-html">Export HTML Bookmarks</button>
      ${cluster.type === "decision" ? '<button class="filter-btn" id="cl-export-compare">Export Comparison</button>' : ""}
      ${otherClusters.length > 0 ? '<button class="filter-btn" id="cl-merge">Merge Into…</button>' : ""}
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

  renderClusterBookmarks(bms, $("cl-table"), clusterId);
  wireSelectAll();
  $("bulk-delete").addEventListener("click", () => bulkDeleteSelected());
  $("bulk-exclude").addEventListener("click", () => bulkExcludeSelected());
  $("bulk-remove-cluster").addEventListener("click", () => bulkRemoveFromCluster(clusterId));

  const safeName = cluster.name.replace(/[^a-z0-9]/gi, "_");
  $("cl-export-md").addEventListener("click", () => downloadFile(exportClusterAsMarkdown(cluster, bms), `${safeName}.md`, "text/markdown"));
  $("cl-export-html").addEventListener("click", () => downloadFile(exportClusterAsHTML(cluster, bms), `${safeName}.html`, "text/html"));
  document.getElementById("cl-export-compare")?.addEventListener("click", () => downloadFile(exportComparisonTable(cluster, bms), `${safeName}_comparison.md`, "text/markdown"));
  $("cl-back").addEventListener("click", () => renderClusters());

  // Rename
  $("cl-rename").addEventListener("click", () => {
    showModal(`
      <h3>Rename Cluster</h3>
      <label>Name</label>
      <input id="rename-input" type="text" value="${esc(cluster.name)}">
      <div class="modal-actions">
        <button class="btn-cancel" id="rename-cancel">Cancel</button>
        <button class="btn-primary" id="rename-save">Save</button>
      </div>
    `);
    $("rename-cancel").addEventListener("click", hideModal);
    $("rename-save").addEventListener("click", async () => {
      const name = ($("rename-input") as HTMLInputElement).value.trim();
      if (!name) return;
      await send({ type: "renameCluster", clusterId, name });
      hideModal();
      await loadData();
      showClusterDetail(clusterId);
    });
  });

  // Merge
  document.getElementById("cl-merge")?.addEventListener("click", () => {
    showModal(`
      <h3>Merge "${esc(cluster.name)}" Into…</h3>
      <label>Target Cluster</label>
      <select id="merge-target">
        ${otherClusters.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} (${c.bookmarkIds.length})</option>`).join("")}
      </select>
      <p style="margin-top:12px;font-size:12px;color:var(--text-dim)">Bookmarks from "${esc(cluster.name)}" will be added to the target. This cluster will be removed.</p>
      <div class="modal-actions">
        <button class="btn-cancel" id="merge-cancel">Cancel</button>
        <button class="btn-primary" id="merge-confirm">Merge</button>
      </div>
    `);
    $("merge-cancel").addEventListener("click", hideModal);
    $("merge-confirm").addEventListener("click", async () => {
      const targetId = ($("merge-target") as HTMLSelectElement).value;
      await send({ type: "mergeClusters", sourceId: clusterId, targetId });
      hideModal();
      await loadData();
      renderClusters();
    });
  });
}

function renderClusterBookmarks(bookmarks: Bookmark[], container: HTMLElement, clusterId: string) {
  const html = bookmarks.map((bm) => {
    const ct = bm.contentType || "unknown";
    const badges = [`<span class="badge badge-ct-${ct}">${esc(ct)}</span>`];
    if (bm.status === "dead") badges.push('<span class="badge badge-dead">dead</span>');
    if (bm.status === "duplicate") badges.push('<span class="badge badge-duplicate">duplicate</span>');
    return `<div class="bm-row" data-bm-id="${esc(bm.id)}" data-url="${esc(bm.url)}">
      <input type="checkbox" class="bm-check bm-row-check" data-id="${esc(bm.id)}" ${selectedIds.has(bm.id) ? "checked" : ""}>
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
  const res = await send<{ ok: boolean; clusterDeleted?: boolean }>({ type: "removeFromCluster", bookmarkId: bmId, clusterId });
  await loadData();
  if (res.clusterDeleted) {
    activeClusterId = "";
    renderClusters();
  } else {
    showClusterDetail(clusterId);
  }
}

// ── Sessions ──

function renderSessions() {
  const el = $("view-sessions");
  const sorted = [...allSessions].sort((a, b) => b.startTime - a.startTime);

  el.innerHTML = `
    <h2>Sessions</h2>
    <div style="margin-bottom:16px;font-size:13px;color:var(--text-muted)">${sorted.length} browsing sessions</div>
    <div id="sessions-list">${sorted.map((s) => `
      <div class="session-card" data-session-id="${esc(s.id)}">
        <div class="sc-header">
          <span class="sc-domain">${esc(s.dominantDomain || "mixed")}</span>
          <span class="sc-count">${s.bookmarkCount} bookmarks</span>
        </div>
        <div class="sc-time">${fmtDate(s.startTime)}${s.startTime !== s.endTime ? ` — ${new Date(s.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : ""}</div>
        <div class="sc-bookmarks" id="sb-${esc(s.id)}"></div>
      </div>`).join("")}</div>`;

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
          const bms = session.bookmarkIds.map(bmById).filter(Boolean) as Bookmark[];
          renderSessionBookmarks(bms, container);
        }
      }
    });
  });
}

function renderSessionBookmarks(bookmarks: Bookmark[], container: HTMLElement) {
  const html = bookmarks.map((bm) => {
    const ct = bm.contentType || "unknown";
    return `<div class="bm-row" data-bm-id="${esc(bm.id)}" data-url="${esc(bm.url)}">
      <span class="bm-title">${esc(bm.title || bm.url)}</span>
      <span class="bm-domain">${esc(bm.domain)}</span>
      <span class="bm-badges"><span class="badge badge-ct-${ct}">${esc(ct)}</span></span>
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

  const dupeGroups = new Map<string, Bookmark[]>();
  for (const d of dupes) {
    const key = d.canonicalId || d.normalizedUrl;
    const list = dupeGroups.get(key);
    if (list) list.push(d); else dupeGroups.set(key, [d]);
  }

  el.innerHTML = `
    <h2>Review</h2>
    <div class="review-group">
      <h3>Stale Bookmarks <span class="review-count">${stale.length} older than 6 months</span></h3>
      ${renderReviewItems(stale.slice(0, 50), "exclude")}
      ${stale.length > 50 ? `<div class="empty-state">${stale.length - 50} more</div>` : ""}
    </div>
    <div class="review-group">
      <h3>Forgotten <span class="review-count">${forgotten.length} older than 1 year</span></h3>
      ${renderReviewItems(forgotten.slice(0, 50), "exclude")}
    </div>
    <div class="review-group">
      <h3>Dead Links <span class="review-count">${dead.length} unreachable</span></h3>
      ${renderReviewItems(dead.slice(0, 50), "remove")}
    </div>
    <div class="review-group">
      <h3>Duplicates <span class="review-count">${dupes.length} in ${dupeGroups.size} groups</span></h3>
      ${renderDupeGroups(dupeGroups)}
    </div>`;

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
        await send({ type: "updateBookmarkStatus", bookmarkId: bmId, status: "active" });
        (btn as HTMLElement).closest(".review-item")?.remove();
      } else if (action === "keep") {
        const group = (btn as HTMLElement).dataset.group!;
        const groupItems = Array.from(el.querySelectorAll(`[data-dupe-group="${group}"]`));
        for (const item of groupItems) {
          const id = (item as HTMLElement).dataset.bmId!;
          if (id !== bmId) await send({ type: "updateBookmarkStatus", bookmarkId: id, status: "excluded" });
        }
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
    </div>`).join("");
}

function renderDupeGroups(groups: Map<string, Bookmark[]>): string {
  const entries = [...groups.entries()].slice(0, 30);
  return entries.map(([key, dupes]) => {
    const canonical = bmById(key) || dupes[0];
    const all = [canonical, ...dupes].filter((b, i, arr) => arr.findIndex((x) => x.id === b.id) === i);
    return `<div style="margin-bottom:12px;padding:8px 12px;background:var(--bg-surface);border-radius:6px">
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px">${all.length} copies · ${esc(canonical.normalizedUrl || canonical.url)}</div>
      ${all.map((bm) => `
        <div class="review-item" data-dupe-group="${esc(key)}" data-bm-id="${esc(bm.id)}">
          <span class="ri-title">${esc(bm.title || bm.url)}</span>
          <span class="ri-domain">${esc(bm.folderPath || bm.domain)}</span>
          <span style="font-size:11px;color:var(--text-dim)">${fmtDate(bm.dateAdded)}</span>
          <button data-action="keep" data-bm-id="${esc(bm.id)}" data-group="${esc(key)}">Keep this</button>
        </div>`).join("")}
    </div>`;
  }).join("") + (groups.size > 30 ? `<div class="empty-state">${groups.size - 30} more groups</div>` : "");
}

// ── Timeline ──

function renderTimeline() {
  const el = $("view-timeline");
  const months = new Map<string, Bookmark[]>();
  for (const bm of allBookmarks) {
    const k = fmtMonth(bm.dateAdded);
    const list = months.get(k);
    if (list) list.push(bm); else months.set(k, [bm]);
  }

  const sorted = [...months.entries()].sort((a, b) => (b[1][0]?.dateAdded || 0) - (a[1][0]?.dateAdded || 0));
  const maxCount = sorted.length > 0 ? Math.max(...sorted.map(([, bms]) => bms.length)) : 1;

  el.innerHTML = `
    <h2>Timeline</h2>
    <div style="margin-bottom:16px;font-size:13px;color:var(--text-muted)">${sorted.length} months</div>
    ${sorted.map(([month, bms]) => `
      <div class="timeline-month" data-month="${esc(month)}">
        <div class="timeline-header">
          <span class="tl-label">${esc(month)}</span>
          <div class="tl-bar-track"><div class="tl-bar-fill" style="width:${(bms.length/maxCount*100).toFixed(1)}%"></div></div>
          <span class="tl-count">${bms.length}</span>
        </div>
        <div class="timeline-items" id="tl-${esc(month.replace(/\s+/g, "_"))}"></div>
      </div>`).join("")}`;

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
          renderSessionBookmarks(bms.sort((a, b) => b.dateAdded - a.dateAdded), container);
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
  $("nav-count-bm").textContent = String(allBookmarks.length);
  $("nav-count-cl").textContent = String(allClusters.length);
  $("nav-count-ss").textContent = String(allSessions.length);
}

// ── Sidebar ──

$("btn-reimport").addEventListener("click", async () => {
  const btn = $("btn-reimport") as HTMLButtonElement;
  btn.disabled = true; btn.textContent = "Importing…";
  await send<ImportResult>({ type: "reimportBookmarks" });
  await loadData();
  btn.disabled = false; btn.textContent = "Reimport Bookmarks";
  renderCurrentView();
});

$("btn-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

// ── Init ──

async function init() {
  await loadData();
  renderCurrentView();
}
init();
