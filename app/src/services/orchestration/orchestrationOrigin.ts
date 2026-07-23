import type { TrackId } from "@signal-app/core"
import type {
  MuseArrangementPlan,
  MuseDecisionOrigin,
  MuseMusicalRole,
} from "@signal-app/orchestration-core"
import type { AppliedOrchestrationTrack } from "./orchestrationExport"

/**
 * The subset of a `MuseInstrumentAssignment`'s `MuseDecision`s relevant to
 * `InstrumentMark`'s origin badge. Instrument-assignment origin/reason are
 * the minimum bar (per docs/MERGE_PLAN.md's origin-badge item); `role` is
 * included too since it sits on the same assignment at no extra cost.
 */
export interface TrackOrchestrationOrigin {
  origin: MuseDecisionOrigin
  reason: string
  role: MuseMusicalRole
}

/**
 * Looks up the `MuseDecision` origin/reason behind an AIMUSED track's
 * instrument assignment, if that track was created by an orchestration
 * "apply to song" action (see `OrchestrationDialog.tsx`'s `onApplyToSong` /
 * `OrchestrationStore.recordAppliedTracks`) and the arrangement plan that
 * produced it is still the one currently loaded in `OrchestrationStore`.
 *
 * Returns `undefined` — meaning "no badge" — for:
 *  - tracks the user created/imported normally (never in `appliedTracks`),
 *  - a track whose `assignmentId` no longer resolves against `arrangement`
 *    (e.g. the arrangement was replaced by re-analyzing or applying a
 *    different recipe/undo after the track was created) — a stale
 *    association is treated the same as no association, rather than showing
 *    a wrong or dangling decision.
 */
export function findTrackOrchestrationOrigin(
  appliedTracks: readonly AppliedOrchestrationTrack[],
  arrangement: MuseArrangementPlan | null,
  trackId: TrackId,
): TrackOrchestrationOrigin | undefined {
  if (!arrangement) {
    return undefined
  }

  const applied = appliedTracks.find((t) => t.trackId === trackId)
  if (applied?.assignmentId === undefined) {
    return undefined
  }

  const assignment = arrangement.assignments.find(
    (a) => a.id === applied.assignmentId,
  )
  if (!assignment) {
    return undefined
  }

  return {
    origin: assignment.instrumentId.origin,
    reason: assignment.instrumentId.reason,
    role: assignment.role.value,
  }
}
