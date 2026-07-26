import type { MusePattern } from "../../entities/pattern/MusePattern"

/**
 * Snapshot based undo/redo. Pattern operations are pure and cheap to copy,
 * so a plain stack covers every edit without per-command bookkeeping.
 */
export interface PatternHistory {
  past: MusePattern[]
  present: MusePattern
  future: MusePattern[]
}

const LIMIT = 100

export function createHistory(pattern: MusePattern): PatternHistory {
  return { past: [], present: pattern, future: [] }
}

/** Records a new state. Identical states are ignored so undo stays meaningful. */
export function pushHistory(
  history: PatternHistory,
  next: MusePattern,
): PatternHistory {
  if (next === history.present) return history
  const past = [...history.past, history.present]
  return {
    past: past.length > LIMIT ? past.slice(past.length - LIMIT) : past,
    present: next,
    future: [],
  }
}

/** Replaces the present without creating an undo step (drag in progress). */
export function replaceHistory(
  history: PatternHistory,
  next: MusePattern,
): PatternHistory {
  return { ...history, present: next }
}

export function canUndo(history: PatternHistory): boolean {
  return history.past.length > 0
}

export function canRedo(history: PatternHistory): boolean {
  return history.future.length > 0
}

export function undo(history: PatternHistory): PatternHistory {
  if (history.past.length === 0) return history
  const previous = history.past[history.past.length - 1]
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redo(history: PatternHistory): PatternHistory {
  if (history.future.length === 0) return history
  const [next, ...rest] = history.future
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
  }
}
