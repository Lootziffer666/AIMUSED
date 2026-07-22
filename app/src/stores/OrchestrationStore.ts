import {
  type MuseAnalysisResult,
  type MuseArrangementPlan,
  createId,
} from "@signal-app/orchestration-core"
import {
  applyCommand,
  type MuseCommand,
  type MuseCommandLogEntry,
  type MuseMidiProject,
} from "@signal-app/midi-project"
import { makeObservable, observable } from "mobx"

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
  private past: MuseMidiProject[] = []
  private future: MuseMidiProject[] = []
  commandLog: readonly MuseCommandLogEntry[] = []

  constructor() {
    makeObservable<OrchestrationStore, "past" | "future">(this, {
      project: observable.ref,
      past: observable.ref,
      future: observable.ref,
      commandLog: observable.ref,
    })
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

  /** Replaces the open project outright (e.g. right after import/analysis) and clears history. */
  loadProject(project: MuseMidiProject) {
    this.project = project
    this.past = []
    this.future = []
    this.commandLog = []
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
