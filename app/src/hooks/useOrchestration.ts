import { useCallback } from "react"
import { useMobxGetter } from "./useMobxSelector"
import { useStores } from "./useStores"

export const useOrchestration = () => {
  const { orchestrationStore } = useStores()

  return {
    get project() {
      return useMobxGetter(orchestrationStore, "project")
    },
    get analysis() {
      return useMobxGetter(orchestrationStore, "analysis")
    },
    get arrangement() {
      return useMobxGetter(orchestrationStore, "arrangement")
    },
    get commandLog() {
      return useMobxGetter(orchestrationStore, "commandLog")
    },
    get canUndo() {
      return useMobxGetter(orchestrationStore, "canUndo")
    },
    get canRedo() {
      return useMobxGetter(orchestrationStore, "canRedo")
    },
    loadProject: useCallback(
      (project: Parameters<typeof orchestrationStore.loadProject>[0]) =>
        orchestrationStore.loadProject(project),
      [orchestrationStore],
    ),
    dispatch: useCallback(
      (command: Parameters<typeof orchestrationStore.dispatch>[0]) =>
        orchestrationStore.dispatch(command),
      [orchestrationStore],
    ),
    undo: useCallback(() => orchestrationStore.undo(), [orchestrationStore]),
    redo: useCallback(() => orchestrationStore.redo(), [orchestrationStore]),
  }
}
