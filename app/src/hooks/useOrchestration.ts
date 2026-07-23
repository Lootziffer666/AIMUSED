import type { TrackId } from "@signal-app/core"
import { isEqual } from "lodash"
import { useCallback } from "react"
import { findTrackOrchestrationOrigin } from "../services/orchestration/orchestrationOrigin"
import { useMobxGetter, useMobxSelector } from "./useMobxSelector"
import { useStores } from "./useStores"

export const useOrchestration = () => {
  const { orchestrationStore } = useStores()

  return {
    get project() {
      return useMobxGetter(orchestrationStore, "project")
    },
    get trackMapping() {
      return useMobxGetter(orchestrationStore, "trackMapping")
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
    get appliedTracks() {
      return useMobxGetter(orchestrationStore, "appliedTracks") ?? []
    },
    loadProject: useCallback(
      (
        project: Parameters<typeof orchestrationStore.loadProject>[0],
        mapping?: Parameters<typeof orchestrationStore.loadProject>[1],
      ) => orchestrationStore.loadProject(project, mapping),
      [orchestrationStore],
    ),
    dispatch: useCallback(
      (command: Parameters<typeof orchestrationStore.dispatch>[0]) =>
        orchestrationStore.dispatch(command),
      [orchestrationStore],
    ),
    undo: useCallback(() => orchestrationStore.undo(), [orchestrationStore]),
    redo: useCallback(() => orchestrationStore.redo(), [orchestrationStore]),
    recordAppliedTracks: useCallback(
      (tracks: Parameters<typeof orchestrationStore.recordAppliedTracks>[0]) =>
        orchestrationStore.recordAppliedTracks(tracks),
      [orchestrationStore],
    ),
  }
}

/**
 * Looks up the orchestration decision (instrument-assignment origin/reason,
 * plus role) behind a single AIMUSED track, if any — the piece
 * `InstrumentMark`'s origin badge renders. Reactive to both
 * `OrchestrationStore.appliedTracks` and `.arrangement`, so the badge
 * appears/disappears/updates as the user applies recipes, undoes, or applies
 * the arrangement to the song again.
 */
export const useTrackOrchestrationOrigin = (trackId: TrackId) => {
  const { orchestrationStore } = useStores()
  // `findTrackOrchestrationOrigin` returns a freshly-built object every call,
  // so a structural `isEqual` comparator is used instead of the default
  // `Object.is` — otherwise every render would look "changed" and loop
  // (same trick `usePianoRoll`'s `ghostTrackIds` uses for its derived array).
  return useMobxSelector(
    () =>
      findTrackOrchestrationOrigin(
        orchestrationStore.appliedTracks,
        orchestrationStore.arrangement,
        trackId,
      ),
    [orchestrationStore, trackId],
    isEqual,
  )
}
