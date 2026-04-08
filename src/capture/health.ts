import { getDB } from "../db/database";
import type { Bookmark } from "../models/types";

export function computeHealthScore(bm: Bookmark): number {
  let score = 100;
  const now = Date.now();
  const ageMonths = (now - bm.dateAdded) / (30 * 24 * 60 * 60 * 1000);
  score -= Math.min(30, Math.floor(ageMonths));
  if (!bm.dateLastUsed || bm.dateLastUsed === bm.dateAdded) score -= 20;
  if (bm.status === "dead") score -= 30;
  if (bm.status === "duplicate" || bm.status === "likely-duplicate") score -= 15;
  if (bm.contentType === "unknown") score -= 10;
  return Math.max(0, score);
}

export async function computeAllHealthScores(): Promise<void> {
  const db = await getDB();
  const all = await db.getAll("bookmarks");
  const tx = db.transaction("bookmarks", "readwrite");
  for (const bm of all) {
    bm.healthScore = computeHealthScore(bm);
    await tx.store.put(bm);
  }
  await tx.done;
  console.log(`[health] computed scores for ${all.length} bookmarks`);
}
