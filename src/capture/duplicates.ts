import { getDB } from "../db/database";
import type { Bookmark } from "../models/types";

// Jaccard similarity on word tokens
function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  return intersection / (wordsA.size + wordsB.size - intersection);
}

export async function detectDuplicates(): Promise<number> {
  const db = await getDB();
  const all = await db.getAll("bookmarks");

  // ── Pass 1: Exact URL duplicates ──
  const groups = new Map<string, Bookmark[]>();
  for (const bm of all) {
    if (!bm.normalizedUrl) continue;
    const group = groups.get(bm.normalizedUrl);
    if (group) group.push(bm);
    else groups.set(bm.normalizedUrl, [bm]);
  }

  const multiGroups = [...groups.values()].filter((g) => g.length > 1);
  console.log(
    `[duplicates] ${all.length} bookmarks, ${groups.size} unique URLs, ${multiGroups.length} URLs with duplicates`
  );

  let duplicateCount = 0;
  const tx = db.transaction("bookmarks", "readwrite");

  for (const [, group] of groups) {
    if (group.length < 2) continue;
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

  // ── Pass 2: Fuzzy title duplicates within same domain ──
  const domainGroups = new Map<string, Bookmark[]>();
  for (const bm of all) {
    if (!bm.domain || bm.status === "duplicate" || bm.status === "excluded") continue;
    const list = domainGroups.get(bm.domain);
    if (list) list.push(bm);
    else domainGroups.set(bm.domain, [bm]);
  }

  let fuzzyCount = 0;
  const tx2 = db.transaction("bookmarks", "readwrite");

  for (const [, domBms] of domainGroups) {
    if (domBms.length < 2) continue;
    const flagged = new Set<string>();
    for (let i = 0; i < domBms.length; i++) {
      if (flagged.has(domBms[i].id)) continue;
      for (let j = i + 1; j < domBms.length; j++) {
        if (flagged.has(domBms[j].id)) continue;
        if (domBms[i].normalizedUrl === domBms[j].normalizedUrl) continue; // already exact dupe
        const sim = jaccardSimilarity(domBms[i].title, domBms[j].title);
        if (sim > 0.8) {
          // Mark the newer one as likely-duplicate
          const [older, newer] = domBms[i].dateAdded <= domBms[j].dateAdded
            ? [domBms[i], domBms[j]]
            : [domBms[j], domBms[i]];
          if (newer.status === "active") {
            newer.status = "likely-duplicate";
            newer.canonicalId = older.id;
            await tx2.store.put(newer);
            flagged.add(newer.id);
            fuzzyCount++;
          }
        }
      }
    }
  }
  await tx2.done;

  console.log(`[duplicates] marked ${duplicateCount} exact, ${fuzzyCount} fuzzy duplicates`);
  return duplicateCount + fuzzyCount;
}
