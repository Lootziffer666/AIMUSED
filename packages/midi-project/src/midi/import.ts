import { parseMidi } from "midi-file";
import type { MidiEvent } from "midi-file";
import { createId } from "@signal-app/orchestration-core/shared";
import { bytesToBase64 } from "@signal-app/orchestration-core/shared";
import {
  buildTempoMap,
  ticksToSeconds,
  DEFAULT_MICROSECONDS_PER_BEAT,
} from "./tempo-map";
import { normalizeTracksByProgram } from "./normalize-program-changes";
import {
  MuseMidiImportError,
  type MuseControlChangeEvent,
  type MuseKeySignatureEvent,
  type MuseMarkerEvent,
  type MuseMidiSource,
  type MuseMidiTrack,
  type MuseMusicalTimeline,
  type MuseNote,
  type MuseProgramChangeEvent,
  type MusePitchBendEvent,
  type MuseSustainEvent,
  type MuseTextEvent,
  type MuseTimeSignatureEvent,
} from "./types";

export interface MuseImportedMidi {
  fileName: string;
  source: MuseMidiSource;
  timeline: MuseMusicalTimeline;
  tracks: MuseMidiTrack[];
}

const SUSTAIN_CONTROLLER = 64;

interface RawChannelBucket {
  channel: number;
  name: string | null;
  instrumentName: string | null;
  noteEvents: {
    tick: number;
    type: "on" | "off";
    pitch: number;
    velocity: number;
  }[];
  controlChanges: MuseControlChangeEvent[];
  programChanges: MuseProgramChangeEvent[];
  pitchBends: MusePitchBendEvent[];
}

/**
 * Imports a Standard MIDI File (Format 0 or 1) into MUSE's normalized,
 * non-destructive project model. The original bytes are preserved verbatim
 * in `source.rawBase64` so the file can always be re-exported unchanged.
 */
export function importMidiFile(
  fileName: string,
  bytes: Uint8Array,
): MuseImportedMidi {
  if (!bytes || bytes.length === 0) {
    throw new MuseMidiImportError("Die Datei ist leer.", "empty-file");
  }

  let parsed: ReturnType<typeof parseMidi>;
  try {
    parsed = parseMidi(bytes);
  } catch (err) {
    throw new MuseMidiImportError(
      `Die Datei konnte nicht als MIDI-Datei gelesen werden (beschädigt oder kein gültiges SMF): ${
        err instanceof Error ? err.message : String(err)
      }`,
      "invalid-file",
    );
  }

  const { header, tracks: rawTracks } = parsed;

  if (header.format !== 0 && header.format !== 1) {
    throw new MuseMidiImportError(
      `MIDI-Format ${header.format} wird nicht unterstützt. MUSE unterstützt Format 0 und Format 1.`,
      "unsupported-format",
    );
  }

  if (!header.ticksPerBeat || header.ticksPerBeat <= 0) {
    throw new MuseMidiImportError(
      "Diese Datei verwendet SMPTE-Zeitcode statt Ticks pro Viertelnote. Dieses Zeitformat wird derzeit nicht unterstützt.",
      "unsupported-time-division",
    );
  }

  const ticksPerQuarterNote = header.ticksPerBeat;

  const rawTempoEvents: { tick: number; microsecondsPerBeat: number }[] = [];
  const timeSignatureMap: MuseTimeSignatureEvent[] = [];
  const keySignatureMap: MuseKeySignatureEvent[] = [];
  const markers: MuseMarkerEvent[] = [];
  const textEvents: MuseTextEvent[] = [];

  const trackBuckets: MuseMidiTrack[] = [];
  let maxTick = 0;

  rawTracks.forEach((events, trackIndex) => {
    let tick = 0;
    const channelBuckets = new Map<number, RawChannelBucket>();
    let unassignedName: string | null = null;
    let unassignedInstrumentName: string | null = null;

    const getBucket = (channel: number): RawChannelBucket => {
      let bucket = channelBuckets.get(channel);
      if (!bucket) {
        bucket = {
          channel,
          name: null,
          instrumentName: null,
          noteEvents: [],
          controlChanges: [],
          programChanges: [],
          pitchBends: [],
        };
        channelBuckets.set(channel, bucket);
      }
      return bucket;
    };

    for (const event of events as MidiEvent[]) {
      tick += event.deltaTime;

      switch (event.type) {
        case "trackName":
          unassignedName = event.text;
          break;
        case "instrumentName":
          unassignedInstrumentName = event.text;
          break;
        case "setTempo":
          rawTempoEvents.push({
            tick,
            microsecondsPerBeat: event.microsecondsPerBeat,
          });
          break;
        case "timeSignature":
          timeSignatureMap.push({
            tick,
            numerator: event.numerator,
            denominator: event.denominator,
          });
          break;
        case "keySignature":
          keySignatureMap.push({
            tick,
            key: event.key,
            scale: event.scale === 1 ? 1 : 0,
          });
          break;
        case "marker":
          markers.push({ tick, text: event.text });
          break;
        case "text":
          textEvents.push({ tick, text: event.text, kind: "text" });
          break;
        case "lyrics":
          textEvents.push({ tick, text: event.text, kind: "lyric" });
          break;
        case "cuePoint":
          textEvents.push({ tick, text: event.text, kind: "cuePoint" });
          break;
        case "noteOn": {
          const bucket = getBucket(event.channel);
          bucket.noteEvents.push({
            tick,
            type: "on",
            pitch: event.noteNumber,
            velocity: event.velocity,
          });
          break;
        }
        case "noteOff": {
          const bucket = getBucket(event.channel);
          bucket.noteEvents.push({
            tick,
            type: "off",
            pitch: event.noteNumber,
            velocity: event.velocity,
          });
          break;
        }
        case "controller": {
          const bucket = getBucket(event.channel);
          bucket.controlChanges.push({
            tick,
            controller: event.controllerType,
            value: event.value,
          });
          break;
        }
        case "programChange": {
          const bucket = getBucket(event.channel);
          bucket.programChanges.push({ tick, program: event.programNumber });
          break;
        }
        case "pitchBend": {
          const bucket = getBucket(event.channel);
          bucket.pitchBends.push({ tick, value: event.value });
          break;
        }
        default:
          break;
      }

      if (tick > maxTick) maxTick = tick;
    }

    for (const bucket of channelBuckets.values()) {
      bucket.name = unassignedName;
      bucket.instrumentName = unassignedInstrumentName;
      trackBuckets.push(bucketToTrack(bucket, trackIndex, header.format === 0));
    }
  });

  const tempoMap = buildTempoMap(
    rawTempoEvents.length > 0
      ? rawTempoEvents
      : [{ tick: 0, microsecondsPerBeat: DEFAULT_MICROSECONDS_PER_BEAT }],
  );
  timeSignatureMap.sort((a, b) => a.tick - b.tick);
  if (timeSignatureMap.length === 0 || timeSignatureMap[0].tick !== 0) {
    timeSignatureMap.unshift({ tick: 0, numerator: 4, denominator: 4 });
  }
  keySignatureMap.sort((a, b) => a.tick - b.tick);
  markers.sort((a, b) => a.tick - b.tick);
  textEvents.sort((a, b) => a.tick - b.tick);

  const totalSeconds = ticksToSeconds(maxTick, ticksPerQuarterNote, tempoMap);

  const timeline: MuseMusicalTimeline = {
    ticksPerQuarterNote,
    tempoMap,
    timeSignatureMap,
    keySignatureMap,
    markers,
    textEvents,
    totalTicks: maxTick,
    totalSeconds,
  };

  const source: MuseMidiSource = {
    fileName,
    format: header.format,
    originalNumTracks: rawTracks.length,
    rawBase64: bytesToBase64(bytes),
    sizeBytes: bytes.length,
    importedAt: new Date().toISOString(),
  };

  return {
    fileName,
    source,
    timeline,
    tracks: normalizeTracksByProgram(trackBuckets),
  };
}

