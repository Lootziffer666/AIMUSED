import { writeMidi } from "midi-file";
import type { MidiEvent } from "midi-file";

/**
 * A small, wholly synthetic "retro adventure" MIDI fixture used for tests and
 * as the integration/e2e reference file. No copyrighted material of any kind
 * is used — every note below is hand-authored for MUSE's test suite.
 *
 * Structure: 4 tracks (Format 1), 96 PPQ, 120 BPM, 4/4.
 *  - Melody: a short 8-note motif (A section) repeated with a variation (A'),
 *    played legato-ish with medium note lengths in the mid register.
 *  - Bass: a low, monophonic root-note walking line, one note per beat.
 *  - Harmony: block triads sustained for whole bars.
 *  - Percussion (channel 9): a simple two-bar drum ostinato repeated throughout.
 */
export function buildSyntheticAdventureMidi(): Uint8Array {
  const ppq = 96;
  const beat = ppq;
  const bar = beat * 4;

  const conductor: MidiEvent[] = [
    {
      deltaTime: 0,
      type: "trackName",
      text: "Synthetic Adventure",
      meta: true,
    },
    { deltaTime: 0, type: "setTempo", microsecondsPerBeat: 500000, meta: true },
    {
      deltaTime: 0,
      type: "timeSignature",
      numerator: 4,
      denominator: 4,
      metronome: 24,
      thirtyseconds: 8,
      meta: true,
    },
    { deltaTime: 0, type: "marker", text: "A", meta: true },
    { deltaTime: bar * 4, type: "marker", text: "A'", meta: true },
    { deltaTime: bar * 4, type: "endOfTrack", meta: true },
  ];

  // 8-note motif, relative to bar start, in eighth notes (48 ticks).
  const motifPitches = [67, 69, 71, 72, 71, 69, 67, 64];
  const eighth = ppq / 2;

  // 16 bars total, mirroring the "A" (bars 0-3, 8-11) / "A'" (bars 4-7, 12-15)
  // marker structure so every part is audible throughout the whole piece —
  // including the marker-defined climax section used by orchestration tests.
  function buildMelodyEvents(): MidiEvent[] {
    const events: AbsEvent[] = [];
    for (let bar_i = 0; bar_i < 16; bar_i++) {
      const barStart = bar_i * bar;
      const isVariation = Math.floor(bar_i / 4) % 2 === 1;
      const pitches = isVariation
        ? motifPitches.map((p) => p + 5)
        : motifPitches;
      pitches.forEach((pitch, i) => {
        const start = barStart + i * eighth;
        events.push({
          tick: start,
          ev: {
            deltaTime: 0,
            type: "noteOn",
            channel: 0,
            noteNumber: pitch,
            velocity: 92,
          },
        });
        events.push({
          tick: start + eighth - 4,
          ev: {
            deltaTime: 0,
            type: "noteOff",
            channel: 0,
            noteNumber: pitch,
            velocity: 0,
          },
        });
      });
    }
    return toRelative([
      { deltaTime: 0, type: "trackName", text: "Melody", meta: true },
      { deltaTime: 0, type: "programChange", channel: 0, programNumber: 73 },
      ...flatten(events),
    ]);
  }

  function buildBassEvents(): MidiEvent[] {
    const events: AbsEvent[] = [];
    const rootPattern = [40, 40, 45, 43];
    for (let bar_i = 0; bar_i < 16; bar_i++) {
      for (let beat_i = 0; beat_i < 4; beat_i++) {
        const pitch = rootPattern[beat_i % rootPattern.length];
        const start = bar_i * bar + beat_i * beat;
        events.push({
          tick: start,
          ev: {
            deltaTime: 0,
            type: "noteOn",
            channel: 1,
            noteNumber: pitch,
            velocity: 100,
          },
        });
        events.push({
          tick: start + beat - 4,
          ev: {
            deltaTime: 0,
            type: "noteOff",
            channel: 1,
            noteNumber: pitch,
            velocity: 0,
          },
        });
      }
    }
    return toRelative([
      { deltaTime: 0, type: "trackName", text: "Bass", meta: true },
      { deltaTime: 0, type: "programChange", channel: 1, programNumber: 32 },
      ...flatten(events),
    ]);
  }

  function buildHarmonyEvents(): MidiEvent[] {
    const events: AbsEvent[] = [];
    const chords = [
      [60, 64, 67],
      [60, 64, 67],
      [57, 60, 64],
      [55, 59, 62],
    ];
    for (let bar_i = 0; bar_i < 16; bar_i++) {
      const chord = chords[bar_i % chords.length];
      const start = bar_i * bar;
      for (const pitch of chord) {
        events.push({
          tick: start,
          ev: {
            deltaTime: 0,
            type: "noteOn",
            channel: 2,
            noteNumber: pitch,
            velocity: 70,
          },
        });
        events.push({
          tick: start + bar - 4,
          ev: {
            deltaTime: 0,
            type: "noteOff",
            channel: 2,
            noteNumber: pitch,
            velocity: 0,
          },
        });
      }
    }
    return toRelative([
      { deltaTime: 0, type: "trackName", text: "Harmony", meta: true },
      { deltaTime: 0, type: "programChange", channel: 2, programNumber: 48 },
      ...flatten(events),
    ]);
  }

  function buildPercussionEvents(): MidiEvent[] {
    const events: AbsEvent[] = [];
    const kick = 36;
    const snare = 38;
    const hat = 42;
    for (let bar_i = 0; bar_i < 16; bar_i++) {
      const start = bar_i * bar;
      events.push({
        tick: start,
        ev: {
          deltaTime: 0,
          type: "noteOn",
          channel: 9,
          noteNumber: kick,
          velocity: 100,
        },
      });
      events.push({
        tick: start + 8,
        ev: {
          deltaTime: 0,
          type: "noteOff",
          channel: 9,
          noteNumber: kick,
          velocity: 0,
        },
      });
      events.push({
        tick: start + beat * 2,
        ev: {
          deltaTime: 0,
          type: "noteOn",
          channel: 9,
          noteNumber: snare,
          velocity: 96,
        },
      });
      events.push({
        tick: start + beat * 2 + 8,
        ev: {
          deltaTime: 0,
          type: "noteOff",
          channel: 9,
          noteNumber: snare,
          velocity: 0,
        },
      });
      for (let e = 0; e < 8; e++) {
        const hStart = start + e * eighth;
        events.push({
          tick: hStart,
          ev: {
            deltaTime: 0,
            type: "noteOn",
            channel: 9,
            noteNumber: hat,
            velocity: 60,
          },
        });
        events.push({
          tick: hStart + 6,
          ev: {
            deltaTime: 0,
            type: "noteOff",
            channel: 9,
            noteNumber: hat,
            velocity: 0,
          },
        });
      }
    }
    return toRelative([
      { deltaTime: 0, type: "trackName", text: "Percussion", meta: true },
      ...flatten(events),
    ]);
  }

  const data = {
    header: { format: 1 as const, numTracks: 5, ticksPerBeat: ppq },
    tracks: [
      conductor,
      buildMelodyEvents(),
      buildBassEvents(),
      buildHarmonyEvents(),
      buildPercussionEvents(),
    ],
  };

  return new Uint8Array(writeMidi(data));
}

interface AbsEvent {
  tick: number;
  ev: MidiEvent;
}

function flatten(events: AbsEvent[]): AbsEvent[] {
  return [...events].sort((a, b) => a.tick - b.tick);
}

function toRelative(items: (MidiEvent | AbsEvent)[]): MidiEvent[] {
  const abs: AbsEvent[] = [];
  const tick = 0;
  for (const item of items) {
    if ("ev" in item) {
      abs.push(item);
    } else {
      abs.push({ tick, ev: item });
    }
  }
  const sorted = [...abs].sort((a, b) => a.tick - b.tick);
  const result: MidiEvent[] = [];
  let prev = 0;
  for (const { tick: t, ev } of sorted) {
    result.push({ ...ev, deltaTime: Math.max(0, t - prev) } as MidiEvent);
    prev = t;
  }
  result.push({ deltaTime: 0, type: "endOfTrack", meta: true });
  return result;
}
