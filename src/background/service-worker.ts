import {
  importAllBookmarks,
  getBookmarkStats,
  getAllBookmarks,
  createBookmark,
} from "../capture/import";
import { checkDeadLinks } from "../capture/linkcheck";
import { buildAllClusters, getAllClusters } from "../capture/clusters";
import { buildSessions, getAllSessions } from "../capture/sessions";
import { classifyBookmark, normalizeUrl } from "../capture/heuristics";
import { computeHealthScore } from "../capture/health";
import { captureTabContext } from "../capture/context";
import { getDB } from "../db/database";
import type { Bookmark } from "../models/types";

// ── Badge ──

async function updateBadge() {
  const db = await getDB();
  const count = await db.count("bookmarks");
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#4a8aff" });
}

// ── Notify open Aftermark tabs to refresh ──

function notifyTabsChanged() {
  chrome.runtime.sendMessage({ type: "bookmarkChanged" }).catch(() => {});
}

// ── Cluster integration for a single bookmark ──

async function integrateIntoCluster(bm: Bookmark) {
  const db = await getDB();
  const DOMAIN_MIN = 5;

  // Check domain clusters
  if (bm.domain) {
    const domainClusterId = `domain:${bm.domain.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}`;
    const existing = await db.get("clusters", domainClusterId);
    if (existing) {
      if (!existing.bookmarkIds.includes(bm.id)) {
        existing.bookmarkIds.push(bm.id);
        await db.put("clusters", existing);
      }
    } else {
      // Count bookmarks with this domain
      const all = await db.getAll("bookmarks");
      const domainCount = all.filter((b) => b.domain === bm.domain).length;
      if (domainCount >= DOMAIN_MIN) {
        const ids = all.filter((b) => b.domain === bm.domain).map((b) => b.id);
        await db.put("clusters", {
          id: domainClusterId,
          name: bm.domain,
          type: "domain",
          bookmarkIds: ids,
        });
        console.log(`[monitor] New cluster detected: ${bm.domain} (${domainCount} bookmarks)`);
      }
    }
  }

  // Check session extension — if within 30min of most recent session
  const SESSION_GAP = 30 * 60 * 1000;
  const sessions = await db.getAll("sessions");
  if (sessions.length > 0) {
    const sorted = sessions.sort((a, b) => b.endTime - a.endTime);
    const latest = sorted[0];
    if (bm.dateAdded - latest.endTime <= SESSION_GAP) {
      if (!latest.bookmarkIds.includes(bm.id)) {
        latest.bookmarkIds.push(bm.id);
        latest.endTime = bm.dateAdded;
        latest.bookmarkCount = latest.bookmarkIds.length;
        await db.put("sessions", latest);
      }
    }
  }
}

// ── Resolve folder path from Chrome bookmark parent chain ──

async function resolveFolderPath(parentId: string | undefined): Promise<string> {
  if (!parentId) return "";
  const parts: string[] = [];
  let id: string | undefined = parentId;
  while (id) {
    try {
      const nodes: chrome.bookmarks.BookmarkTreeNode[] = await chrome.bookmarks.get(id);
      if (nodes.length === 0) break;
      const node: chrome.bookmarks.BookmarkTreeNode = nodes[0];
      if (node.title) parts.unshift(node.title);
      id = node.parentId;
    } catch {
      break;
    }
  }
  return parts.join("/");
}

// ── Install ──

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const result = await importAllBookmarks();
    console.log(`Aftermark: imported ${result.total} bookmarks (${result.duplicates} duplicates) on install.`);
    await buildAllClusters();
    await buildSessions();
  }
  await updateBadge();
});

// ── Bookmark event listeners ──

// Prevent re-entrant handling when we create/remove bookmarks ourselves
let suppressEvents = false;

