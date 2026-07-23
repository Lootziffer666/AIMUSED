import type { MuseMidiTrack, MuseNote } from "../midi-types";
import type { MuseMidiProject } from "../project-types";
import { ticksToSeconds } from "../tick-time";

/**
 * A `MuseMidiProject`-shaped equivalent of MUSE's own synthetic "retro
 * adventure" test fixture (see `packages/midi-project`'s
 * `test-helpers/synthetic-adventure.ts`, itself a copy of MUSE's
 * `tests/fixtures/synthetic-adventure.ts`) — same musical content (melody,
 * bass, harmony, percussion over 16 bars, 96 PPQ, 120 BPM, markers "A"/"A'"),
 * but constructed directly as project data instead of real MIDI bytes.
 *
 * This package cannot depend on `@signal-app/midi-project` (that would form
 * a cyclic workspace dependency, since midi-project already depends on this
 * package) so its tests can't call the real `createProjectFromMidiBytes` /
 * `importMidiFile` MIDI-parsing pipeline. Since this package's own logic
 * (analysis/orchestration/variants) only ever consumes the *shape* of a
 * `MuseMidiProject`, building one directly — with identical note data, so
 * every assertion ported from MUSE's original tests still holds — avoids
 * that dependency entirely while exercising the exact same musical content.
 */

const PPQ = 96;
const BEAT = PPQ;
const BAR = BEAT * 4;

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

function note(
  pitch: number,
  velocity: number,
  startTick: number,
  durationTicks: number,
  channel: number,
  sourceTrackId: string,
): MuseNote {
  return {
    id: nextId("note"),
    pitch,
    velocity,
    startTick,
    durationTicks: Math.max(1, durationTicks),
    channel,
    sourceTrackId,
  };
}

function buildMelodyTrack(id: string): MuseMidiTrack {
  const motifPitches = [67, 69, 71, 72, 71, 69, 67, 64];
  const eighth = PPQ / 2;
  const notes: MuseNote[] = [];
  for (let bar = 0; bar < 16; bar++) {
    const barStart = bar * BAR;
    const isVariation = Math.floor(bar / 4) % 2 === 1;
    const pitches = isVariation ? motifPitches.map((p) => p + 5) : motifPitches;
    pitches.forEach((pitch, i) => {
      const start = barStart + i * eighth;
      notes.push(note(pitch, 92, start, eighth - 4, 0, id));
    });
  }
  return {
    id,
    index: 1,
    name: "Melody",
    instrumentName: null,
    channel: 0,
    notes,
    controlChanges: [],
    programChanges: [{ tick: 0, program: 73 }],
    pitchBends: [],
    sustainEvents: [],
    splitFromFormatZero: false,
  };
}

function buildBassTrack(id: string): MuseMidiTrack {
  const rootPattern = [40, 40, 45, 43];
  const notes: MuseNote[] = [];
  for (let bar = 0; bar < 16; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      const pitch = rootPattern[beat % rootPattern.length];
      const start = bar * BAR + beat * BEAT;
      notes.push(note(pitch, 100, start, BEAT - 4, 1, id));
    }
  }
  return {
    id,
    index: 2,
    name: "Bass",
    instrumentName: null,
    channel: 1,
    notes,
    controlChanges: [],
    programChanges: [{ tick: 0, program: 32 }],
    pitchBends: [],
    sustainEvents: [],
    splitFromFormatZero: false,
  };
}

function buildHarmonyTrack(id: string): MuseMidiTrack {
  const chords = [
    [60, 64, 67],
    [60, 64, 67],
    [57, 60, 64],
    [55, 59, 62],
  ];
  const notes: MuseNote[] = [];
  for (let bar = 0; bar < 16; bar++) {
    const chord = chords[bar % chords.length];
    const start = bar * BAR;
    for (const pitch of chord) {
      notes.push(note(pitch, 70, start, BAR - 4, 2, id));
    }
  }
  return {
    id,
    index: 3,
    name: "Harmony",
    instrumentName: null,
    channel: 2,
    notes,
    controlChanges: [],
    programChanges: [{ tick: 0, program: 48 }],
    pitchBends: [],
    sustainEvents: [],
    splitFromFormatZero: false,
  };
}

function buildPercussionTrack(id: string): MuseMidiTrack {
  const kick = 36;
  const snare = 38;
  const hat = 42;
  const eighth = PPQ / 2;
  const notes: MuseNote[] = [];
  for (let bar = 0; bar < 16; bar++) {
    const start = bar * BAR;
    notes.push(note(kick, 100, start, 8, 9, id));
    notes.push(note(snare, 96, start + BEAT * 2, 8, 9, id));
    for (let e = 0; e < 8; e++) {
      notes.push(note(hat, 60, start + e * eighth, 6, 9, id));
    }
  }
  notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  return {
    id,
    index: 4,
    name: "Percussion",
    instrumentName: null,
    channel: 9,
    notes,
    controlChanges: [],
    programChanges: [],
    pitchBends: [],
    sustainEvents: [],
    splitFromFormatZero: false,
  };
}

export function buildSyntheticAdventureProject(
  name = "Synthetic Adventure",
): MuseMidiProject {
  const tracks = [
    buildMelodyTrack(nextId("track")),
    buildBassTrack(nextId("track")),
    buildHarmonyTrack(nextId("track")),
    buildPercussionTrack(nextId("track")),
  ];

  const maxTick = Math.max(
    ...tracks.flatMap((t) => t.notes.map((n) => n.startTick + n.durationTicks)),
  );
  const tempoMap = [{ tick: 0, microsecondsPerBeat: 500000, bpm: 120 }];

  const timeline = {
    ticksPerQuarterNote: PPQ,
    tempoMap,
    timeSignatureMap: [{ tick: 0, numerator: 4, denominator: 4 }],
    keySignatureMap: [],
    markers: [
      { tick: 0, text: "A" },
      { tick: BAR * 4, text: "A'" },
    ],
    textEvents: [],
    totalTicks: maxTick,
    totalSeconds: ticksToSeconds(maxTick, PPQ, tempoMap),
  };

  const now = new Date().toISOString();

  return {
    schemaVersion: 2,
    id: nextId("project"),
    name,
    source: {
      fileName: `${name}.mid`,
      format: 1,
      originalNumTracks: tracks.length + 1,
      rawBase64: "",
      sizeBytes: 0,
      importedAt: now,
    },
    timeline,
    tracks,
    analysis: null,
    arrangement: null,
    variants: [],
    adaptive: {
      cuePoints: [],
      loopRegions: [],
      intensityLevels: [0, 0.33, 0.66, 1],
    },
    createdAt: now,
    updatedAt: now,
  };
}
