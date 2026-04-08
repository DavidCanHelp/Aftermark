import { getDB } from "../db/database";
import type { Bookmark } from "../models/types";

export async function detectDuplicates(): Promise<number> {
  const db = await getDB();
  const all = await db.getAll("bookmarks");

  // Group by normalized URL
  const groups = new Map<string, Bookmark[]>();
  for (const bm of all) {
    const key = bm.normalizedUrl;
    if (!key) continue;
    const group = groups.get(key);
    if (group) {
      group.push(bm);
    } else {
      groups.set(key, [bm]);
    }
  }

  // Log grouping stats
  const multiGroups = [...groups.values()].filter((g) => g.length > 1);
  console.log(
    `[duplicates] ${all.length} bookmarks, ${groups.size} unique URLs, ${multiGroups.length} URLs with duplicates`
  );
  for (const group of multiGroups.slice(0, 10)) {
    console.log(
      `[duplicates]   ${group.length}x: ${group[0].normalizedUrl} (ids: ${group.map((b) => b.id).join(", ")})`
    );
  }
  if (multiGroups.length > 10) {
    console.log(`[duplicates]   ... and ${multiGroups.length - 10} more groups`);
  }

  let duplicateCount = 0;
  const tx = db.transaction("bookmarks", "readwrite");

  for (const [, group] of groups) {
    if (group.length < 2) continue;

    // Sort by dateAdded ascending — oldest is canonical
    group.sort((a, b) => a.dateAdded - b.dateAdded);
    const canonical = group[0];

    for (let i = 1; i < group.length; i++) {
      const dupe = group[i];
      dupe.status = "duplicate";
      dupe.canonicalId = canonical.id;
      await tx.store.put(dupe);
      duplicateCount++;
    }
  }

  await tx.done;
  console.log(`[duplicates] marked ${duplicateCount} bookmarks as duplicate`);
  return duplicateCount;
}
