import type { MusePerformanceTake } from "../../entities/performance/MusePerformanceTake"

export function addTake(
  takes: MusePerformanceTake[],
  take: MusePerformanceTake,
): MusePerformanceTake[] {
  return [...takes, take]
}

// Undo: removes the last user take. If no user takes remain,
// the MUSE-generated layers derived from them go as well.
export function undoLastTake(
  takes: MusePerformanceTake[],
): MusePerformanceTake[] {
  let lastUserIdx = -1
  for (let i = takes.length - 1; i >= 0; i--) {
    if (takes[i].generatedBy !== "muse") {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx === -1) {
    return takes.filter((t) => t.generatedBy !== "muse")
  }
  const without = takes.filter((_, i) => i !== lastUserIdx)
  const hasUser = without.some((t) => t.generatedBy !== "muse")
  return hasUser ? without : without.filter((t) => t.generatedBy !== "muse")
}

export function hasMelodicTake(takes: MusePerformanceTake[]): boolean {
  return takes.some(
    (t) =>
      t.generatedBy !== "muse" &&
      t.notes.length > 0 &&
      (t.source === "voice" || t.source === "gesture-instrument"),
  )
}

export function wrapTick(tick: number, loopLength: number): number {
  if (loopLength <= 0) return 0
  return ((tick % loopLength) + loopLength) % loopLength
}
