import "fake-indexeddb/auto";
import { afterAll, expect, test } from "vitest";
import { buildSyntheticAdventureMidi } from "../../test-helpers/synthetic-adventure";
import { createProjectFromMidiBytes } from "../../project/create";
import {
  deleteProjectFromIdb,
  listProjectsInIdb,
  loadProjectFromIdb,
  saveProjectToIdb,
} from "../idb-store";

const project = createProjectFromMidiBytes(
  "autosave.mid",
  buildSyntheticAdventureMidi(),
);

test("autosaves, lists, recovers the previous generation, and deletes", async () => {
  await saveProjectToIdb(project);
  const updated = {
    ...project,
    name: "Recovered generation",
    updatedAt: "2026-07-22T00:00:00.000Z",
  };
  await saveProjectToIdb(updated);
  expect(
    (await listProjectsInIdb()).find((item) => item.id === project.id)?.name,
  ).toBe("Recovered generation");

  const request = indexedDB.open("muse-projects", 1);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = db.transaction("projects", "readwrite");
  const store = tx.objectStore("projects");
  const record = await new Promise<Record<string, unknown>>(
    (resolve, reject) => {
      const get = store.get(project.id);
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    },
  );
  store.put({ ...record, json: "{broken" });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();

  expect((await loadProjectFromIdb(project.id)).name).toBe(project.name);
  await deleteProjectFromIdb(project.id);
  await expect(loadProjectFromIdb(project.id)).rejects.toThrow(
    /Kein gespeichertes Projekt/,
  );
});

afterAll(() => indexedDB.deleteDatabase("muse-projects"));
