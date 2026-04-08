import { getDB } from "../db/database";
import type { Bookmark, Cluster } from "../models/types";

const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes
const DOMAIN_CLUSTER_MIN = 5;

function makeId(prefix: string, key: string): string {
  return `${prefix}:${key.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}`;
}

function dominantValue(items: string[]): string {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [val, count] of counts) {
    if (count > bestCount) {
      best = val;
      bestCount = count;
    }
  }
  return best;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// a) Domain clusters: 5+ bookmarks sharing a domain
function buildDomainClusters(bookmarks: Bookmark[]): Cluster[] {
  const groups = new Map<string, string[]>();
  for (const bm of bookmarks) {
    if (!bm.domain) continue;
    const ids = groups.get(bm.domain);
    if (ids) ids.push(bm.id);
    else groups.set(bm.domain, [bm.id]);
  }

  const clusters: Cluster[] = [];
  for (const [domain, ids] of groups) {
    if (ids.length >= DOMAIN_CLUSTER_MIN) {
      clusters.push({
        id: makeId("domain", domain),
        name: domain,
        type: "domain",
        bookmarkIds: ids,
      });
    }
  }
  return clusters;
}

// b) Folder clusters: mirror bookmark folder structure
function buildFolderClusters(bookmarks: Bookmark[]): Cluster[] {
  const groups = new Map<string, string[]>();
  for (const bm of bookmarks) {
    if (!bm.folderPath) continue;
    const ids = groups.get(bm.folderPath);
    if (ids) ids.push(bm.id);
    else groups.set(bm.folderPath, [bm.id]);
  }

  const clusters: Cluster[] = [];
  for (const [folder, ids] of groups) {
    if (ids.length < 2) continue;
    clusters.push({
      id: makeId("folder", folder),
      name: folder,
      type: "folder",
      bookmarkIds: ids,
    });
  }
  return clusters;
}

// c) Time session clusters: bookmarks within 30-minute windows
function buildSessionClusters(bookmarks: Bookmark[]): Cluster[] {
  const sorted = [...bookmarks].sort((a, b) => a.dateAdded - b.dateAdded);
  const clusters: Cluster[] = [];
  let current: Bookmark[] = [];

  for (const bm of sorted) {
    if (current.length === 0) {
      current.push(bm);
      continue;
    }
    const last = current[current.length - 1];
    if (bm.dateAdded - last.dateAdded <= SESSION_GAP_MS) {
      current.push(bm);
    } else {
      if (current.length >= 2) {
        const dom = dominantValue(current.map((b) => b.domain));
        const date = formatDate(current[0].dateAdded);
        clusters.push({
          id: makeId("session", `${current[0].dateAdded}`),
          name: `${dom} research — ${date}`,
          type: "session",
          bookmarkIds: current.map((b) => b.id),
        });
      }
      current = [bm];
    }
  }
  // Flush last group
  if (current.length >= 2) {
    const dom = dominantValue(current.map((b) => b.domain));
    const date = formatDate(current[0].dateAdded);
    clusters.push({
      id: makeId("session", `${current[0].dateAdded}`),
      name: `${dom} research — ${date}`,
      type: "session",
      bookmarkIds: current.map((b) => b.id),
    });
  }
  return clusters;
}

// d) URL path clusters: multiple pages from same base path
function buildPathClusters(bookmarks: Bookmark[]): Cluster[] {
  const groups = new Map<string, string[]>();
  for (const bm of bookmarks) {
    try {
      const u = new URL(bm.url);
      const pathParts = u.pathname.split("/").filter(Boolean);
      if (pathParts.length >= 2) {
        const basePath = `${u.hostname}/${pathParts[0]}/${pathParts[1]}`;
        const ids = groups.get(basePath);
        if (ids) ids.push(bm.id);
        else groups.set(basePath, [bm.id]);
      }
    } catch {
      // skip malformed
    }
  }

  const clusters: Cluster[] = [];
  for (const [path, ids] of groups) {
    if (ids.length < 3) continue;
    clusters.push({
      id: makeId("path", path),
      name: path,
      type: "learning",
      bookmarkIds: ids,
    });
  }
  return clusters;
}

// e) Shopping/decision clusters: shopping bookmarks close in time
function buildShoppingClusters(bookmarks: Bookmark[]): Cluster[] {
  const shopping = bookmarks
    .filter((bm) => bm.contentType === "shopping")
    .sort((a, b) => a.dateAdded - b.dateAdded);

  if (shopping.length < 2) return [];

  const clusters: Cluster[] = [];
  let current: Bookmark[] = [shopping[0]];

  for (let i = 1; i < shopping.length; i++) {
    const bm = shopping[i];
    const last = current[current.length - 1];
    // 2-hour window for shopping sessions
    if (bm.dateAdded - last.dateAdded <= 2 * 60 * 60 * 1000) {
      current.push(bm);
    } else {
      if (current.length >= 2) {
        const date = formatDate(current[0].dateAdded);
        clusters.push({
          id: makeId("shopping", `${current[0].dateAdded}`),
          name: `Shopping comparison — ${date}`,
          type: "decision",
          bookmarkIds: current.map((b) => b.id),
        });
      }
      current = [bm];
    }
  }
  if (current.length >= 2) {
    const date = formatDate(current[0].dateAdded);
    clusters.push({
      id: makeId("shopping", `${current[0].dateAdded}`),
      name: `Shopping comparison — ${date}`,
      type: "decision",
      bookmarkIds: current.map((b) => b.id),
    });
  }
  return clusters;
}

// f) Project detection: GitHub org/repo with associated pages
function buildProjectClusters(bookmarks: Bookmark[]): Cluster[] {
  const projects = new Map<string, string[]>();

  for (const bm of bookmarks) {
    if (bm.domain !== "github.com") continue;
    try {
      const parts = new URL(bm.url).pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        const project = `${parts[0]}/${parts[1]}`;
        const ids = projects.get(project);
        if (ids) ids.push(bm.id);
        else projects.set(project, [bm.id]);
      }
    } catch {
      // skip
    }
  }

  const clusters: Cluster[] = [];
  for (const [project, ids] of projects) {
    if (ids.length < 2) continue;
    clusters.push({
      id: makeId("project", project),
      name: `github/${project}`,
      type: "project",
      bookmarkIds: ids,
    });
  }
  return clusters;
}

export async function buildAllClusters(): Promise<number> {
  const db = await getDB();
  const bookmarks = await db.getAll("bookmarks");
  const active = bookmarks.filter((b) => b.status !== "excluded");

  const allClusters = [
    ...buildDomainClusters(active),
    ...buildFolderClusters(active),
    ...buildSessionClusters(active),
    ...buildPathClusters(active),
    ...buildShoppingClusters(active),
    ...buildProjectClusters(active),
  ];

  // Clear existing clusters and write new ones
  const tx = db.transaction("clusters", "readwrite");
  await tx.store.clear();
  for (const cluster of allClusters) {
    await tx.store.put(cluster);
  }
  await tx.done;

  console.log(`[clusters] built ${allClusters.length} clusters`);
  return allClusters.length;
}

export async function getAllClusters(): Promise<Cluster[]> {
  const db = await getDB();
  return db.getAll("clusters");
}
