import { getDB } from "../db/database";
import type { TagRecord, Bookmark } from "../models/types";

export async function rebuildTagRegistry(): Promise<void> {
  const db = await getDB();
  const all = await db.getAll("bookmarks");
  const counts = new Map<string, { count: number; isUser: boolean }>();

  for (const bm of all) {
    for (const t of bm.tags || []) {
      const existing = counts.get(t);
      const isUser = (bm.userTags || []).includes(t);
      if (existing) {
        existing.count++;
        if (isUser) existing.isUser = true;
      } else {
        counts.set(t, { count: 1, isUser });
      }
    }
  }

  const tx = db.transaction("tags", "readwrite");
  await tx.store.clear();
  for (const [name, { count, isUser }] of counts) {
    await tx.store.put({ name, count, isUser, color: "" });
  }
  await tx.done;
}

export async function getAllTags(): Promise<TagRecord[]> {
  const db = await getDB();
  const tags = await db.getAll("tags");
  return tags.sort((a, b) => b.count - a.count);
}

export async function addTagToBookmark(bookmarkId: string, tagName: string): Promise<Bookmark | null> {
  const db = await getDB();
  const bm = await db.get("bookmarks", bookmarkId);
  if (!bm) return null;

  const tag = tagName.toLowerCase().trim();
  if (!tag) return bm;

  if (!bm.tags) bm.tags = [];
  if (!bm.userTags) bm.userTags = [];
  if (!bm.tags.includes(tag)) bm.tags.push(tag);
  if (!bm.userTags.includes(tag)) bm.userTags.push(tag);
  await db.put("bookmarks", bm);

  // Update tag registry
  const existing = await db.get("tags", tag);
  if (existing) {
    existing.count++;
    existing.isUser = true;
    await db.put("tags", existing);
  } else {
    await db.put("tags", { name: tag, count: 1, isUser: true, color: "" });
  }

  return bm;
}

export async function removeTagFromBookmark(bookmarkId: string, tagName: string): Promise<Bookmark | null> {
  const db = await getDB();
  const bm = await db.get("bookmarks", bookmarkId);
  if (!bm) return null;

  bm.tags = (bm.tags || []).filter((t: string) => t !== tagName);
  bm.userTags = (bm.userTags || []).filter((t: string) => t !== tagName);
  await db.put("bookmarks", bm);

  // Update tag registry
  const existing = await db.get("tags", tagName);
  if (existing) {
    existing.count = Math.max(0, existing.count - 1);
    if (existing.count === 0) {
      await db.delete("tags", tagName);
    } else {
      await db.put("tags", existing);
    }
  }

  return bm;
}

export async function bulkAddTag(bookmarkIds: string[], tagName: string): Promise<number> {
  const db = await getDB();
  const tag = tagName.toLowerCase().trim();
  if (!tag) return 0;
  let added = 0;
  const tx = db.transaction("bookmarks", "readwrite");
  for (const id of bookmarkIds) {
    const bm = await tx.store.get(id);
    if (bm) {
      if (!bm.tags) bm.tags = [];
      if (!bm.userTags) bm.userTags = [];
      if (!bm.tags.includes(tag)) { bm.tags.push(tag); added++; }
      if (!bm.userTags.includes(tag)) bm.userTags.push(tag);
      await tx.store.put(bm);
    }
  }
  await tx.done;

  // Update registry
  const existing = await db.get("tags", tag);
  if (existing) {
    existing.count += added;
    existing.isUser = true;
    await db.put("tags", existing);
  } else {
    await db.put("tags", { name: tag, count: added, isUser: true, color: "" });
  }
  return added;
}

export async function renameTag(oldName: string, newName: string): Promise<number> {
  const db = await getDB();
  const newTag = newName.toLowerCase().trim();
  if (!newTag || oldName === newTag) return 0;

  const all = await db.getAll("bookmarks");
  let updated = 0;
  const tx = db.transaction("bookmarks", "readwrite");
  for (const bm of all) {
    const idx = (bm.tags || []).indexOf(oldName);
    if (idx >= 0) {
      bm.tags[idx] = newTag;
      if (!bm.tags.includes(newTag)) bm.tags = [...new Set(bm.tags)];
      const uidx = (bm.userTags || []).indexOf(oldName);
      if (uidx >= 0) {
        bm.userTags[uidx] = newTag;
        bm.userTags = [...new Set(bm.userTags)];
      }
      await tx.store.put(bm);
      updated++;
    }
  }
  await tx.done;

  // Update registry
  const oldRec = await db.get("tags", oldName);
  const newRec = await db.get("tags", newTag);
  if (oldRec) {
    await db.delete("tags", oldName);
    if (newRec) {
      newRec.count += oldRec.count;
      newRec.isUser = newRec.isUser || oldRec.isUser;
      await db.put("tags", newRec);
    } else {
      await db.put("tags", { ...oldRec, name: newTag });
    }
  }
  return updated;
}

