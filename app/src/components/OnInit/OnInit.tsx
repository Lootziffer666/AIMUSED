import { listProjectsInIdb } from "@signal-app/midi-project"
import { useProgress } from "dialog-hooks"
import { FC, useEffect, useState } from "react"
import { useSetSong } from "../../actions"
import { songFromArrayBuffer } from "../../actions/file"
import { isRunningInElectron } from "../../helpers/platform"
import { useAutoSave } from "../../hooks/useAutoSave"
import { useStores } from "../../hooks/useStores"
import { useLocalization } from "../../localize/useLocalization"
import { AutoSaveDialog } from "../AutoSaveDialog/AutoSaveDialog"
import { InitializeErrorDialog } from "./InitializeErrorDialog"

export const OnInit: FC = () => {
  const rootStore = useStores()
  const setSong = useSetSong()

  const [isErrorDialogOpen, setIsErrorDialogOpen] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [isAutoSaveDialogOpen, setIsAutoSaveDialogOpen] = useState(false)
  const { show: showProgress } = useProgress()
  const localized = useLocalization()
  const { shouldShowAutoSaveDialog } = useAutoSave()

  const init = async () => {
    const closeProgress = showProgress(localized["initializing"])
    try {
      await rootStore.init()
    } catch (e) {
      setIsErrorDialogOpen(true)
      setErrorMessage((e as Error).message)
    } finally {
      closeProgress()
    }
  }

  const loadArgumentFileIfNeeded = async () => {
    if (!isRunningInElectron()) {
      return
    }
    const closeProgress = showProgress(localized["loading-file"])
    try {
      const filePath = await window.electronAPI.getArgument()
      if (filePath) {
        const data = await window.electronAPI.readFile(filePath)
        const song = songFromArrayBuffer(data, filePath)
        setSong(song)
      }
    } catch (e) {
      setIsErrorDialogOpen(true)
      setErrorMessage((e as Error).message)
    } finally {
      closeProgress()
    }
  }

  // Orchestration projects (analysis/arrangement/variants) autosave to
  // IndexedDB independently of the plain-song localStorage autosave above
  // (see `OrchestrationStore`'s constructor). A full "restore this project"
  // prompt UI is deferred (see docs/MERGE_PLAN.md §8a) — for this pass, we
  // only surface that a prior autosave exists, so it's discoverable without
  // silently vanishing.
  const checkOrchestrationAutoSave = async () => {
    try {
      const projects = await listProjectsInIdb()
      if (projects.length > 0) {
        console.info(
          `[orchestration autosave] ${projects.length} saved orchestration project(s) found in IndexedDB (most recent: "${projects[0].name}", updated ${projects[0].updatedAt}). Restore-prompt UI is not implemented yet — open a .museproj.json file to load a project explicitly.`,
        )
      }
    } catch (e) {
      console.warn("Failed to check for orchestration autosaves:", e)
    }
  }

  const checkAutoSave = async () => {
    // Skip auto save restore if there's an argument file in Electron
    if (isRunningInElectron()) {
      try {
        const filePath = await window.electronAPI.getArgument()
        if (filePath) {
          return
        }
      } catch {
        // Continue if error occurs
      }
    }

    // Check for auto save restore
    if (shouldShowAutoSaveDialog()) {
      setIsAutoSaveDialogOpen(true)
    }
  }

  useEffect(() => {
    ;(async () => {
      await init()
      await loadArgumentFileIfNeeded()
      await checkAutoSave()
      await checkOrchestrationAutoSave()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <InitializeErrorDialog
        open={isErrorDialogOpen}
        message={errorMessage}
        onClose={() => setIsErrorDialogOpen(false)}
      />
      <AutoSaveDialog
        open={isAutoSaveDialogOpen}
        onClose={() => setIsAutoSaveDialogOpen(false)}
      />
    </>
  )
}
