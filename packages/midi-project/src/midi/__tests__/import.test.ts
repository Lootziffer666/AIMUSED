import { describe, expect, test } from "vitest";
import { parseMidi, writeMidi } from "midi-file";
import { buildSyntheticAdventureMidi } from "../../test-helpers/synthetic-adventure";
import { importMidiFile } from "../import";
import { exportOriginalMidi } from "../export";
import { createProjectFromMidiBytes } from "../../project/create";
import { MuseMidiImportError } from "../types";

describe("importMidiFile", () => {
  test("parses format 1 fixture into normalized project data", () => {
    const bytes = buildSyntheticAdventureMidi();
    const imported = importMidiFile("adventure.mid", bytes);

    expect(imported.source.format).toBe(1);
    expect(imported.timeline.ticksPerQuarterNote).toBe(96);
    expect(imported.timeline.tempoMap[0].bpm).toBeCloseTo(120, 5);
    expect(imported.timeline.timeSignatureMap[0]).toEqual({
      tick: 0,
      numerator: 4,
      denominator: 4,
    });
    expect(imported.timeline.markers.map((m) => m.text)).toEqual(["A", "A'"]);

    // 4 instrument tracks (melody, bass, harmony, percussion) — conductor track carries no notes.
    expect(imported.tracks.length).toBe(4);

    const melody = imported.tracks.find((t) => t.name === "Melody")!;
    expect(melody).toBeDefined();
    // 16 bars * 8-note motif = 128 notes
    expect(melody.notes.length).toBe(128);
    expect(melody.channel).toBe(0);

    const bass = imported.tracks.find((t) => t.name === "Bass")!;
    // 16 bars * 4 beats = 64 notes
    expect(bass.notes.length).toBe(64);

    const percussion = imported.tracks.find((t) => t.name === "Percussion")!;
    expect(percussion.channel).toBe(9);
    // 16 bars * (1 kick + 1 snare + 8 hats) = 160 notes
    expect(percussion.notes.length).toBe(160);
  });

  test("assigns stable, unique note IDs", () => {
    const bytes = buildSyntheticAdventureMidi();
    const imported = importMidiFile("adventure.mid", bytes);
    const ids = new Set<string>();
    for (const track of imported.tracks) {
      for (const note of track.notes) ids.add(note.id);
    }
    const totalNotes = imported.tracks.reduce(
      (sum, t) => sum + t.notes.length,
      0,
    );
    expect(ids.size).toBe(totalNotes);
  });

  test("computes total duration from tempo map and note range", () => {
    const bytes = buildSyntheticAdventureMidi();
    const imported = importMidiFile("adventure.mid", bytes);
    // 16 bars @ 120bpm, 4/4 => ~16 * 2s = 32s (last note-off lands slightly early by design)
    expect(imported.timeline.totalSeconds).toBeGreaterThan(31.5);
    expect(imported.timeline.totalSeconds).toBeLessThanOrEqual(32);
  });

  test("rejects an empty file with a clear error", () => {
    expect(() => importMidiFile("empty.mid", new Uint8Array())).toThrow(
      MuseMidiImportError,
    );
  });

  test("rejects corrupted data with a clear error", () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => importMidiFile("garbage.mid", garbage)).toThrow(
      MuseMidiImportError,
    );
  });

  test("rejects unsupported format 2 with a clear error", () => {
    const bytes = buildSyntheticAdventureMidi();
    const parsed = parseMidi(bytes);
    parsed.header.format = 2;
    const format2Bytes = new Uint8Array(writeMidi(parsed));
    expect(() => importMidiFile("format2.mid", format2Bytes)).toThrow(
      /Format 2/,
    );
  });
});

describe("exportOriginalMidi", () => {
  test("re-exports byte-for-byte identical to the imported file", () => {
    const bytes = buildSyntheticAdventureMidi();
    const project = createProjectFromMidiBytes("adventure.mid", bytes);
    const exported = exportOriginalMidi(project);
    expect(Array.from(exported)).toEqual(Array.from(bytes));
  });
});