function bucketToTrack(
  bucket: RawChannelBucket,
  trackIndex: number,
  isFormatZero: boolean,
): MuseMidiTrack {
  const notes: MuseNote[] = [];
  const trackId = createId("track");

  // FIFO per pitch: MIDI note-off matches the earliest still-active note-on for that pitch.
  const activeByPitch = new Map<number, { tick: number; velocity: number }[]>();
  const sustainEvents: MuseSustainEvent[] = [];

  const sortedNoteEvents = [...bucket.noteEvents].sort(
    (a, b) => a.tick - b.tick,
  );

  for (const ev of sortedNoteEvents) {
    if (ev.type === "on") {
      const queue = activeByPitch.get(ev.pitch) ?? [];
      queue.push({ tick: ev.tick, velocity: ev.velocity });
      activeByPitch.set(ev.pitch, queue);
    } else {
      const queue = activeByPitch.get(ev.pitch);
      if (queue && queue.length > 0) {
        const start = queue.shift()!;
        const durationTicks = Math.max(1, ev.tick - start.tick);
        notes.push({
          id: createId("note"),
          pitch: ev.pitch,
          velocity: start.velocity,
          startTick: start.tick,
          durationTicks,
          channel: bucket.channel,
          sourceTrackId: trackId,
        });
      }
      // Unmatched note-off events (no active note-on) are silently dropped —
      // they cannot represent an audible note.
    }
  }

  // Any note-on left without a matching note-off is closed at the last event
  // in the track, preventing stuck notes on export/playback.
  const trackEndTick =
    sortedNoteEvents.length > 0
      ? sortedNoteEvents[sortedNoteEvents.length - 1].tick
      : 0;
  for (const [pitch, queue] of activeByPitch.entries()) {
    for (const start of queue) {
      notes.push({
        id: createId("note"),
        pitch,
        velocity: start.velocity,
        startTick: start.tick,
        durationTicks: Math.max(1, trackEndTick - start.tick) || 1,
        channel: bucket.channel,
        sourceTrackId: trackId,
      });
    }
  }

  notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);

  for (const cc of bucket.controlChanges) {
    if (cc.controller === SUSTAIN_CONTROLLER) {
      sustainEvents.push({ tick: cc.tick, on: cc.value >= 64 });
    }
  }

  return {
    id: trackId,
    index: trackIndex,
    name: bucket.name,
    instrumentName: bucket.instrumentName,
    channel: bucket.channel,
    notes,
    controlChanges: bucket.controlChanges,
    programChanges: bucket.programChanges,
    pitchBends: bucket.pitchBends,
    sustainEvents,
    splitFromFormatZero: isFormatZero,
  };
}
