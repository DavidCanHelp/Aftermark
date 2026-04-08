import {
  importAllBookmarks,
  getBookmarkStats,
  getAllBookmarks,
} from "../capture/import";
import { checkDeadLinks } from "../capture/linkcheck";

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    const result = await importAllBookmarks();
    console.log(
      `Aftermark: imported ${result.total} bookmarks (${result.duplicates} duplicates) on install.`
    );
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
      .then((result) => sendResponse(result))
      .catch((err) => {
        console.error("[sw] reimport error:", err);
        sendResponse({ total: 0, duplicates: 0 });
      });
    return true;
  }

  if (message.type === "checkDeadLinks") {
    checkDeadLinks((progress) => {
      // Send progress updates via a separate mechanism
      chrome.runtime.sendMessage({
        type: "linkCheckProgress",
        ...progress,
      }).catch(() => {
        // popup may be closed, ignore
      });
    })
      .then((dead) => sendResponse({ dead }))
      .catch((err) => {
        console.error("[sw] checkDeadLinks error:", err);
        sendResponse({ dead: 0 });
      });
    return true;
  }
});
