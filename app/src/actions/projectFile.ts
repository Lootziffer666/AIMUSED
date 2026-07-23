import { Song, songFromMidi } from "@signal-app/core"
import { base64ToBytes } from "@signal-app/orchestration-core/shared"
import {
  parseProjectFile,
  serializeProjectFile,
  type MuseMidiProject,
} from "@signal-app/midi-project"
import { useStores } from "../hooks/useStores"
import { writeFile } from "../services/fs-helper"
import { buildMuseTrackMapping, songToMuseProject } from "../services/orchestration/songAdapter"
import { useSetSong } from "./song"

/**
 * Open/save actions for MUSE's `.museproj.json` project file format —
 * analogous to `actions/file.ts`'s plain `.mid` open/save, but for the
 * schema-versioned format that embeds the original MIDI (base64) plus
 * analysis/arrangement/variants metadata (`@signal-app/midi-project`'s
 * `persistence/project-file.ts`, already ported+tested).
 *
 * Deliberately kept separate from `actions/file.ts` (rather than folded into
 * `useOpenFile`/`saveFileAs`) so the two file types stay unambiguous to the
 * user and to the code: a `.museproj.json`'s `fileHandle` is never treated as
 * an interchangeable target for a plain MIDI "Save" — see `useOpenProjectFile`.
 */

export const PROJECT_FILE_DESCRIPTION = "MUSE Project"
export const PROJECT_FILE_EXTENSION = ".museproj.json"

/**
 * Opens a `.museproj.json` file: parses/migrates it, decodes the embedded
 * original MIDI back into a `Song` (exactly like a normal `.mid` open, via
 * `songFromMidi`), and hydrates `OrchestrationStore` with the saved
 * analysis/arrangement/variants so the user doesn't have to re-run analysis
 * or reapply the recipe.
 *
 * Intentionally does **not** set `song.fileHandle` to the `.museproj.json`
 * handle: AIMUSED's plain "Save"/`saveFile` writes raw MIDI bytes to
 * `song.fileHandle`, which would silently corrupt the project file if it were
 * reused as the MIDI save target. Saving the project again is a deliberate,
 * separate action (`useSaveProjectFileAs`, "Save Project As…").
 */
export const useOpenProjectFile = () => {
  const setSong = useSetSong()
  const { orchestrationStore } = useStores()

  return async () => {
    let fileHandle: FileSystemFileHandle
    try {
      fileHandle = (
        await window.showOpenFilePicker({
          types: [
            {
              description: PROJECT_FILE_DESCRIPTION,
              accept: { "application/json": [PROJECT_FILE_EXTENSION] },
            },
          ],
        })
      )[0]
    } catch (ex) {
      if ((ex as Error).name === "AbortError") {
        return
      }
      const msg = "An error occured trying to open the project file."
      console.error(msg, ex)
      alert(msg)
      return
    }

    let project: MuseMidiProject
    try {
      const file = await fileHandle.getFile()
      const text = await file.text()
      project = parseProjectFile(text)
    } catch (ex) {
      const msg =
        "This .museproj.json file is corrupted or was saved with an unsupported version."
      console.error(msg, ex)
      alert(msg)
      return
    }

    const song = songFromMidi(base64ToBytes(project.source.rawBase64))
    song.name = project.name
    song.isSaved = true

    const mapping = buildMuseTrackMapping(song, project)

    setSong(song)
    orchestrationStore.loadProject(project, mapping)
  }
}

/**
 * Saves the current `Song` + the `OrchestrationStore`'s current
 * `MuseMidiProject` (analysis/arrangement/variants as they currently stand —
 * `null`/`[]` if the user hasn't run analysis yet, which the schema already
 * supports) as a new `.museproj.json` file.
 *
 * If no project has been analyzed yet, one is built on the fly via
 * `songToMuseProject` (round-tripping through real MIDI bytes, same as the
 * orchestration dialog's "Analyze" step) so "Save Project As…" always works,
 * even before the user has opened the orchestration dialog.
 */
export const useSaveProjectFileAs = () => {
  const { orchestrationStore } = useStores()

  return async (song: Song) => {
    const project =
      orchestrationStore.project ??
      songToMuseProject(song, song.name || "Song").project

    let fileHandle: FileSystemFileHandle
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: `${song.name || "song"}${PROJECT_FILE_EXTENSION}`,
        types: [
          {
            description: PROJECT_FILE_DESCRIPTION,
            accept: { "application/json": [PROJECT_FILE_EXTENSION] },
          },
        ],
      })
    } catch (ex) {
      if ((ex as Error).name === "AbortError") {
        return
      }
      const msg = "An error occured trying to save the project file."
      console.error(msg, ex)
      alert(msg)
      return
    }

    try {
      const data = serializeProjectFile(project)
      await writeFile(fileHandle, data)
    } catch (ex) {
      const msg = "Unable to save project file."
      console.error(msg, ex)
      alert(msg)
    }
  }
}
