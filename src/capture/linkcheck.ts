import { getDB } from "../db/database";
import type { Bookmark } from "../models/types";

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500;

export interface LinkCheckProgress {
  checked: number;
  total: number;
  dead: number;
}

async function checkSingle(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch {
    // Network error or timeout — try GET as fallback (some servers reject HEAD)
    try {
      const response = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function checkDeadLinks(
  onProgress?: (progress: LinkCheckProgress) => void
): Promise<number> {
  const db = await getDB();
  const all = await db.getAll("bookmarks");

  // Only check active bookmarks with http(s) URLs
  const toCheck = all.filter(
    (bm) =>
      bm.status === "active" && /^https?:\/\//.test(bm.url)
  );

  let checked = 0;
  let dead = 0;
  const total = toCheck.length;

  for (let i = 0; i < toCheck.length; i += BATCH_SIZE) {
    const batch = toCheck.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (bm): Promise<[Bookmark, boolean]> => {
        const alive = await checkSingle(bm.url);
        return [bm, alive];
      })
    );

    const tx = db.transaction("bookmarks", "readwrite");
    for (const [bm, alive] of results) {
      if (!alive) {
        bm.status = "dead";
        await tx.store.put(bm);
        dead++;
      }
      checked++;
    }
    await tx.done;

    if (onProgress) {
      onProgress({ checked, total, dead });
    }

    // Delay between batches (skip after last batch)
    if (i + BATCH_SIZE < toCheck.length) {
      await delay(BATCH_DELAY_MS);
    }
  }

  return dead;
}
