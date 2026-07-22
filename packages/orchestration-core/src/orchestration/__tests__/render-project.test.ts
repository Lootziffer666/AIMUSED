import { describe, expect, test } from "vitest";
import { buildSyntheticAdventureProject } from "../../test-helpers/synthetic-adventure-project";
import { analyzeProject } from "../../analysis";
import { buildArrangementPlan } from "../plan-builder";
import { buildRenderableProject } from "../render-project";

// `exportArrangedMidi` (real MIDI-file serialization) now lives in
// `@signal-app/midi-project` — see `packages/midi-project/src/arranged-export.ts`
// and its test — because it depends on `buildMidiFromTracks`, which this
// package cannot import without creating a cyclic workspace dependency.

function arrangedProject(recipeId = "cinematic_adventure") {
  const project = buildSyntheticAdventureProject();
  project.analysis = analyzeProject(project);
  project.arrangement = buildArrangementPlan({
    project,
    recipeId,
    seed: 11,
    preserveUserOverrides: false,
  });
  return project;
}

describe("buildRenderableProject", () => {
  test("produces audible notes grouped by orchestral family", () => {
    const project = arrangedProject();
    const renderable = buildRenderableProject(project);

    expect(renderable.notes.length).toBeGreaterThan(0);
    expect(renderable.groups.length).toBeGreaterThan(1);
    for (const note of renderable.notes) {
      expect(note.startSeconds).toBeGreaterThanOrEqual(0);
      expect(note.durationSeconds).toBeGreaterThan(0);
      expect(note.velocity).toBeGreaterThanOrEqual(1);
      expect(note.velocity).toBeLessThanOrEqual(127);
    }
  });

  test("is deterministic for a fixed seed", () => {
    const projectA = arrangedProject();
    const projectB = arrangedProject();
    const a = buildRenderableProject(projectA);
    const b = buildRenderableProject(projectB);

    expect(a.notes.map((n) => [n.pitch, n.startTick, n.velocity])).toEqual(
      b.notes.map((n) => [n.pitch, n.startTick, n.velocity]),
    );
  });
});
