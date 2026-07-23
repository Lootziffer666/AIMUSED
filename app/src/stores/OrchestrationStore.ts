import {
  type MuseAnalysisResult,
  type MuseArrangementPlan,
  createId,
} from "@signal-app/orchestration-core"
import {
  applyCommand,
  saveProjectToIdb,
  type MuseCommand,
  type MuseCommandLogEntry,
  type MuseMidiProject,
} from "@signal-app/midi-project"
import { action, makeObservable, observable, reaction } from "mobx"
import type { AppliedOrchestrationTrack } from "../services/orchestration/orchestrationExport"
import type { MuseTrackMapping } from "../services/orchestration/songAdapter"

const MAX_HISTORY = 50

/**
 * Holds the currently open MUSE analysis/orchestration project and its
 * command history, mirroring MUSE's own `src/store/museStore.ts` snapshot
 * undo/redo semantics (ported behavior, not the zustand implementation).
 *
 * All mutation flows through `dispatch(command)` -> the pure, validating
 * `applyCommand` reducer from `@signal-app/orchestration-core`. Unlike
 * MUSE's original store, `dispatch` does **not** catch `MuseCommandError`
 * and stash it as `lastError` — it lets the error propagate, so a bad
 * command never mutates state and the caller (UI) can show it as a toast via
 * `dialog-hooks`' `useToast`, per the reducer's own "throw, never mutate on
 * failure" contract.
 *
 * Orchestration-domain undo/redo (this store) is intentionally separate from
 * AIMUSED's existing note-editing undo/redo — see docs/MERGE_PLAN.md
 * section 5 for the rationale.
 */
export class OrchestrationStore {
  project: MuseMidiProject | null = null
  /**
   * museTrackId -> songTrackId mapping for the currently loaded `project`,
   * rebuilt (or built fresh) by whoever calls `loadProject` — see
   * `services/orchestration/songAdapter.ts`'s `buildMuseTrackMapping`. `null`
   * until a project carrying a mapping has been loaded (e.g. plain
   * `.mid`-driven analysis doesn't need one until `.museproj.json` open/save
   * wires it up).
   */
  trackMapping: MuseTrackMapping | null = null
  private past: MuseMidiProject[] = []
  private future: MuseMidiProject[] = []
  commandLog: readonly MuseCommandLogEntry[] = []
  /**
   * Tracks (with their instrument-family group and originating
   * `MuseInstrumentAssignment` id) created by the most recent "apply to
   * song" action — see `OrchestrationDialog.tsx`'s `onApplyToSong`. Lives
   * here (rather than as dialog-local `useState`, which is what the first
   * cut of the mix/stem export feature used) so it survives the dialog
   * closing/unmounting: `InstrumentMark`'s origin badge
   * (`useTrackOrchestrationOrigin`) needs to look this up from the piano
   * roll regardless of whether the orchestration dialog is open.
   */
  appliedTracks: readonly AppliedOrchestrationTrack[] = []

  /**
   * Resolves once the most recently triggered IndexedDB autosave (see the
   * `reaction` below) has finished — exposed only so tests can await it
   * deterministically; UI code has no reason to read this.
   */
  pendingAutosave: Promise<void> | null = null

  constructor() {
    makeObservable<
      OrchestrationStore,
      | "past"
      | "future"
      | "loadProject"
      | "reset"
      | "dispatch"
      | "recordAppliedTracks"
      | "undo"
      | "redo"
    >(this, {
      project: observable.ref,
      trackMapping: observable.ref,
      past: observable.ref,
      future: observable.ref,
      commandLog: observable.ref,
      appliedTracks: observable.ref,
      loadProject: action,
      reset: action,
      dispatch: action,
      recordAppliedTracks: action,
      undo: action,
      redo: action,
    })

    // Autosaves the current project to IndexedDB (via the ported
    // `idb-store.ts`) every time it changes — after `dispatch`, `loadProject`,
    // `undo`, or `redo`. This is intentionally separate from AIMUSED's
    // existing plain-song localStorage autosave (`AutoSaveService.ts`), which
    // is untouched. Fire-and-forget: a failed autosave is logged, never
    // thrown, since it must not interrupt the user's editing flow.
    reaction(
      () => this.project,
      (project) => {
        if (project === null) {
          return
        }
        this.pendingAutosave = saveProjectToIdb(project).catch((e) => {
          console.warn("Orchestration project autosave failed:", e)
        })
      },
    )
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  get analysis(): MuseAnalysisResult | null {
    return this.project?.analysis ?? null
  }

  get arrangement(): MuseArrangementPlan | null {
    return this.project?.arrangement ?? null
  }

  /**
   * Replaces the open project outright (e.g. right after import/analysis, or
   * after opening a `.museproj.json` file) and clears history.
   */
  loadProject(
    project: MuseMidiProject,
    mapping: MuseTrackMapping | null = null,
  ) {
    this.project = project
    this.trackMapping = mapping
    this.past = []
    this.future = []
    this.commandLog = []
  }

  /** Clears all song-specific orchestration state when a different song opens. */
  reset() {
    this.project = null
    this.trackMapping = null
    this.past = []
    this.future = []
    this.commandLog = []
    this.appliedTracks = []
    this.pendingAutosave = null
  }

  /**
   * Applies a single `MuseCommand` via the pure reducer. Throws
   * `MuseCommandError` (propagated, not swallowed) if the command is
   * invalid; in that case no store field is mutated.
   */
  dispatch(command: MuseCommand) {
    if (command.type === "UNDO") {
      this.undo()
      return
    }
    if (command.type === "REDO") {
      this.redo()
      return
    }

    // applyCommand throws MuseCommandError on failure and never mutates its
    // input — if it throws, nothing below runs, so this store stays exactly
    // as it was before dispatch was called.
    const nextProject = applyCommand(this.project, command)

    const previous = this.project
    this.past = previous
      ? [...this.past, previous].slice(-MAX_HISTORY)
      : this.past
    this.future = []
    this.commandLog = [
      ...this.commandLog,
      { id: createId("cmdlog"), command, appliedAt: new Date().toISOString() },
    ].slice(-MAX_HISTORY)
    this.project = nextProject
  }

  /**
   * Records which `Song` tracks the most recent "apply to song" action
   * created — called from `OrchestrationDialog.tsx`'s `onApplyToSong` right
   * after `applyRenderResultToSong`. Replaces the previous list outright
   * (only the latest "apply" action is tracked, matching the export
   * feature's existing "scope for export mix/stems" semantics).
   */
  recordAppliedTracks(tracks: readonly AppliedOrchestrationTrack[]) {
    this.appliedTracks = [...tracks]
  }

  undo() {
    if (this.past.length === 0 || !this.project) return
    const previous = this.past[this.past.length - 1]
    this.future = [this.project, ...this.future].slice(0, MAX_HISTORY)
    this.past = this.past.slice(0, -1)
    this.project = previous
  }

  redo() {
    if (this.future.length === 0) return
    const next = this.future[0]
    this.past = this.project
      ? [...this.past, this.project].slice(-MAX_HISTORY)
      : this.past
    this.future = this.future.slice(1)
    this.project = next
  }
}