chrome.bookmarks.onCreated.addListener(async (id, node) => {
  if (suppressEvents || !node.url) return;
  try {
    const folderPath = await resolveFolderPath(node.parentId);
    const classification = classifyBookmark({
      url: node.url,
      title: node.title || "",
      folderPath,
    });

    const bm: Bookmark = {
      id,
      url: node.url,
      normalizedUrl: normalizeUrl(node.url),
      title: node.title || "",
      folderPath,
      domain: classification.domain,
      contentType: classification.contentType,
      dateAdded: node.dateAdded ?? Date.now(),
      tags: classification.tags,
      status: "active",
    };
    bm.healthScore = computeHealthScore(bm);

    const db = await getDB();
    await db.put("bookmarks", bm);

    await integrateIntoCluster(bm);
    await captureTabContext(id, node.url);
    await updateBadge();
    notifyTabsChanged();

    console.log(`[monitor] Bookmark created: "${bm.title}" (${bm.domain}, ${bm.contentType})`);
  } catch (err) {
    console.error("[monitor] onCreated error:", err);
  }
});

chrome.bookmarks.onChanged.addListener(async (id, changeInfo) => {
  if (suppressEvents) return;
  try {
    const db = await getDB();
    const bm = await db.get("bookmarks", id);
    if (!bm) return;

    if (changeInfo.title !== undefined) bm.title = changeInfo.title;
    if (changeInfo.url !== undefined) {
      bm.url = changeInfo.url;
      bm.normalizedUrl = normalizeUrl(changeInfo.url);
    }

    const classification = classifyBookmark({
      url: bm.url,
      title: bm.title,
      folderPath: bm.folderPath,
    });
    bm.domain = classification.domain;
    bm.contentType = classification.contentType;
    bm.tags = classification.tags;
    bm.healthScore = computeHealthScore(bm);

    await db.put("bookmarks", bm);
    notifyTabsChanged();

    console.log(`[monitor] Bookmark changed: "${bm.title}"`);
  } catch (err) {
    console.error("[monitor] onChanged error:", err);
  }
});

chrome.bookmarks.onRemoved.addListener(async (id) => {
  if (suppressEvents) return;
  try {
    const db = await getDB();
    const exists = await db.get("bookmarks", id);
    if (!exists) return;

    await db.delete("bookmarks", id);
    await pruneEmptyClusters(new Set([id]));
    await updateBadge();
    notifyTabsChanged();

    console.log(`[monitor] Bookmark removed externally: ${id}`);
  } catch (err) {
    console.error("[monitor] onRemoved error:", err);
  }
});

chrome.bookmarks.onMoved.addListener(async (id, moveInfo) => {
  if (suppressEvents) return;
  try {
    const db = await getDB();
    const bm = await db.get("bookmarks", id);
    if (!bm) return;

    const folderPath = await resolveFolderPath(moveInfo.parentId);
    bm.folderPath = folderPath;

    const classification = classifyBookmark({
      url: bm.url,
      title: bm.title,
      folderPath,
    });
    bm.domain = classification.domain;
    bm.contentType = classification.contentType;
    bm.tags = classification.tags;
    bm.healthScore = computeHealthScore(bm);

    await db.put("bookmarks", bm);
    notifyTabsChanged();

    console.log(`[monitor] Bookmark moved: "${bm.title}" → ${folderPath}`);
  } catch (err) {
    console.error("[monitor] onMoved error:", err);
  }
});

// ── Helper: prune empty clusters ──

async function pruneEmptyClusters(deletedIds?: Set<string>): Promise<string[]> {
  const db = await getDB();
  const clusters = await db.getAll("clusters");
  const removed: string[] = [];
  const tx = db.transaction("clusters", "readwrite");
  for (const cluster of clusters) {
    if (deletedIds) {
      cluster.bookmarkIds = cluster.bookmarkIds.filter((id: string) => !deletedIds.has(id));
      await tx.store.put(cluster);
    }
    if (cluster.bookmarkIds.length === 0) {
      await tx.store.delete(cluster.id);
      removed.push(cluster.id);
    }
  }
  await tx.done;
  if (removed.length > 0) console.log(`[clusters] pruned ${removed.length} empty clusters`);
  return removed;
}

