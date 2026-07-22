import {
  NoteEvent,
  Song,
  songToMidi,
  Track,
  TrackEventOf,
  TrackId,
} from "@signal-app/core"
import {
  createProjectFromMidiBytes,
  type MuseExportTrackInput,
  type MuseMidiProject,
} from "@signal-app/midi-project"
import type { ProgramChangeEvent } from "midifile-ts"

/**
 * Bidirectional bridge between AIMUSED's `Song` (the canonical, editable
 * model the piano roll / arrange view render) and MUSE's `MuseMidiProject`
 * (the carrier for analysis/orchestration metadata).
 *
 * Per docs/MERGE_PLAN.md section 3/9, the simplest and most robust way to
 * build a `MuseMidiProject` from a `Song` is to round-trip through real MIDI
 * bytes (`songToMidi`) and run MUSE's own, more strictly tested SMF importer
 * on them, rather than re-implementing a second, parallel
 * `Song -> MuseMusicalTimeline` derivation.
 */

export interface MuseTrackMapping {
  /** MUSE per-track id -> the AIMUSED `TrackId` it was imported from. */
  readonly museTrackIdToSongTrackId: ReadonlyMap<string, TrackId>
}

export interface SongMuseProject {
  readonly project: MuseMidiProject
  readonly mapping: MuseTrackMapping
}

/**
 * Builds a `MuseMidiProject` (ready for analysis/orchestration) from an
 * AIMUSED `Song`, plus a mapping back to the originating AIMUSED tracks.
 *
 * MUSE's importer assigns each imported `MuseMidiTrack` an `index` equal to
 * its position in the original MIDI file's track list. `songToMidi` emits
 * exactly one raw track per `song.tracks` entry, in the same order, so
 * `index` lines up 1:1 with `song.tracks[index]`. AIMUSED's conductor track
 * (no channel; only tempo/time-signature meta events) produces no
 * `MuseMidiTrack` at all — MUSE only creates a track per channel that
 * actually carries channel events — so the mapping simply omits it, which is
 * correct: there is nothing on the conductor track for orchestration to
 * target.
 */
export function songToMuseProject(song: Song, name: string): SongMuseProject {
  const bytes = songToMidi(song)
  const project = createProjectFromMidiBytes(`${name}.mid`, bytes)
  project.name = name

  const museTrackIdToSongTrackId = new Map<string, TrackId>()
  for (const museTrack of project.tracks) {
    const songTrack = song.tracks[museTrack.index]
    if (songTrack !== undefined) {
      museTrackIdToSongTrackId.set(museTrack.id, songTrack.id)
    }
  }

  return { project, mapping: { museTrackIdToSongTrackId } }
}

/**
 * Converts the deterministic, non-humanized per-instrument tracks produced
 * by `@signal-app/orchestration-core`'s `buildArrangedExportTracks` (the
 * MIDI-editable rendering of an arrangement plan — as opposed to
 * `buildRenderableProject`, which humanizes timing/velocity for audio-only
 * playback and is intentionally not used here) into new AIMUSED `Track`s,
 * appended to `song` via its existing `addTrack` action.
 *
 * This is non-destructive: the user's original tracks are left untouched,
 * and the orchestrated parts become independent, editable tracks in the same
 * `Song` — playable through the existing SoundFont player and editable in
 * the existing piano roll, with zero changes to either.
 */
export function applyRenderResultToSong(
  song: Song,
  exportTracks: readonly MuseExportTrackInput[],
): Track[] {
  const newTracks: Track[] = []

  for (const input of exportTracks) {
    const track = new Track()
    track.channel = input.channel
    track.setName(input.name)

    track.addEvent<TrackEventOf<ProgramChangeEvent>>({
      type: "channel",
      subtype: "programChange",
      tick: 0,
      value: input.programNumber,
    })

    track.addEvents<NoteEvent>(
      input.notes.map((note) => ({
        type: "channel",
        subtype: "note",
        tick: note.startTick,
        duration: note.durationTicks,
        noteNumber: note.pitch,
        velocity: note.velocity,
      })),
    )

    song.addTrack(track)
    newTracks.push(track)
  }

  return newTracks
}
