import { describe, expect, test } from "vitest";
import { writeMidi } from "midi-file";
import { exportOriginalMidi } from "../export";
import { importMidiFile } from "../import";
import { normalizeProgramChanges } from "../normalize-program-changes";
import type { MuseMidiTrack } from "../types";
import { createProjectFromMidiBytes } from "../../project/create";

function track(overrides: Partial<MuseMidiTrack> = {}): MuseMidiTrack {
  return {
    id: "source",
    index: 1,
    name: "Lead",
    instrumentName: null,
    channel: 0,
    notes: [
      {
        id: "a",
        pitch: 60,
        velocity: 100,
        startTick: 10,
        durationTicks: 90,
        channel: 0,
        sourceTrackId: "source",
      },
      {
        id: "b",
        pitch: 67,
        velocity: 90,
        startTick: 120,
        durationTicks: 40,
        channel: 0,
        sourceTrackId: "source",
      },
    ],
    controlChanges: [],
    programChanges: [
      { tick: 0, program: 1 },
      { tick: 100, program: 40 },
    ],
    pitchBends: [],
    sustainEvents: [],
    splitFromFormatZero: false,
    ...overrides,
  };
}

describe("program-change normalization", () => {
  test("splits separate melodies deterministically and records provenance", () => {
    const parts = normalizeProgramChanges(track());
    expect(parts.map((part) => part.derivation)).toEqual([
      {
        sourceTrackId: "source",
        sourceTrackIndex: 1,
        channel: 0,
        program: 1,
        startTick: 10,
        endTick: 100,
        reason: "program-change",
      },
      {
        sourceTrackId: "source",
        sourceTrackIndex: 1,
        channel: 0,
        program: 40,
        startTick: 120,
        endTick: 160,
        reason: "program-change",
      },
    ]);
    expect(parts.map((part) => part.notes.map((note) => note.pitch))).toEqual([
      [60],
      [67],
    ]);
    expect(normalizeProgramChanges(track()).map((part) => part.id)).toEqual(
      parts.map((part) => part.id),
    );
  });

  test("a program change does not reassign a sounding note", () => {
    const parts = normalizeProgramChanges(
      track({
        notes: [
          {
            id: "held",
            pitch: 60,
            velocity: 100,
            startTick: 10,
            durationTicks: 150,
            channel: 0,
            sourceTrackId: "source",
          },
          {
            id: "new",
            pitch: 67,
            velocity: 90,
            startTick: 120,
            durationTicks: 20,
            channel: 0,
            sourceTrackId: "source",
          },
        ],
      }),
    );
    expect(parts[0].notes[0].durationTicks).toBe(150);
    expect(parts[0].derivation?.program).toBe(1);
    expect(parts[1].derivation?.program).toBe(40);
  });

  test("carries all controller, sustain and pitch-bend state to a new part", () => {
    const parts = normalizeProgramChanges(
      track({
        controlChanges: [
          { tick: 2, controller: 1, value: 22 },
          { tick: 3, controller: 7, value: 80 },
          { tick: 4, controller: 10, value: 40 },
          { tick: 5, controller: 11, value: 90 },
          { tick: 90, controller: 64, value: 127 },
          { tick: 150, controller: 64, value: 0 },
        ],
        pitchBends: [
          { tick: 80, value: 100 },
          { tick: 140, value: -200 },
        ],
      }),
    );
    const second = parts[1];
    expect(
      second.controlChanges
        .filter((event) => event.tick === 120)
        .map((event) => [event.controller, event.value]),
    ).toEqual([
      [1, 22],
      [7, 80],
      [10, 40],
      [11, 90],
      [64, 127],
    ]);
    expect(second.sustainEvents).toEqual([
      { tick: 120, on: true },
      { tick: 150, on: false },
    ]);
    expect(second.pitchBends).toEqual([
      { tick: 120, value: 100 },
      { tick: 140, value: -200 },
    ]);
  });

  test("handles repeated programs without phantom tracks and exempts percussion", () => {
    const repeated = normalizeProgramChanges(
      track({
        notes: [
          {
            id: "a",
            pitch: 60,
            velocity: 100,
            startTick: 10,
            durationTicks: 10,
            channel: 0,
            sourceTrackId: "source",
          },
          {
            id: "b",
            pitch: 67,
            velocity: 90,
            startTick: 120,
            durationTicks: 10,
            channel: 0,
            sourceTrackId: "source",
          },
          {
            id: "c",
            pitch: 62,
            velocity: 90,
            startTick: 180,
            durationTicks: 10,
            channel: 0,
            sourceTrackId: "source",
          },
        ],
        programChanges: [
          { tick: 0, program: 1 },
          { tick: 30, program: 2 },
          { tick: 100, program: 40 },
          { tick: 170, program: 1 },
        ],
      }),
    );
    expect(repeated.map((part) => part.derivation?.program)).toEqual([
      1, 40, 1,
    ]);
    const percussion = track({
      channel: 9,
      programChanges: [
        { tick: 0, program: 1 },
        { tick: 100, program: 40 },
      ],
    });
    expect(normalizeProgramChanges(percussion)).toEqual([percussion]);
  });

  test("Format 0 channels split independently and original bytes round-trip exactly", () => {
    const bytes = new Uint8Array(
      writeMidi(
        {
          header: { format: 0, numTracks: 1, ticksPerBeat: 480 },
          tracks: [
            [
              {
                deltaTime: 0,
                type: "controller",
                channel: 0,
                controllerType: 7,
                value: 91,
              },
              {
                deltaTime: 0,
                type: "programChange",
                channel: 0,
                programNumber: 1,
              },
              {
                deltaTime: 0,
                type: "noteOn",
                channel: 0,
                noteNumber: 60,
                velocity: 100,
              },
              {
                deltaTime: 100,
                type: "noteOff",
                channel: 0,
                noteNumber: 60,
                velocity: 0,
              },
              {
                deltaTime: 0,
                type: "programChange",
                channel: 0,
                programNumber: 40,
              },
              {
                deltaTime: 0,
                type: "noteOn",
                channel: 0,
                noteNumber: 64,
                velocity: 100,
              },
              {
                deltaTime: 100,
                type: "noteOff",
                channel: 0,
                noteNumber: 64,
                velocity: 0,
              },
              {
                deltaTime: 0,
                type: "noteOn",
                channel: 9,
                noteNumber: 36,
                velocity: 100,
              },
              {
                deltaTime: 10,
                type: "noteOff",
                channel: 9,
                noteNumber: 36,
                velocity: 0,
              },
              { deltaTime: 0, type: "endOfTrack", meta: true },
            ],
          ],
        },
        { running: false },
      ),
    );
    const imported = importMidiFile("format-0.mid", bytes);
    expect(
      imported.tracks.map((item) => [item.channel, item.notes.length]),
    ).toEqual([
      [0, 1],
      [0, 1],
      [9, 1],
    ]);
    expect(imported.tracks[1].controlChanges).toContainEqual({
      tick: 100,
      controller: 7,
      value: 91,
    });
    const project = createProjectFromMidiBytes("format-0.mid", bytes);
    const exported = exportOriginalMidi(project);
    expect(exported).toEqual(bytes);
    expect(
      importMidiFile("again.mid", exported).tracks.map(
        (item) => item.notes.length,
      ),
    ).toEqual([1, 1, 1]);
  });
});