// ── Message handler ──

type Msg = Record<string, any>;

function handle(message: Msg, sendResponse: (r: any) => void): boolean {
  switch (message.type) {
    case "getStats":
      getBookmarkStats().then(sendResponse).catch(() => sendResponse({ total: 0, duplicates: 0, dead: 0 }));
      return true;

    case "getAllBookmarks":
      getAllBookmarks().then((bookmarks) => sendResponse({ bookmarks })).catch(() => sendResponse({ bookmarks: [] }));
      return true;

    case "reimportBookmarks":
      importAllBookmarks()
        .then(async (result) => { await buildAllClusters(); await buildSessions(); await updateBadge(); sendResponse(result); })
        .catch(() => sendResponse({ total: 0, duplicates: 0 }));
      return true;

    case "checkDeadLinks":
      checkDeadLinks((progress) => {
        chrome.runtime.sendMessage({ type: "linkCheckProgress", ...progress }).catch(() => {});
      }).then((dead) => sendResponse({ dead })).catch(() => sendResponse({ dead: 0 }));
      return true;

    case "getClusters":
      getAllClusters().then((clusters) => sendResponse({ clusters })).catch(() => sendResponse({ clusters: [] }));
      return true;

    case "rebuildClusters":
      buildAllClusters().then((count) => sendResponse({ count })).catch(() => sendResponse({ count: 0 }));
      return true;

    case "getSessions":
      getAllSessions().then((sessions) => sendResponse({ sessions })).catch(() => sendResponse({ sessions: [] }));
      return true;

    // ── Cleanup wizard handlers ──
    case "bulkDeleteDuplicates":
      (async () => {
        const db = await getDB();
        const all = await db.getAll("bookmarks");
        const groups = new Map<string, typeof all>();
        for (const bm of all) {
          if (bm.status !== "duplicate") continue;
          const key = bm.canonicalId || bm.normalizedUrl;
          const g = groups.get(key);
          if (g) g.push(bm); else groups.set(key, [bm]);
        }
        let deleted = 0;
        suppressEvents = true;
        const tx = db.transaction("bookmarks", "readwrite");
        for (const [, dupes] of groups) {
          for (const d of dupes) {
            await tx.store.delete(d.id);
            try { await chrome.bookmarks.remove(d.id); } catch {}
            deleted++;
          }
        }
        await tx.done;
        suppressEvents = false;
        await pruneEmptyClusters(new Set(all.filter((b) => b.status === "duplicate").map((b) => b.id)));
        await updateBadge();
        sendResponse({ ok: true, deleted });
      })().catch(() => { suppressEvents = false; sendResponse({ ok: false, deleted: 0 }); });
      return true;

    case "bulkDeleteDead":
      (async () => {
        const db = await getDB();
        const all = await db.getAll("bookmarks");
        const dead = all.filter((b) => b.status === "dead");
        let deleted = 0;
        suppressEvents = true;
        const tx = db.transaction("bookmarks", "readwrite");
        for (const bm of dead) {
          await tx.store.delete(bm.id);
          try { await chrome.bookmarks.remove(bm.id); } catch {}
          deleted++;
        }
        await tx.done;
        suppressEvents = false;
        await pruneEmptyClusters(new Set(dead.map((b) => b.id)));
        await updateBadge();
        sendResponse({ ok: true, deleted });
      })().catch(() => { suppressEvents = false; sendResponse({ ok: false, deleted: 0 }); });
      return true;

    case "getSingleVisitDomains":
      (async () => {
        const db = await getDB();
        const all = await db.getAll("bookmarks");
        const dc = new Map<string, string[]>();
        for (const bm of all) {
          if (!bm.domain || bm.status === "excluded") continue;
          const ids = dc.get(bm.domain);
          if (ids) ids.push(bm.id); else dc.set(bm.domain, [bm.id]);
        }
        const singles: { id: string; title: string; url: string; domain: string }[] = [];
        for (const [domain, ids] of dc) {
          if (ids.length === 1) {
            const bm = all.find((b) => b.id === ids[0]);
            if (bm) singles.push({ id: bm.id, title: bm.title, url: bm.url, domain });
          }
        }
        sendResponse({ singles });
      })().catch(() => sendResponse({ singles: [] }));
      return true;

    case "getEmptyFolders":
      (async () => {
        const db = await getDB();
        const all = await db.getAll("bookmarks");
        const now = Date.now();
        const sixMonths = 180 * 24 * 60 * 60 * 1000;
        const folders = new Map<string, typeof all>();
        for (const bm of all) {
          if (!bm.folderPath) continue;
          const list = folders.get(bm.folderPath);
          if (list) list.push(bm); else folders.set(bm.folderPath, [bm]);
        }
        const deadFolders: { name: string; count: number }[] = [];
        for (const [name, bms] of folders) {
          const allDead = bms.every((b) =>
            b.status === "dead" || b.status === "excluded" ||
            (b.status === "active" && (now - b.dateAdded > sixMonths) && (!b.dateLastUsed || b.dateLastUsed === b.dateAdded))
          );
          if (allDead) deadFolders.push({ name, count: bms.length });
        }
        deadFolders.sort((a, b) => b.count - a.count);
        sendResponse({ folders: deadFolders });
      })().catch(() => sendResponse({ folders: [] }));
      return true;

    case "getWizardStep":
      chrome.storage.local.get("wizardStep", (result) => {
        sendResponse({ step: result.wizardStep ?? 0 });
      });
      return true;

    case "setWizardStep":
      chrome.storage.local.set({ wizardStep: message.step }, () => sendResponse({ ok: true }));
      return true;

    case "getSavedFilters":
      chrome.storage.local.get("savedFilters", (result) => {
        sendResponse({ filters: result.savedFilters || [] });
      });
      return true;

    case "saveFilter":
      chrome.storage.local.get("savedFilters", (result) => {
        const filters = (result.savedFilters || []) as any[];
        filters.push(message.filter);
        chrome.storage.local.set({ savedFilters: filters }, () => sendResponse({ ok: true }));
      });
      return true;

    case "deleteFilter":
      chrome.storage.local.get("savedFilters", (result) => {
        const filters = ((result.savedFilters || []) as any[]).filter((_: any, i: number) => i !== message.index);
        chrome.storage.local.set({ savedFilters: filters }, () => sendResponse({ ok: true }));
      });
      return true;

    case "openAftermarkTab":
      chrome.tabs.create({ url: chrome.runtime.getURL("src/tab/tab.html") });
      sendResponse({ ok: true });
      return true;

    // ── CRUD: Delete ──
    case "deleteBookmark":
      (async () => {
        const db = await getDB();
        await db.delete("bookmarks", message.bookmarkId);
        suppressEvents = true;
        try { await chrome.bookmarks.remove(message.bookmarkId); } catch { /* may already be gone */ }
        suppressEvents = false;
        const pruned = await pruneEmptyClusters(new Set([message.bookmarkId]));
        await updateBadge();
        sendResponse({ ok: true, prunedClusters: pruned });
      })().catch(() => sendResponse({ ok: false }));
      return true;

    case "bulkDelete":
      (async () => {
        const ids = message.bookmarkIds as string[];
        const db = await getDB();
        const tx = db.transaction("bookmarks", "readwrite");
        suppressEvents = true;
        for (const id of ids) {
          await tx.store.delete(id);
          try { await chrome.bookmarks.remove(id); } catch { /* ignore */ }
        }
        suppressEvents = false;
        await tx.done;
        const pruned = await pruneEmptyClusters(new Set(ids));
        await updateBadge();
        sendResponse({ ok: true, count: ids.length, prunedClusters: pruned });
      })().catch(() => { suppressEvents = false; sendResponse({ ok: false, count: 0 }); });
      return true;

    // ── CRUD: Update ──
    case "updateBookmark":
      (async () => {
        const db = await getDB();
        const bm = await db.get("bookmarks", message.bookmarkId);
        if (!bm) { sendResponse({ ok: false }); return; }
        if (message.title !== undefined) bm.title = message.title;
        if (message.tags !== undefined) bm.tags = message.tags;
        if (message.status !== undefined) {
          bm.status = message.status;
          if (message.status !== "duplicate") delete bm.canonicalId;
        }
        await db.put("bookmarks", bm);
        suppressEvents = true;
        if (message.title !== undefined) {
          try { await chrome.bookmarks.update(message.bookmarkId, { title: message.title }); } catch { /* ignore */ }
        }
        suppressEvents = false;
        sendResponse({ ok: true, bookmark: bm });
      })().catch(() => { suppressEvents = false; sendResponse({ ok: false }); });
      return true;

    case "updateBookmarkStatus":
      (async () => {
        const db = await getDB();
        const bm = await db.get("bookmarks", message.bookmarkId);
        if (bm) {
          bm.status = message.status;
          if (message.status !== "duplicate") delete bm.canonicalId;
          await db.put("bookmarks", bm);
        }
        sendResponse({ ok: true });
      })().catch(() => sendResponse({ ok: false }));
      return true;

    case "bulkExclude":
      (async () => {
        const db = await getDB();
        const tx = db.transaction("bookmarks", "readwrite");
        for (const id of message.bookmarkIds as string[]) {
          const bm = await tx.store.get(id);
          if (bm) {
            bm.status = "excluded";
            delete bm.canonicalId;
            await tx.store.put(bm);
          }
        }
        await tx.done;
        sendResponse({ ok: true, count: (message.bookmarkIds as string[]).length });
      })().catch(() => sendResponse({ ok: false, count: 0 }));
      return true;

    // ── CRUD: Create ──
    case "createBookmark":
      (async () => {
        suppressEvents = true;
        const bm = await createBookmark(message.url, message.title, message.folderPath, message.tags);
        suppressEvents = false;
        await integrateIntoCluster(bm);
        await updateBadge();
        sendResponse({ ok: true, bookmark: bm });
      })().catch((err) => { suppressEvents = false; console.error("[sw] createBookmark error:", err); sendResponse({ ok: false }); });
      return true;

    // ── Cluster management ──
    case "removeFromCluster":
      (async () => {
        const db = await getDB();
        const cluster = await db.get("clusters", message.clusterId);
        let clusterDeleted = false;
        if (cluster) {
          cluster.bookmarkIds = cluster.bookmarkIds.filter((id: string) => id !== message.bookmarkId);
          if (cluster.bookmarkIds.length === 0) {
            await db.delete("clusters", message.clusterId);
            clusterDeleted = true;
          } else {
            await db.put("clusters", cluster);
          }
        }
        sendResponse({ ok: true, clusterDeleted });
      })().catch(() => sendResponse({ ok: false }));
      return true;

    case "renameCluster":
      (async () => {
        const db = await getDB();
        const cluster = await db.get("clusters", message.clusterId);
        if (cluster) {
          cluster.name = message.name;
          await db.put("clusters", cluster);
        }
        sendResponse({ ok: true });
      })().catch(() => sendResponse({ ok: false }));
      return true;

    case "mergeClusters":
      (async () => {
        const db = await getDB();
        const source = await db.get("clusters", message.sourceId);
        const target = await db.get("clusters", message.targetId);
        if (source && target) {
          const merged = new Set([...target.bookmarkIds, ...source.bookmarkIds]);
          target.bookmarkIds = [...merged];
          await db.put("clusters", target);
          await db.delete("clusters", message.sourceId);
        }
        sendResponse({ ok: true });
      })().catch(() => sendResponse({ ok: false }));
      return true;

    default:
      return false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  return handle(message, sendResponse);
});
