import type { BookmarkStats } from "../capture/import";

const countEl = document.getElementById("count")!;
const openBtn = document.getElementById("open")!;
const settingsBtn = document.getElementById("settings")!;

function sendMessage<T>(message: { type: string }): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

async function init() {
  const stats = await sendMessage<BookmarkStats>({ type: "getStats" });
  countEl.textContent = String(stats.total);
}

openBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/tab/tab.html") });
  window.close();
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

init();
