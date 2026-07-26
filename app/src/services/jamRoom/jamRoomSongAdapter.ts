import { NoteEvent, Song, Track, TrackEventOf } from "@signal-app/core"
import type { ProgramChangeEvent } from "midifile-ts"
import type {
  MusePerformanceTake,
  MuseTrackRole,
} from "../../entities/performance/MusePerformanceTake"
import { normalizeTake } from "./jamRoomUtils"

export const JAM_ROOM_PERCUSSION_CHANNEL = 9

const PROGRAM_BY_ROLE: Partial<Record<MuseTrackRole, number>> = {
  bass: 33,
  guitar: 25,
  pad: 89,
  texture: 92,
  harmony: 48,
  melody: 0,
}

const DRUM_NOTE_BY_ZONE: Record<string, number> = {
  kick: 36,
  snare: 38,
  hihat: 42,
  clap: 39,
  tom: 45,
}

export function assignJamRoomTrackChannel(
  existingChannels: readonly (number | undefined)[],
  role: MuseTrackRole,
): number {
  if (role === "percussion") return JAM_ROOM_PERCUSSION_CHANNEL

  const used = new Set(
    existingChannels.filter(
      (channel): channel is number => channel !== undefined,
    ),
  )
  for (let channel = 0; channel < 16; channel++) {
    if (channel === JAM_ROOM_PERCUSSION_CHANNEL) continue
    if (!used.has(channel)) return channel
  }
  return 0
}

export function jamRoomTrackName(
  role: MuseTrackRole,
  source: MusePerformanceTake["source"],
): string {
  return `Jam Room – ${role} (${source})`
}

export function applyJamRoomTakeToSong(
  song: Song,
  unsafeTake: MusePerformanceTake,
): Track {
  const take = normalizeTake(unsafeTake)
  const track = new Track()
  track.channel = assignJamRoomTrackChannel(
    song.tracks.map((candidate) => candidate.channel),
    take.role,
  )
  track.setName(jamRoomTrackName(take.role, take.source))

  if (take.role !== "percussion") {
    track.addEvent<TrackEventOf<ProgramChangeEvent>>({
      type: "channel",
      subtype: "programChange",
      tick: 0,
      value: PROGRAM_BY_ROLE[take.role] ?? 0,
    })
  }

  if (take.role === "percussion") {
    track.addEvents<NoteEvent>(
      take.drumHits.map((hit) => ({
        type: "channel",
        subtype: "note",
        tick: hit.tick,
        duration: Math.max(1, Math.round(song.timebase / 8)),
        noteNumber: DRUM_NOTE_BY_ZONE[hit.zoneId] ?? 38,
        velocity: hit.velocity,
      })),
    )
  } else {
    track.addEvents<NoteEvent>(
      take.notes.map((note) => ({
        type: "channel",
        subtype: "note",
        tick: note.tick,
        duration: note.duration,
        noteNumber: note.noteNumber,
        velocity: note.velocity,
      })),
    )
  }

  song.addTrack(track)
  return track
}
