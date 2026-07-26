import {
  type NoteEvent,
  type Song,
  Track,
  type TrackEventOf,
  type TrackId,
} from "@signal-app/core"
import type { ProgramChangeEvent } from "midifile-ts"
import {
  audibleLayers,
  type MusePattern,
  type MusePatternTrackLayer,
} from "../../entities/pattern/MusePattern"
import { JAM_ROOM_PERCUSSION_CHANNEL } from "../jamRoom/jamRoomSongAdapter"
import { envelopePeak } from "./envelope"

/**
 * Export contract between pattern editor and song.
 *
 * A pattern layer maps to exactly one song track. The mapping is remembered
 * per pattern, so exporting the same pattern again *updates* those tracks
 * instead of piling up new ones. Provenance is kept in the track name, which
 * also lets us recover the binding after a song was reloaded from disk.
 */

export type PatternTrackBinding = Record<string, TrackId>

const DRUM_NOTE_BY_ZONE: Record<string, number> = {
  kick: 36,
  snare: 38,
  hihat: 42,
  clap: 39,
  tom: 45,
}

export function patternTrackName(
  pattern: MusePattern,
  layer: MusePatternTrackLayer,
): string {
  return `Pattern: ${pattern.name} – ${layer.name}`
}

function noteEventsForLayer(
  pattern: MusePattern,
  layer: MusePatternTrackLayer,
): Omit<NoteEvent, "id">[] {
  return layer.notes
    .filter((note) => note.startTick < pattern.lengthTicks)
    .map((note) => {
      const maxDuration = pattern.lengthTicks - note.startTick
      const duration = Math.max(1, Math.min(note.durationTicks, maxDuration))
      const volume = note.volumeEnvelope ? envelopePeak(note.volumeEnvelope) : 1
      const noteNumber =
        layer.kind === "melodic"
          ? note.noteNumber + (layer.transpose ?? 0)
          : (DRUM_NOTE_BY_ZONE[layer.drumZoneId ?? ""] ?? 38)
      return {
        type: "channel" as const,
        subtype: "note" as const,
        tick: pattern.startTick + note.startTick,
        duration:
          layer.kind === "melodic"
            ? duration
            : Math.max(1, Math.round(pattern.timebase / 8)),
        noteNumber: Math.min(127, Math.max(0, Math.round(noteNumber))),
        velocity: Math.min(
          127,
          Math.max(1, Math.round(note.velocity * volume)),
        ),
      }
    })
}

function assignChannel(
  song: Song,
  layer: MusePatternTrackLayer,
  reserved: Set<number>,
): number {
  if (layer.kind !== "melodic") return JAM_ROOM_PERCUSSION_CHANNEL
  const used = new Set<number>([
    ...song.tracks
      .map((t) => t.channel)
      .filter((c): c is number => c !== undefined),
    ...reserved,
  ])
  for (let channel = 0; channel < 16; channel++) {
    if (channel === JAM_ROOM_PERCUSSION_CHANNEL) continue
    if (!used.has(channel)) return channel
  }
  return 0
}

/** Replaces all note events of a track while keeping the track itself. */
function rewriteTrackNotes(
  track: Track,
  events: Omit<NoteEvent, "id">[],
): void {
  const noteIds = track.events
    .filter((e) => "subtype" in e && e.subtype === "note")
    .map((e) => e.id)
  track.removeEvents(noteIds)
  track.addEvents<NoteEvent>(events)
  track.updateEndOfTrack()
}

/**
 * Writes the pattern into the song. Returns the (possibly updated) binding so
 * the caller can persist it – repeated exports then reuse the same tracks.
 */
export function applyPatternToSong(
  song: Song,
  pattern: MusePattern,
  binding: PatternTrackBinding = {},
): PatternTrackBinding {
  const next: PatternTrackBinding = {}
  const reserved = new Set<number>()
  const exportedLayers = audibleLayers(pattern).filter(
    (layer) => layer.notes.length > 0,
  )

  for (const layer of exportedLayers) {
    const expectedName = patternTrackName(pattern, layer)
    const boundId = binding[layer.id]
    const bound = boundId !== undefined ? song.getTrack(boundId) : undefined
    const events = noteEventsForLayer(pattern, layer)

    if (bound) {
      rewriteTrackNotes(bound, events)
      if (bound.name !== expectedName) bound.setName(expectedName)
      next[layer.id] = bound.id
      if (bound.channel !== undefined) reserved.add(bound.channel)
      continue
    }

    const track = new Track()
    track.channel = assignChannel(song, layer, reserved)
    reserved.add(track.channel)
    track.setName(expectedName)
    if (layer.kind === "melodic") {
      track.addEvent<TrackEventOf<ProgramChangeEvent>>({
        type: "channel",
        subtype: "programChange",
        tick: 0,
        value: layer.program ?? 0,
      })
    }
    track.addEvents<NoteEvent>(events)
    song.addTrack(track)
    next[layer.id] = track.id
  }

  // Layers that no longer export anything release their track
  for (const [layerId, trackId] of Object.entries(binding)) {
    if (next[layerId] !== undefined) continue
    const orphan = song.getTrack(trackId)
    if (orphan) song.removeTrack(trackId)
  }

  return next
}

/** Removes every track this pattern owns – used when a pattern is deleted. */
export function removePatternFromSong(
  song: Song,
  binding: PatternTrackBinding,
): void {
  for (const trackId of Object.values(binding)) {
    if (song.getTrack(trackId)) song.removeTrack(trackId)
  }
}