export async function deleteTag(tagName: string): Promise<number> {
  const db = await getDB();
  const all = await db.getAll("bookmarks");
  let updated = 0;
  const tx = db.transaction("bookmarks", "readwrite");
  for (const bm of all) {
    if ((bm.tags || []).includes(tagName)) {
      bm.tags = bm.tags.filter((t: string) => t !== tagName);
      bm.userTags = (bm.userTags || []).filter((t: string) => t !== tagName);
      await tx.store.put(bm);
      updated++;
    }
  }
  await tx.done;
  await db.delete("tags", tagName);
  return updated;
}

export async function mergeTags(sourceTag: string, targetTag: string): Promise<number> {
  return renameTag(sourceTag, targetTag);
}

export async function setTagColor(tagName: string, color: string): Promise<void> {
  const db = await getDB();
  const rec = await db.get("tags", tagName);
  if (rec) {
    rec.color = color;
    await db.put("tags", rec);
  }
}

export async function getTagSuggestions(bookmarkId: string): Promise<string[]> {
  const db = await getDB();
  const bm = await db.get("bookmarks", bookmarkId);
  if (!bm) return [];

  const suggestions = new Set<string>();
  const all = await db.getAll("bookmarks");

  // Tags from same-domain bookmarks
  for (const other of all) {
    if (other.id === bm.id || other.domain !== bm.domain) continue;
    for (const t of other.userTags || []) suggestions.add(t);
  }

  // Content-type based suggestions
  const ctSuggestions: Record<string, string[]> = {
    "github-repo": ["dev", "tool", "library", "open-source"],
    docs: ["reference", "learning"],
    article: ["read-later", "research"],
    video: ["watch-later", "tutorial"],
    academic: ["research", "paper"],
    news: ["current-events"],
    shopping: ["wishlist", "compare"],
    "real-estate": ["housing", "compare"],
  };
  for (const s of ctSuggestions[bm.contentType] || []) suggestions.add(s);

  // Most-used user tags
  const tags = await db.getAll("tags");
  const topUser = tags.filter((t) => t.isUser).sort((a, b) => b.count - a.count).slice(0, 5);
  for (const t of topUser) suggestions.add(t.name);

  // Remove tags already on this bookmark
  for (const t of bm.tags || []) suggestions.delete(t);

  return [...suggestions].slice(0, 10);
}

export async function buildTagClusters(): Promise<number> {
  const db = await getDB();
  const all = await db.getAll("bookmarks");
  const TAG_CLUSTER_MIN = 3;

  // Group by user tags
  const tagGroups = new Map<string, string[]>();
  for (const bm of all) {
    if (bm.status === "excluded") continue;
    for (const t of bm.userTags || []) {
      const ids = tagGroups.get(t);
      if (ids) ids.push(bm.id); else tagGroups.set(t, [bm.id]);
    }
  }

  let created = 0;
  for (const [tag, ids] of tagGroups) {
    if (ids.length < TAG_CLUSTER_MIN) continue;
    const clusterId = `tag:${tag.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}`;
    const existing = await db.get("clusters", clusterId);
    if (existing) {
      existing.bookmarkIds = [...new Set(ids)];
      await db.put("clusters", existing);
    } else {
      await db.put("clusters", {
        id: clusterId,
        name: `#${tag}`,
        type: "tag" as any,
        bookmarkIds: ids,
      });
      created++;
    }
  }

  // Remove tag clusters whose tag no longer meets threshold
  const clusters = await db.getAll("clusters");
  for (const c of clusters) {
    if (c.type === "tag") {
      const tagName = c.name.startsWith("#") ? c.name.slice(1) : c.name;
      const group = tagGroups.get(tagName);
      if (!group || group.length < TAG_CLUSTER_MIN) {
        await db.delete("clusters", c.id);
      }
    }
  }

  return created;
}
