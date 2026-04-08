import { getDB } from "../db/database";
import type { Bookmark } from "../models/types";
import { classifyBookmark, normalizeUrl } from "./heuristics";
import { detectDuplicates } from "./duplicates";

function flattenBookmarkTree(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  folderPath: string = ""
): Bookmark[] {
  const bookmarks: Bookmark[] = [];

  for (const node of nodes) {
    const currentPath = folderPath
      ? `${folderPath}/${node.title}`
      : node.title;

    if (node.url) {
      const classification = classifyBookmark({
        url: node.url,
        title: node.title || "",
        folderPath,
      });

      bookmarks.push({
        id: node.id,
        url: node.url,
        normalizedUrl: normalizeUrl(node.url),
        title: node.title || "",
        folderPath,
        domain: classification.domain,
        contentType: classification.contentType,
        dateAdded: node.dateAdded ?? Date.now(),
        tags: classification.tags,
        status: "active",
      });
    }

    if (node.children) {
      bookmarks.push(...flattenBookmarkTree(node.children, currentPath));
    }
  }

  return bookmarks;
}

export interface ImportResult {
  total: number;
  duplicates: number;
}

export async function importAllBookmarks(): Promise<ImportResult> {
  const tree = await chrome.bookmarks.getTree();
  const bookmarks = flattenBookmarkTree(tree);
  const db = await getDB();

  const tx = db.transaction("bookmarks", "readwrite");
  for (const bookmark of bookmarks) {
    await tx.store.put(bookmark);
  }
  await tx.done;

  const duplicates = await detectDuplicates();

  return { total: bookmarks.length, duplicates };
}

export async function getBookmarkCount(): Promise<number> {
  const db = await getDB();
  return db.count("bookmarks");
}

export interface BookmarkStats {
  total: number;
  duplicates: number;
  dead: number;
}

export async function getBookmarkStats(): Promise<BookmarkStats> {
  const db = await getDB();
  const all = await db.getAll("bookmarks");
  let duplicates = 0;
  let dead = 0;
  for (const bm of all) {
    if (bm.status === "duplicate") duplicates++;
    if (bm.status === "dead") dead++;
  }
  return { total: all.length, duplicates, dead };
}

export async function getAllBookmarks(): Promise<Bookmark[]> {
  const db = await getDB();
  return db.getAll("bookmarks");
}

export async function createBookmark(
  url: string,
  title: string | undefined,
  folderPath: string | undefined,
  tags: string[] | undefined
): Promise<Bookmark> {
  // Create in Chrome bookmarks first
  const created = await chrome.bookmarks.create({
    url,
    title: title || url,
  });

  const classification = classifyBookmark({
    url,
    title: title || created.title || "",
    folderPath: folderPath || "",
  });

  const bookmark: Bookmark = {
    id: created.id,
    url,
    normalizedUrl: normalizeUrl(url),
    title: title || created.title || "",
    folderPath: folderPath || "",
    domain: classification.domain,
    contentType: classification.contentType,
    dateAdded: created.dateAdded ?? Date.now(),
    tags: tags || classification.tags,
    status: "active",
  };

  const db = await getDB();
  await db.put("bookmarks", bookmark);
  return bookmark;
}
