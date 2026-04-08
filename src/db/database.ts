import { openDB, deleteDB, type IDBPDatabase } from "idb";
import type {
  Bookmark,
  DocumentSnapshot,
  InferenceRecord,
  Cluster,
  ActionArtifact,
  Session,
  TagRecord,
} from "../models/types";

const DB_NAME = "aftermark";
const DB_VERSION = 6;

export interface AftermarkDB {
  bookmarks: {
    key: string;
    value: Bookmark;
    indexes: { "by-normalized-url": string; "by-status": string };
  };
  snapshots: {
    key: string;
    value: DocumentSnapshot;
    indexes: { "by-bookmark": string };
  };
  inferences: {
    key: string;
    value: InferenceRecord;
    indexes: { "by-bookmark": string };
  };
  clusters: {
    key: string;
    value: Cluster;
  };
  sessions: {
    key: string;
    value: Session;
  };
  artifacts: {
    key: string;
    value: ActionArtifact;
    indexes: { "by-cluster": string };
  };
  tags: {
    key: string;
    value: TagRecord;
  };
}

let dbInstance: IDBPDatabase<AftermarkDB> | null = null;

function createDB(): Promise<IDBPDatabase<AftermarkDB>> {
  return openDB<AftermarkDB>(DB_NAME, DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, transaction) {
      if (!db.objectStoreNames.contains("bookmarks")) {
        const bookmarks = db.createObjectStore("bookmarks", { keyPath: "id" });
        bookmarks.createIndex("by-normalized-url", "normalizedUrl");
        bookmarks.createIndex("by-status", "status");
      } else {
        const bookmarkStore = transaction.objectStore("bookmarks");
        if (!bookmarkStore.indexNames.contains("by-normalized-url")) {
          bookmarkStore.createIndex("by-normalized-url", "normalizedUrl");
        }
        if (!bookmarkStore.indexNames.contains("by-status")) {
          bookmarkStore.createIndex("by-status", "status");
        }
      }

      if (!db.objectStoreNames.contains("snapshots")) {
        const snapshots = db.createObjectStore("snapshots", { keyPath: "bookmarkId" });
        snapshots.createIndex("by-bookmark", "bookmarkId");
      }
      if (!db.objectStoreNames.contains("inferences")) {
        const inferences = db.createObjectStore("inferences", { autoIncrement: true });
        inferences.createIndex("by-bookmark", "bookmarkId");
      }
      if (!db.objectStoreNames.contains("clusters")) {
        db.createObjectStore("clusters", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("artifacts")) {
        const artifacts = db.createObjectStore("artifacts", { autoIncrement: true });
        artifacts.createIndex("by-cluster", "clusterId");
      }
      if (!db.objectStoreNames.contains("tags")) {
        db.createObjectStore("tags", { keyPath: "name" });
      }
    },
  });
}

export async function getDB(): Promise<IDBPDatabase<AftermarkDB>> {
  if (dbInstance) return dbInstance;
  try {
    dbInstance = await createDB();
  } catch (err) {
    console.warn("[db] open failed, deleting and recreating:", err);
    await deleteDB(DB_NAME);
    dbInstance = await createDB();
  }
  return dbInstance;
}
