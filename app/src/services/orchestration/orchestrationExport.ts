import { TrackId } from "@signal-app/core"

/**
 * Pure helpers backing the orchestration dialog's "export mix"/"export
 * stems" audio export (see `OrchestrationDialog.tsx` /
 * `useOrchestrationExport.tsx`). Kept dependency-free (no MobX/React/Web
 * Audio) so they're trivially unit-testable — the actual `OfflineAudioContext`
 * rendering (`@signal-app/player`'s `renderAudio`) is not something this
 * environment can unit test (no real audio backend), so that part is only
 * exercised by hand/manual verification, not automated tests.
 */

/** One track appended to the `Song` by `applyRenderResultToSong`, tagged with the instrument-family group it belongs to. */
export interface AppliedOrchestrationTrack {
  trackId: TrackId
  groupId: string
  groupName: string
  /**
   * The `MuseInstrumentAssignment.id` (see `@signal-app/orchestration-core`'s
   * `MuseExportTrackInput.assignmentId`) this track's notes were built from —
   * lets `orchestrationOrigin.ts`'s `findTrackOrchestrationOrigin` look back
   * up the `MuseDecision` behind the track's instrument assignment for the
   * origin badge on `InstrumentMark`. Optional so existing call sites/tests
   * that only care about mix/stem export grouping don't need to supply it.
   */
  assignmentId?: string
}

export interface OrchestrationTrackGroup {
  groupId: string
  groupName: string
  trackIds: TrackId[]
}

/**
 * Filters an event list (e.g. `Song.allEvents`, or the `PlayerEvent[]`
 * accepted by `renderAudio`) down to only the events belonging to the given
 * set of track ids. Every event collected via `collectAllEvents`/
 * `Song.allEvents` carries a `trackId` field (see
 * `packages/core/src/entities/song/collectAllEvents.ts`), so this is a plain
 * filter rather than a new event-collection path.
 */
export function filterEventsByTrackIds<E extends { trackId: number }>(
  events: readonly E[],
  trackIds: ReadonlySet<number>,
): E[] {
  return events.filter((e) => trackIds.has(e.trackId))
}

/**
 * Groups the tracks created by a single "apply to song" action by MUSE's
 * instrument-family group (Strings/Woodwinds/Brass/Percussion/Keys/Choir/
 * Additional — see `@signal-app/orchestration-core`'s
 * `buildArrangedExportTracks`), preserving first-seen group order. Used to
 * drive per-family "stems" WAV export — one render/download per group that
 * has at least one track.
 */
export function groupAppliedTracksByFamily(
  tracks: readonly AppliedOrchestrationTrack[],
): OrchestrationTrackGroup[] {
  const groups: OrchestrationTrackGroup[] = []
  const byGroupId = new Map<string, OrchestrationTrackGroup>()

  for (const track of tracks) {
    let group = byGroupId.get(track.groupId)
    if (group === undefined) {
      group = { groupId: track.groupId, groupName: track.groupName, trackIds: [] }
      byGroupId.set(track.groupId, group)
      groups.push(group)
    }
    group.trackIds.push(track.trackId)
  }

  return groups
}
