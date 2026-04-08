import type { DocumentSnapshot } from "../models/types";
import { getDB } from "../db/database";

export async function captureTabContext(bookmarkId: string, url: string): Promise<void> {
  // Try to find the tab with this URL to get richer metadata
  let tabTitle = "";
  let tabFavicon = "";

  try {
    const tabs = await chrome.tabs.query({ url });
    if (tabs.length > 0) {
      const tab = tabs[0];
      tabTitle = tab.title || "";
      tabFavicon = tab.favIconUrl || "";
    }
  } catch {
    // tabs.query may fail for chrome:// URLs etc.
  }

  // Extract domain from URL
  let domain = "";
  try {
    domain = new URL(url).hostname.replace(/^www\./, "");
  } catch { /* ignore */ }

  // Build a basic excerpt from URL path segments
  let excerpt = "";
  try {
    const u = new URL(url);
    const pathParts = u.pathname.split("/").filter(Boolean);
    if (pathParts.length > 0) {
      excerpt = pathParts.join(" / ").replace(/[-_]/g, " ").slice(0, 200);
    }
  } catch { /* ignore */ }

  const snapshot: DocumentSnapshot = {
    bookmarkId,
    title: tabTitle,
    domain,
    excerpt,
    contentHash: "",
    lastAnalyzedAt: Date.now(),
    analysisMode: "metadata-only",
  };

  const db = await getDB();
  await db.put("snapshots", snapshot);

  if (tabFavicon) {
    console.log(`[context] captured tab context for ${bookmarkId}: "${tabTitle}" favicon=${tabFavicon}`);
  }
}
