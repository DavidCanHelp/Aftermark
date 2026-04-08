import {
  importAllBookmarks,
  getBookmarkStats,
  getAllBookmarks,
  createBookmark,
} from "../capture/import";
import { checkDeadLinks } from "../capture/linkcheck";
import { buildAllClusters, getAllClusters } from "../capture/clusters";
import { buildSessions, getAllSessions } from "../capture/sessions";
import { getDB } from "../db/database";

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const result = await importAllBookmarks();
    console.log(
      `Aftermark: imported ${result.total} bookmarks (${result.duplicates} duplicates) on install.`
    );
    await buildAllClusters();
    await buildSessions();
  }
});

type Msg = Record<string, any>;

async function pruneEmptyClusters(deletedIds?: Set<string>): Promise<string[]> {
  const db = await getDB();
  const clusters = await db.getAll("clusters");
  const removed: string[] = [];
  const tx = db.transaction("clusters", "readwrite");
  for (const cluster of clusters) {
    // If deletedIds provided, filter them out first
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
  if (removed.length > 0) {
    console.log(`[clusters] pruned ${removed.length} empty clusters`);
  }
  return removed;
}

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
        .then(async (result) => { await buildAllClusters(); await buildSessions(); sendResponse(result); })
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

    case "openAftermarkTab":
      chrome.tabs.create({ url: chrome.runtime.getURL("src/tab/tab.html") });
      sendResponse({ ok: true });
      return true;

    // ── CRUD: Delete ──
    case "deleteBookmark":
      (async () => {
        const db = await getDB();
        await db.delete("bookmarks", message.bookmarkId);
        try { await chrome.bookmarks.remove(message.bookmarkId); } catch { /* may already be gone */ }
        const pruned = await pruneEmptyClusters(new Set([message.bookmarkId]));
        sendResponse({ ok: true, prunedClusters: pruned });
      })().catch(() => sendResponse({ ok: false }));
      return true;

    case "bulkDelete":
      (async () => {
        const ids = message.bookmarkIds as string[];
        const db = await getDB();
        const tx = db.transaction("bookmarks", "readwrite");
        for (const id of ids) {
          await tx.store.delete(id);
          try { await chrome.bookmarks.remove(id); } catch { /* ignore */ }
        }
        await tx.done;
        const pruned = await pruneEmptyClusters(new Set(ids));
        sendResponse({ ok: true, count: ids.length, prunedClusters: pruned });
      })().catch(() => sendResponse({ ok: false, count: 0 }));
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
        // Sync title back to Chrome bookmarks
        if (message.title !== undefined) {
          try { await chrome.bookmarks.update(message.bookmarkId, { title: message.title }); } catch { /* ignore */ }
        }
        sendResponse({ ok: true, bookmark: bm });
      })().catch(() => sendResponse({ ok: false }));
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
      createBookmark(message.url, message.title, message.folderPath, message.tags)
        .then((bm) => sendResponse({ ok: true, bookmark: bm }))
        .catch((err) => { console.error("[sw] createBookmark error:", err); sendResponse({ ok: false }); });
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
