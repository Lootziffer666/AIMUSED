import { describe, expect, test } from "vitest";
import { buildSyntheticAdventureMidi } from "../../test-helpers/synthetic-adventure";
import { bytesToBase64 } from "@signal-app/orchestration-core/shared";
import { applyCommand, makeImportCommand, MuseCommandError } from "../reducer";
import type { MuseMidiProject } from "../../project/types";

function importedProject(): MuseMidiProject {
  const bytesBase64 = bytesToBase64(buildSyntheticAdventureMidi());
  return applyCommand(null, makeImportCommand("adventure.mid", bytesBase64));
}

describe("applyCommand", () => {
  test("IMPORT_MIDI creates an analyzed project from nothing", () => {
    const project = importedProject();
    expect(project.tracks.length).toBe(4);
    expect(project.analysis).not.toBeNull();
    expect(project.arrangement).toBeNull();
  });

  test("APPLY_RECIPE builds an arrangement plan", () => {
    const project = importedProject();
    const next = applyCommand(project, {
      type: "APPLY_RECIPE",
      recipeId: "cinematic_adventure",
      preserveUserOverrides: false,
      seed: 1,
    });
    expect(next.arrangement).not.toBeNull();
    expect(next.arrangement!.recipeId).toBe("cinematic_adventure");
  });

  test("SET_TRACK_ROLE fails clearly before an arrangement exists", () => {
    const project = importedProject();
    expect(() =>
      applyCommand(project, {
        type: "SET_TRACK_ROLE",
        trackId: project.tracks[0].id,
        role: "melody",
      }),
    ).toThrow(MuseCommandError);
  });

  test("manual overrides are locked and survive a later recipe re-apply", () => {
    const project = importedProject();
    const withRecipe = applyCommand(project, {
      type: "APPLY_RECIPE",
      recipeId: "cinematic_adventure",
      preserveUserOverrides: false,
      seed: 1,
    });
    const targetAssignment = withRecipe.arrangement!.assignments[0];

    const withOverride = applyCommand(withRecipe, {
      type: "ASSIGN_INSTRUMENT",
      targetId: targetAssignment.id,
      instrumentId: "piano",
    });
    const overridden = withOverride.arrangement!.assignments.find(
      (a) => a.id === targetAssignment.id,
    )!;
    expect(overridden.instrumentId.value).toBe("piano");
    expect(overridden.instrumentId.locked).toBe(true);

    const reapplied = applyCommand(withOverride, {
      type: "APPLY_RECIPE",
      recipeId: "grand_finale",
      preserveUserOverrides: true,
      seed: 1,
    });
    const stillOverridden = reapplied.arrangement!.assignments.find(
      (a) => a.id === targetAssignment.id,
    )!;
    expect(stillOverridden.instrumentId.value).toBe("piano");
  });

  test("rejects an invalid octave shift without touching the project", () => {
    const project = importedProject();
    const withRecipe = applyCommand(project, {
      type: "APPLY_RECIPE",
      recipeId: "cinematic_adventure",
      preserveUserOverrides: false,
      seed: 1,
    });
    const targetAssignment = withRecipe.arrangement!.assignments[0];

    expect(() =>
      applyCommand(withRecipe, {
        type: "SET_OCTAVE_SHIFT",
        targetId: targetAssignment.id,
        octaveShift: 99,
      }),
    ).toThrow(MuseCommandError);
    // The project reference itself is untouched by the failed attempt.
    expect(withRecipe.arrangement!.assignments[0].octaveShift.value).toBe(
      targetAssignment.octaveShift.value,
    );
  });

  test("rejects assigning an unknown instrument", () => {
    const project = importedProject();
    const withRecipe = applyCommand(project, {
      type: "APPLY_RECIPE",
      recipeId: "cinematic_adventure",
      preserveUserOverrides: false,
      seed: 1,
    });
    const targetAssignment = withRecipe.arrangement!.assignments[0];
    expect(() =>
      applyCommand(withRecipe, {
        type: "ASSIGN_INSTRUMENT",
        targetId: targetAssignment.id,
        instrumentId: "not-a-real-instrument",
      }),
    ).toThrow(MuseCommandError);
  });

  test("LOCK_MELODY forces melody role and unmutes the track", () => {
    const project = importedProject();
    const withRecipe = applyCommand(project, {
      type: "APPLY_RECIPE",
      recipeId: "intimate_ensemble",
      preserveUserOverrides: false,
      seed: 1,
    });
    const bassTrack = project.tracks.find((t) => t.name === "Bass")!;

    const locked = applyCommand(withRecipe, {
      type: "LOCK_MELODY",
      sourceTrackId: bassTrack.id,
    });
    const assignment = locked.arrangement!.assignments.find(
      (a) => a.targetTrackId === bassTrack.id,
    )!;
    expect(assignment.role.value).toBe("melody");
    expect(assignment.muted.value).toBe(false);
    expect(assignment.role.locked).toBe(true);
  });
});
