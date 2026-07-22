import { writeMidi } from "midi-file";
import type { MidiEvent, MidiData } from "midi-file";
import { base64ToBytes } from "@signal-app/orchestration-core/shared";
import type { MuseMidiProject } from "../project/types";
import type { MuseMusicalTimeline } from "./types";

/** Re-exports the untouched original file — always available, never destroyed. */
export function exportOriginalMidi(project: MuseMidiProject): Uint8Array {
  return base64ToBytes(project.source.rawBase64);
}

export interface MuseExportNote {
  pitch: number;
  velocity: number;
  startTick: number;
  durationTicks: number;
}

export interface MuseExportTrackInput {
  name: string;
  channel: number;
  programNumber: number;
  notes: MuseExportNote[];
}

interface AbsoluteEvent {
  tick: number;
  /** Note-offs sort before note-ons at an identical tick to avoid false overlaps. */
  order: number;
  event: MidiEvent;
}

/**
 * Builds a Format-1 Standard MIDI File from grouped instrument tracks plus
 * the project's timeline (tempo map, time signatures, key signatures, markers).
 * Used both for exporting the full arrangement and for per-family stems-as-MIDI.
 */
export function buildMidiFromTracks(
  timeline: MuseMusicalTimeline,
  tracks: MuseExportTrackInput[],
  projectName: string,
): Uint8Array {
  const conductorEvents: AbsoluteEvent[] = [];

  conductorEvents.push({
    tick: 0,
    order: 0,
    event: { deltaTime: 0, type: "trackName", text: projectName, meta: true },
  });

  for (const t of timeline.tempoMap) {
    conductorEvents.push({
      tick: t.tick,
      order: 1,
      event: {
        deltaTime: 0,
        type: "setTempo",
        microsecondsPerBeat: t.microsecondsPerBeat,
        meta: true,
      },
    });
  }
  for (const ts of timeline.timeSignatureMap) {
    conductorEvents.push({
      tick: ts.tick,
      order: 1,
      event: {
        deltaTime: 0,
        type: "timeSignature",
        numerator: ts.numerator,
        denominator: ts.denominator,
        metronome: 24,
        thirtyseconds: 8,
        meta: true,
      },
    });
  }
  for (const ks of timeline.keySignatureMap) {
    conductorEvents.push({
      tick: ks.tick,
      order: 1,
      event: {
        deltaTime: 0,
        type: "keySignature",
        key: ks.key,
        scale: ks.scale,
        meta: true,
      },
    });
  }
  for (const marker of timeline.markers) {
    conductorEvents.push({
      tick: marker.tick,
      order: 2,
      event: { deltaTime: 0, type: "marker", text: marker.text, meta: true },
    });
  }
  for (const text of timeline.textEvents) {
    conductorEvents.push({
      tick: text.tick,
      order: 2,
      event: {
        deltaTime: 0,
        type:
          text.kind === "lyric"
            ? "lyrics"
            : text.kind === "cuePoint"
              ? "cuePoint"
              : "text",
        text: text.text,
        meta: true,
      },
    });
  }

  const conductorTrack = toRelativeTrack(conductorEvents, timeline.totalTicks);

  const instrumentTracks: MidiEvent[][] = tracks.map((t) =>
    buildInstrumentTrack(t, timeline.totalTicks),
  );

  const data: MidiData = {
    header: {
      format: 1,
      numTracks: 1 + instrumentTracks.length,
      ticksPerBeat: timeline.ticksPerQuarterNote,
    },
    tracks: [conductorTrack, ...instrumentTracks],
  };

  const bytes = writeMidi(data, { running: false });
  return new Uint8Array(bytes);
}

function buildInstrumentTrack(
  track: MuseExportTrackInput,
  totalTicks: number,
): MidiEvent[] {
  const events: AbsoluteEvent[] = [];
  events.push({
    tick: 0,
    order: 0,
    event: { deltaTime: 0, type: "trackName", text: track.name, meta: true },
  });
  events.push({
    tick: 0,
    order: 1,
    event: {
      deltaTime: 0,
      type: "programChange",
      channel: track.channel,
      programNumber: clampMidi(track.programNumber, 0, 127),
    },
  });

  let maxTick = 0;
  for (const note of track.notes) {
    const pitch = clampMidi(note.pitch, 0, 127);
    const velocity = clampMidi(note.velocity, 1, 127);
    const endTick = note.startTick + Math.max(1, note.durationTicks);
    events.push({
      tick: note.startTick,
      order: 3,
      event: {
        deltaTime: 0,
        type: "noteOn",
        channel: track.channel,
        noteNumber: pitch,
        velocity,
      },
    });
    events.push({
      tick: endTick,
      order: 2,
      event: {
        deltaTime: 0,
        type: "noteOff",
        channel: track.channel,
        noteNumber: pitch,
        velocity: 0,
      },
    });
    if (endTick > maxTick) maxTick = endTick;
  }

  return toRelativeTrack(events, Math.max(totalTicks, maxTick));
}

function toRelativeTrack(
  events: AbsoluteEvent[],
  endTick: number,
): MidiEvent[] {
  const sorted = [...events].sort(
    (a, b) => a.tick - b.tick || a.order - b.order,
  );
  const result: MidiEvent[] = [];
  let prevTick = 0;
  for (const { tick, event } of sorted) {
    result.push({
      ...event,
      deltaTime: Math.max(0, tick - prevTick),
    } as MidiEvent);
    prevTick = tick;
  }
  const finalTick = Math.max(endTick, prevTick);
  result.push({
    deltaTime: Math.max(0, finalTick - prevTick),
    type: "endOfTrack",
    meta: true,
  });
  return result;
}

function clampMidi(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}
