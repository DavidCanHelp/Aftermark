import {
  importAllBookmarks,
  getBookmarkStats,
  getAllBookmarks,
} from "../capture/import";
import { checkDeadLinks } from "../capture/linkcheck";
import { buildAllClusters, getAllClusters } from "../capture/clusters";
import { buildSessions, getAllSessions } from "../capture/sessions";

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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "getStats") {
    getBookmarkStats()
      .then((stats) => sendResponse(stats))
      .catch((err) => {
        console.error("[sw] getStats error:", err);
        sendResponse({ total: 0, duplicates: 0, dead: 0 });
      });
    return true;
  }

  if (message.type === "getAllBookmarks") {
    getAllBookmarks()
      .then((bookmarks) => sendResponse({ bookmarks }))
      .catch((err) => {
        console.error("[sw] getAllBookmarks error:", err);
        sendResponse({ bookmarks: [] });
      });
    return true;
  }

  if (message.type === "reimportBookmarks") {
    importAllBookmarks()
      .then(async (result) => {
        await buildAllClusters();
        await buildSessions();
        sendResponse(result);
      })
      .catch((err) => {
        console.error("[sw] reimport error:", err);
        sendResponse({ total: 0, duplicates: 0 });
      });
    return true;
  }

  if (message.type === "checkDeadLinks") {
    checkDeadLinks((progress) => {
      chrome.runtime.sendMessage({
        type: "linkCheckProgress",
        ...progress,
      }).catch(() => {});
    })
      .then((dead) => sendResponse({ dead }))
      .catch((err) => {
        console.error("[sw] checkDeadLinks error:", err);
        sendResponse({ dead: 0 });
      });
    return true;
  }

  if (message.type === "getClusters") {
    getAllClusters()
      .then((clusters) => sendResponse({ clusters }))
      .catch((err) => {
        console.error("[sw] getClusters error:", err);
        sendResponse({ clusters: [] });
      });
    return true;
  }

  if (message.type === "rebuildClusters") {
    buildAllClusters()
      .then((count) => sendResponse({ count }))
      .catch((err) => {
        console.error("[sw] rebuildClusters error:", err);
        sendResponse({ count: 0 });
      });
    return true;
  }

  if (message.type === "getSessions") {
    getAllSessions()
      .then((sessions) => sendResponse({ sessions }))
      .catch((err) => {
        console.error("[sw] getSessions error:", err);
        sendResponse({ sessions: [] });
      });
    return true;
  }

  if (message.type === "updateBookmarkStatus") {
    import("../db/database").then(async ({ getDB }) => {
      const db = await getDB();
      const bm = await db.get("bookmarks", message.bookmarkId);
      if (bm) {
        bm.status = message.status;
        if (message.status !== "duplicate") {
          delete bm.canonicalId;
        }
        await db.put("bookmarks", bm);
      }
      sendResponse({ ok: true });
    }).catch((err) => {
      console.error("[sw] updateBookmarkStatus error:", err);
      sendResponse({ ok: false });
    });
    return true;
  }

  if (message.type === "openAftermarkTab") {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/tab/tab.html") });
    sendResponse({ ok: true });
    return true;
  }
});
