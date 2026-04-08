import { getDB } from "../db/database";
import type { Bookmark, ContentType, Session } from "../models/types";

const SESSION_GAP_MS = 30 * 60 * 1000;

function dominant<T extends string>(items: T[]): T {
  const counts = new Map<T, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  let best = items[0];
  let bestCount = 0;
  for (const [val, count] of counts) {
    if (count > bestCount) {
      best = val;
      bestCount = count;
    }
  }
  return best;
}

export async function buildSessions(): Promise<number> {
  const db = await getDB();
  const bookmarks = await db.getAll("bookmarks");
  const sorted = bookmarks.sort((a, b) => a.dateAdded - b.dateAdded);

  const sessions: Session[] = [];
  let current: Bookmark[] = [];

  function flushSession() {
    if (current.length < 1) return;
    const ids = current.map((b) => b.id);
    sessions.push({
      id: `session:${current[0].dateAdded}`,
      startTime: current[0].dateAdded,
      endTime: current[current.length - 1].dateAdded,
      bookmarkIds: ids,
      dominantDomain: dominant(current.map((b) => b.domain).filter(Boolean)),
      dominantContentType: dominant(current.map((b) => b.contentType).filter(Boolean) as ContentType[]) || "unknown",
      bookmarkCount: current.length,
    });
  }

  for (const bm of sorted) {
    if (current.length === 0) {
      current.push(bm);
      continue;
    }
    const last = current[current.length - 1];
    if (bm.dateAdded - last.dateAdded <= SESSION_GAP_MS) {
      current.push(bm);
    } else {
      flushSession();
      current = [bm];
    }
  }
  flushSession();

  // Store in IndexedDB
  const tx = db.transaction("sessions", "readwrite");
  await tx.store.clear();
  for (const session of sessions) {
    await tx.store.put(session);
  }
  await tx.done;

  console.log(`[sessions] built ${sessions.length} sessions`);
  return sessions.length;
}

export async function getAllSessions(): Promise<Session[]> {
  const db = await getDB();
  return db.getAll("sessions");
}
