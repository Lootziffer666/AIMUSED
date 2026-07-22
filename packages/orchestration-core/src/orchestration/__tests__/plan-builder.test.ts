import { describe, expect, test } from "vitest";
import { buildSyntheticAdventureProject } from "../../test-helpers/synthetic-adventure-project";
import { analyzeProject } from "../../analysis";
import { buildArrangementPlan } from "../plan-builder";
import { getInstrumentById } from "../instruments";

function analyzedProject() {
  const project = buildSyntheticAdventureProject();
  project.analysis = analyzeProject(project);
  return project;
}

describe("buildArrangementPlan", () => {
  test("assigns every track an instrument that fits the register (or warns)", () => {
    const project = analyzedProject();
    const plan = buildArrangementPlan({
      project,
      recipeId: "cinematic_adventure",
      seed: 42,
      preserveUserOverrides: false,
    });

    expect(plan.assignments.length).toBe(project.tracks.length);
    for (const assignment of plan.assignments) {
      const instrument = getInstrumentById(assignment.instrumentId.value);
      expect(instrument).toBeDefined();
    }
  });

  test("keeps melody/bass/harmony layers active across the whole piece (Wiedererkennbarkeit vor Spektakel)", () => {
    const project = analyzedProject();
    const plan = buildArrangementPlan({
      project,
      recipeId: "cinematic_adventure",
      seed: 1,
      preserveUserOverrides: false,
    });

    const melodyLayer = plan.layers.find((l) => l.name === "melody");
    expect(melodyLayer).toBeDefined();
    expect(melodyLayer!.activeRange.value.startTick).toBe(0);
    expect(melodyLayer!.activeRange.value.endTick).toBe(
      project.timeline.totalTicks,
    );
  });

  test("is fully deterministic for the same project/recipe/seed", () => {
    const project = analyzedProject();
    const planA = buildArrangementPlan({
      project,
      recipeId: "cinematic_adventure",
      seed: 7,
      preserveUserOverrides: false,
    });
    const planB = buildArrangementPlan({
      project,
      recipeId: "cinematic_adventure",
      seed: 7,
      preserveUserOverrides: false,
    });

    expect(planA.assignments.map((a) => a.instrumentId.value)).toEqual(
      planB.assignments.map((a) => a.instrumentId.value),
    );
    expect(planA.layers.map((l) => l.activeRange.value)).toEqual(
      planB.layers.map((l) => l.activeRange.value),
    );
  });

  test("locked user overrides survive a recipe re-apply", () => {
    const project = analyzedProject();
    const plan = buildArrangementPlan({
      project,
      recipeId: "cinematic_adventure",
      seed: 3,
      preserveUserOverrides: false,
    });

    const target = plan.assignments[0];
    const lockedPlan: typeof plan = {
      ...plan,
      assignments: plan.assignments.map((a) =>
        a.id === target.id
          ? {
              ...a,
              instrumentId: {
                value: "piano",
                origin: "user",
                locked: true,
                reason: "Nutzer möchte Klavier",
              },
            }
          : a,
      ),
    };

    const reapplied = buildArrangementPlan({
      project,
      recipeId: "grand_finale",
      seed: 3,
      preserveUserOverrides: true,
      existingPlan: lockedPlan,
    });

    const survived = reapplied.assignments.find((a) => a.id === target.id)!;
    expect(survived.instrumentId.value).toBe("piano");
    expect(survived.instrumentId.locked).toBe(true);
  });

  test("Intimes Ensemble mutes percussion entirely", () => {
    const project = analyzedProject();
    const plan = buildArrangementPlan({
      project,
      recipeId: "intimate_ensemble",
      seed: 5,
      preserveUserOverrides: false,
    });
    const percussionAssignments = plan.assignments.filter(
      (a) => a.role.value === "percussion",
    );
    expect(percussionAssignments.every((a) => a.muted.value === true)).toBe(
      true,
    );
  });
});
