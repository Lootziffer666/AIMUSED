// Reuses the same fake-IndexedDB setup as `@signal-app/midi-project`'s
// already-ported `idb-store.test.ts` (imported first, exactly like there),
// rather than inventing a new one.
import "fake-indexeddb/auto"
import { emptySong, NoteEvent, TrackId } from "@signal-app/core"
import { analyzeProject } from "@signal-app/orchestration-core"
import { loadProjectFromIdb } from "@signal-app/midi-project"
import { analyzeProject } from "@signal-app/orchestration-core"
import { songToMuseProject } from "../services/orchestration/songAdapter"
import { OrchestrationStore } from "./OrchestrationStore"

function buildProject(name: string) {
  const song = emptySong()
  const melody = song.tracks[1]
  melody.addEvent<NoteEvent>({
    type: "channel",
    subtype: "note",
    tick: 0,
    duration: song.timebase,
    noteNumber: 60,
    velocity: 90,
  })
  return songToMuseProject(song, name).project
}

afterEach(() => indexedDB.deleteDatabase("muse-projects"))

describe("OrchestrationStore autosave", () => {
  it("has no pending autosave before any project is loaded", () => {
    const store = new OrchestrationStore()
    expect(store.project).toBeNull()
    expect(store.pendingAutosave).toBeNull()
  })

  it("autosaves to IndexedDB whenever the project changes via loadProject", async () => {
    const store = new OrchestrationStore()
    const project = buildProject("Autosave Test")

    store.loadProject(project)
    expect(store.pendingAutosave).not.toBeNull()
    await store.pendingAutosave

    const saved = await loadProjectFromIdb(project.id)
    expect(saved.id).toBe(project.id)
    expect(saved.name).toBe("Autosave Test")
  })

  it("autosaves again on dispatch, and again after undo reverts the project", async () => {
    const store = new OrchestrationStore()
    const project = buildProject("Undo Test")
    project.analysis = analyzeProject(project)

    store.loadProject(project)
    await store.pendingAutosave

    store.dispatch({
      type: "APPLY_RECIPE",
      recipeId: "cinematic_adventure",
      preserveUserOverrides: false,
      seed: 1,
    })
    await store.pendingAutosave
    expect(store.project?.arrangement).not.toBeNull()
    expect((await loadProjectFromIdb(project.id)).arrangement).not.toBeNull()

    store.undo()
    await store.pendingAutosave
    expect(store.project?.arrangement).toBeNull()
    expect((await loadProjectFromIdb(project.id)).arrangement).toBeNull()
  })
})

describe("OrchestrationStore reset", () => {
  it("clears all song-specific project state", () => {
    const store = new OrchestrationStore()
    store.loadProject(buildProject("Old song"))
    store.recordAppliedTracks([
      { trackId: 1 as TrackId, groupId: "group", groupName: "Group" },
    ])

    store.reset()

    expect(store.project).toBeNull()
    expect(store.trackMapping).toBeNull()
    expect(store.commandLog).toEqual([])
    expect(store.appliedTracks).toEqual([])
    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(false)
  })
})
