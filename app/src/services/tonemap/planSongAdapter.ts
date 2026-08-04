import {
  type NoteEvent,
  type Song,
  Track,
  type TrackEventOf,
  type TrackId,
} from "@signal-app/core"
import type {
  OrchestrationPlan,
  PatchCandidate,
  RenderChannelAssignment,
} from "@signal-app/tonemap-core"
import { planToMidi } from "@signal-app/tonemap-core"
import type { ProgramChangeEvent } from "midifile-ts"
import { runInAction } from "mobx"

/**
 * The rendering adapter that needs nothing installed: the orchestration plan
 * played by MUSE itself.
 *
 * `planToMidi` decides the channels, programs and keyswitches – the same
 * decisions sfizz and FluidSynth get – and this turns them into song tracks.
 * Re-applying the same plan updates those tracks instead of piling up copies,
 * and the source MIDI is never touched.
 */

export type PlanTrackBinding = Record<string, TrackId>

export function planTrackName(label: string): string {
  return `Plan: ${label}`
}

function noteEvents(
  notes: OrchestrationPlan["parts"][number]["notes"],
): Omit<NoteEvent, "id">[] {
  return notes.map((note) => ({
    type: "channel" as const,
    subtype: "note" as const,
    tick: note.startTick,
    duration: Math.max(1, note.endTick - note.startTick),
    noteNumber: Math.min(127, Math.max(0, Math.round(note.noteNumber))),
    velocity: Math.min(127, Math.max(1, Math.round(note.velocity))),
  }))
}

function rewriteTrackNotes(
  track: Track,
  events: Omit<NoteEvent, "id">[],
): void {
  const noteIds = track.events
    .filter((event) => "subtype" in event && event.subtype === "note")
    .map((event) => event.id)
  track.removeEvents(noteIds)
  track.addEvents<NoteEvent>(events)
  track.updateEndOfTrack()
}

export interface ApplyPlanResult {
  binding: PlanTrackBinding
  assignments: RenderChannelAssignment[]
  warnings: string[]
}

/**
 * Writes the plan into the song. Returns the binding so a repeated apply
 * reuses the same tracks, plus whatever `planToMidi` had to warn about.
 */
export function applyPlanToSong(
  song: Song,
  plan: OrchestrationPlan,
  options: {
    patches?: Record<string, PatchCandidate>
    binding?: PlanTrackBinding
  } = {},
): ApplyPlanResult {
  const { assignments, warnings } = planToMidi(plan, {
    patches: options.patches,
  })
  const byPart = new Map(assignments.map((entry) => [entry.partId, entry]))
  const binding = options.binding ?? {}
  const next: PlanTrackBinding = {}

  for (const part of plan.parts) {
    if (part.muted) continue
    const assignment = byPart.get(part.id)
    if (!assignment) continue

    const name = planTrackName(part.label)
    const events = noteEvents(part.notes)
    const boundId = binding[part.id]
    const bound = boundId !== undefined ? song.getTrack(boundId) : undefined

    if (bound) {
      rewriteTrackNotes(bound, events)
      if (bound.name !== name) bound.setName(name)
      if (bound.channel !== assignment.channel) {
        // Track has no setter for this; the plan owns the routing, so a
        // re-apply follows it (a part turned percussion moves to channel 10).
        runInAction(() => {
          bound.channel = assignment.channel
        })
      }
      next[part.id] = bound.id
      continue
    }

    const track = new Track()
    track.channel = assignment.channel
    track.setName(name)
    if (assignment.program !== undefined) {
      track.addEvent<TrackEventOf<ProgramChangeEvent>>({
        type: "channel",
        subtype: "programChange",
        value: assignment.program,
        tick: 0,
      })
    }
    track.addEvents<NoteEvent>(events)
    track.updateEndOfTrack()
    song.addTrack(track)
    next[part.id] = track.id
  }

  // parts that no longer export give their track back
  for (const [partId, trackId] of Object.entries(binding)) {
    if (next[partId] !== undefined) continue
    const track = song.getTrack(trackId)
    if (track) song.removeTrack(trackId)
  }

  return { binding: next, assignments, warnings }
}
