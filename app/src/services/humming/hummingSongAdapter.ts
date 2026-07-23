import { NoteEvent, Song, Track, TrackEventOf } from "@signal-app/core"
import type {
  MuseHummingImportResult,
  MuseHummingTargetRole,
} from "@signal-app/orchestration-core"
import type { ProgramChangeEvent } from "midifile-ts"

/**
 * Converts an approved `MuseHummingImportResult` (see
 * `@signal-app/orchestration-core`'s `humming/pipeline.ts`) into a new,
 * independent AIMUSED `Track` appended to the current `Song` — the same
 * "non-destructive append" principle `songAdapter.ts`'s
 * `applyRenderResultToSong` uses for orchestrated tracks.
 *
 * Pure helpers are kept separate from the `Track`/`Song` mutation below so
 * they're unit-testable without a browser (no `getUserMedia`/`MediaRecorder`/
 * `decodeAudioData` involved here at all — those only live in
 * `HummingDialog.tsx` and are not unit-tested for the reasons documented
 * there and in docs/MERGE_PLAN.md).
 */

export const PERCUSSION_CHANNEL = 9

/**
 * Seconds -> ticks at a single, constant tempo. `@signal-app/orchestration-core`'s
 * `tick-time.ts` only provides `ticksToSeconds` against a full tempo-map
 * (`MuseTempoEvent[]`, a `@signal-app/midi-project` type it duplicates to
 * avoid a cyclic package dependency — see that file's own comment) and only
 * in the tick -> seconds direction. The humming pipeline only ever receives
 * a single constant `bpm` (see `importHumming`'s signature), so a full
 * tempo-map inverse isn't needed; this is the small, local, pure function
 * the task's instructions anticipate for that case.
 */
export function secondsToTicks(
  seconds: number,
  bpm: number,
  timebase: number,
): number {
  return Math.max(0, Math.round(seconds * (bpm / 60) * timebase))
}

/**
 * The pipeline's `confidence` (0-1) becomes MIDI velocity. There's no
 * velocity in the pitch/onset-detection output at all (humming has no
 * meaningful "how hard was it hummed" signal), so this is a judgement call:
 * map confidence onto a musically reasonable velocity range instead of a
 * flat constant, so more-confident notes read as slightly more emphasized.
 */
export function confidenceToVelocity(confidence: number): number {
  const clamped = Math.max(0, Math.min(1, confidence))
  return Math.round(40 + clamped * 80)
}

/**
 * Picks a MIDI channel for a new humming track: channel 9 for percussion
 * (matches `Track.ts`'s `isRhythmTrack` convention), otherwise the lowest
 * non-9 channel not already used by an existing track in the song — the
 * same "don't collide with existing tracks" reasoning
 * `render-project.ts`'s `allocateChannel` uses for orchestrated tracks,
 * applied here against the song's *current* tracks instead of a
 * from-scratch allocation across a whole arrangement.
 */
export function assignHummingTrackChannel(
  existingChannels: readonly (number | undefined)[],
  role: MuseHummingTargetRole,
): number {
  if (role === "percussion") {
    return PERCUSSION_CHANNEL
  }
  const used = new Set(
    existingChannels.filter((c): c is number => c !== undefined),
  )
  for (let channel = 0; channel < 16; channel++) {
    if (channel === PERCUSSION_CHANNEL) {
      continue
    }
    if (!used.has(channel)) {
      return channel
    }
  }
  // All 15 non-percussion channels are already in use (extremely unlikely
  // in practice) — fall back to channel 0 rather than throwing, since a
  // channel collision here is still far better than silently dropping the
  // imported track.
  return 0
}

export interface HummingTrackNote {
  tick: number
  duration: number
  noteNumber: number
  velocity: number
}

/** Converts `detectedNotes` (seconds-based) into tick-based note fields, ready to build `NoteEvent`s from. */
export function buildHummingTrackNotes(
  result: MuseHummingImportResult,
  bpm: number,
  timebase: number,
): HummingTrackNote[] {
  return result.detectedNotes.map((note) => {
    const startTick = secondsToTicks(note.startSeconds, bpm, timebase)
    const endTick = secondsToTicks(
      note.startSeconds + note.durationSeconds,
      bpm,
      timebase,
    )
    return {
      tick: startTick,
      duration: Math.max(1, endTick - startTick),
      noteNumber: Math.max(0, Math.min(127, Math.round(note.pitch))),
      velocity: confidenceToVelocity(note.confidence),
    }
  })
}

export function hummingTrackName(role: MuseHummingTargetRole): string {
  return `Humming (${role})`
}

/**
 * Appends a new track built from an approved humming import result to
 * `song`, via `song.addTrack` — never overwrites or removes any existing
 * track.
 */
export function applyHummingResultToSong(
  song: Song,
  result: MuseHummingImportResult,
  role: MuseHummingTargetRole,
  bpm: number,
): Track {
  const track = new Track()
  track.channel = assignHummingTrackChannel(
    song.tracks.map((t) => t.channel),
    role,
  )
  track.setName(hummingTrackName(role))

  track.addEvent<TrackEventOf<ProgramChangeEvent>>({
    type: "channel",
    subtype: "programChange",
    tick: 0,
    value: 0,
  })

  track.addEvents<NoteEvent>(
    buildHummingTrackNotes(result, bpm, song.timebase).map((note) => ({
      type: "channel",
      subtype: "note",
      tick: note.tick,
      duration: note.duration,
      noteNumber: note.noteNumber,
      velocity: note.velocity,
    })),
  )

  song.addTrack(track)
  return track
}
