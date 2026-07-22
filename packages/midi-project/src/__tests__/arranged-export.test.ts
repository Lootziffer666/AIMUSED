import {
  analyzeProject,
  buildArrangementPlan,
} from "@signal-app/orchestration-core";
import { describe, expect, test } from "vitest";
import { buildSyntheticAdventureMidi } from "../test-helpers/synthetic-adventure";
import { createProjectFromMidiBytes } from "../project/create";
import { exportArrangedMidi } from "../arranged-export";
import { parseMidi } from "midi-file";

function arrangedProject(recipeId = "cinematic_adventure") {
  const project = createProjectFromMidiBytes(
    "adventure.mid",
    buildSyntheticAdventureMidi(),
  );
  project.analysis = analyzeProject(project);
  project.arrangement = buildArrangementPlan({
    project,
    recipeId,
    seed: 11,
    preserveUserOverrides: false,
  });
  return project;
}

describe("exportArrangedMidi", () => {
  test("produces a parseable, multi-track Format-1 MIDI file", () => {
    const project = arrangedProject();
    const bytes = exportArrangedMidi(project);
    const parsed = parseMidi(bytes);

    expect(parsed.header.format).toBe(1);
    expect(parsed.header.ticksPerBeat).toBe(
      project.timeline.ticksPerQuarterNote,
    );
    expect(parsed.tracks.length).toBeGreaterThan(2); // conductor + several instrument tracks

    const hasNotes = parsed.tracks.some((track) =>
      track.some((e) => e.type === "noteOn"),
    );
    expect(hasNotes).toBe(true);
  });

  test("differs audibly from the original — arranged MIDI is not just relabeled", () => {
    const project = arrangedProject();
    const arranged = exportArrangedMidi(project);
    const parsedArranged = parseMidi(arranged);
    const parsedOriginal = parseMidi(buildSyntheticAdventureMidi());

    // More instrument tracks in the arrangement thanks to climax doubling.
    expect(parsedArranged.tracks.length).toBeGreaterThan(
      parsedOriginal.tracks.length,
    );
  });

  test("is reproducible: same project/seed/recipe -> identical arranged MIDI bytes", () => {
    const projectA = arrangedProject();
    const projectB = arrangedProject();
    const bytesA = exportArrangedMidi(projectA);
    const bytesB = exportArrangedMidi(projectB);
    expect(Array.from(bytesA)).toEqual(Array.from(bytesB));
  });
});
