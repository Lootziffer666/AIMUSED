import { openDB, type IDBPDatabase } from "idb";
import type { MuseMidiProject } from "../project/types";
import {
  migrateProject,
  serializeProjectFile,
  MuseProjectFileError,
} from "./project-file";

const DB_NAME = "muse-projects";
const DB_VERSION = 1;
const STORE = "projects";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    },
  });
  return dbPromise;
}

export interface MuseProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

interface StoredProjectRecord {
  id: string;
  json: string;
  /** One generation of recovery fallback, rotated in on every save. */
  previousJson: string | null;
  updatedAt: string;
}

/**
 * Saves atomically via a single IndexedDB transaction, and keeps the prior
 * generation as a recovery fallback — so a write that lands mid-corruption
 * (e.g. a browser crash) never destroys the last known-good state.
 */
export async function saveProjectToIdb(
  project: MuseMidiProject,
): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, "readwrite");
  const existing = (await tx.store.get(project.id)) as
    | StoredProjectRecord
    | undefined;
  const record: StoredProjectRecord = {
    id: project.id,
    json: serializeProjectFile(project),
    previousJson: existing?.json ?? null,
    updatedAt: project.updatedAt,
  };
  await tx.store.put(record);
  await tx.done;
}

export async function loadProjectFromIdb(id: string): Promise<MuseMidiProject> {
  const db = await getDb();
  const record = (await db.get(STORE, id)) as StoredProjectRecord | undefined;
  if (!record)
    throw new MuseProjectFileError(
      `Kein gespeichertes Projekt mit ID "${id}" gefunden.`,
    );

  try {
    return migrateProject(JSON.parse(record.json));
  } catch (currentError) {
    if (record.previousJson) {
      try {
        return migrateProject(JSON.parse(record.previousJson));
      } catch {
        // previous generation is also unusable — surface the original error below.
      }
    }
    throw currentError instanceof MuseProjectFileError
      ? currentError
      : new MuseProjectFileError(String(currentError));
  }
}

export async function listProjectsInIdb(): Promise<MuseProjectSummary[]> {
  const db = await getDb();
  const all = (await db.getAll(STORE)) as StoredProjectRecord[];
  return all
    .map((record) => {
      try {
        const project = migrateProject(JSON.parse(record.json));
        return {
          id: project.id,
          name: project.name,
          updatedAt: project.updatedAt,
        };
      } catch {
        return null;
      }
    })
    .filter((summary): summary is MuseProjectSummary => summary !== null)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function deleteProjectFromIdb(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}
