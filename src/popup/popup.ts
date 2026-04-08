import type { Bookmark, ContentType } from "../models/types";
import type { BookmarkStats, ImportResult } from "../capture/import";
import type { LinkCheckProgress } from "../capture/linkcheck";

const searchInput = document.getElementById("search") as HTMLInputElement;
const listEl = document.getElementById("bookmark-list")!;
const reimportBtn = document.getElementById("reimport") as HTMLButtonElement;
const linkcheckBtn = document.getElementById("linkcheck") as HTMLButtonElement;
const linkcheckStatus = document.getElementById("linkcheck-status")!;
const progressTrack = document.getElementById("progress-track")!;
const progressFill = document.getElementById("progress-fill")!;
const optionsBtn = document.getElementById("options") as HTMLButtonElement;
const statTotal = document.getElementById("stat-total")!;
const statDupes = document.getElementById("stat-dupes")!;
const statDead = document.getElementById("stat-dead")!;
const typeBreakdown = document.getElementById("type-breakdown")!;

let allBookmarks: Bookmark[] = [];

function sendMessage<T>(message: { type: string }): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

function renderStats(stats: BookmarkStats) {
  statTotal.textContent = String(stats.total);
  statDupes.textContent = String(stats.duplicates);
  statDead.textContent = String(stats.dead);
}

function renderTypeBreakdown(bookmarks: Bookmark[]) {
  const counts = new Map<ContentType, number>();
  for (const bm of bookmarks) {
    const ct = bm.contentType || "unknown";
    counts.set(ct, (counts.get(ct) || 0) + 1);
  }

  // Sort by count descending, take top 5 (excluding unknown)
  const sorted = [...counts.entries()]
    .filter(([t]) => t !== "unknown")
    .sort((a, b) => b[1] - a[1]);

  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5).reduce((sum, [, c]) => sum + c, 0);
  const unknownCount = counts.get("unknown") || 0;

  if (top.length === 0) {
    typeBreakdown.innerHTML = "";
    return;
  }

  const parts = top.map(
    ([type, count]) =>
      `<span class="tb-count">${count}</span> <span class="tb-type">${type}</span>`
  );
  if (rest > 0) {
    parts.push(`<span class="tb-count">${rest}</span> <span class="tb-type">other</span>`);
  }
  if (unknownCount > 0) {
    parts.push(`<span class="tb-count">${unknownCount}</span> <span class="tb-type">unclassified</span>`);
  }

  typeBreakdown.innerHTML = parts.join(" &middot; ");
}

function escapeHtml(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function badgeClass(ct: ContentType): string {
  return `badge badge-ct-${ct}`;
}

function renderList(bookmarks: Bookmark[]) {
  if (bookmarks.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No bookmarks found</div>';
    return;
  }

  const toRender = bookmarks.slice(0, 200);
  const html = toRender
    .map((bm) => {
      const badges: string[] = [];

      // Content type badge
      const ct = bm.contentType || "unknown";
      badges.push(`<span class="${badgeClass(ct)}">${escapeHtml(ct)}</span>`);

      // Status badges (only if not active)
      if (bm.status === "dead") {
        badges.push('<span class="badge badge-dead">dead</span>');
      }
      if (bm.status === "duplicate") {
        badges.push('<span class="badge badge-duplicate">duplicate</span>');
      }

      return `<div class="bookmark-item" data-url="${escapeHtml(bm.url)}">
        <div class="bm-title">${escapeHtml(bm.title || bm.url)}</div>
        <div class="bm-meta">
          <span class="bm-domain">${escapeHtml(bm.domain || "")}</span>
          <span class="bm-badges">${badges.join("")}</span>
        </div>
      </div>`;
    })
    .join("");

  listEl.innerHTML = html;

  if (bookmarks.length > 200) {
    listEl.innerHTML += `<div class="empty-state">${bookmarks.length - 200} more — refine your search</div>`;
  }
}

function filterBookmarks(query: string): Bookmark[] {
  if (!query) return allBookmarks;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return allBookmarks.filter((bm) => {
    const haystack = `${bm.title} ${bm.url} ${bm.domain} ${bm.contentType} ${bm.tags.join(" ")} ${bm.status}`.toLowerCase();
    return terms.every((t) => haystack.includes(t));
  });
}

async function loadBookmarks() {
  const { bookmarks } = await sendMessage<{ bookmarks: Bookmark[] }>({
    type: "getAllBookmarks",
  });
  allBookmarks = bookmarks;
  renderTypeBreakdown(allBookmarks);
  renderList(filterBookmarks(searchInput.value));
}

async function loadStats() {
  const stats = await sendMessage<BookmarkStats>({ type: "getStats" });
  renderStats(stats);
}

// Search
searchInput.addEventListener("input", () => {
  renderList(filterBookmarks(searchInput.value));
});

// Click to open bookmark in new tab
listEl.addEventListener("click", (e) => {
  const item = (e.target as HTMLElement).closest(".bookmark-item") as HTMLElement | null;
  if (item?.dataset.url) {
    chrome.tabs.create({ url: item.dataset.url });
  }
});

// Reimport
reimportBtn.addEventListener("click", async () => {
  reimportBtn.disabled = true;
  reimportBtn.textContent = "Importing…";
  await sendMessage<ImportResult>({ type: "reimportBookmarks" });
  reimportBtn.disabled = false;
  reimportBtn.textContent = "Reimport";
  await loadStats();
  await loadBookmarks();
});

// Dead link check with progress bar
linkcheckBtn.addEventListener("click", async () => {
  linkcheckBtn.disabled = true;
  reimportBtn.disabled = true;
  linkcheckStatus.textContent = "Starting…";
  progressTrack.classList.add("active");
  progressFill.style.width = "0%";

  const { dead } = await sendMessage<{ dead: number }>({
    type: "checkDeadLinks",
  });

  progressTrack.classList.remove("active");
  linkcheckBtn.disabled = false;
  reimportBtn.disabled = false;
  linkcheckStatus.textContent = `Done — ${dead} dead`;
  await loadStats();
  await loadBookmarks();
});

// Listen for link check progress updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "linkCheckProgress") {
    const p = message as LinkCheckProgress & { type: string };
    const pct = p.total > 0 ? Math.round((p.checked / p.total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    linkcheckStatus.textContent = `Checking… ${p.checked}/${p.total}`;
  }
});

// Settings
optionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// Init
loadStats();
loadBookmarks();
