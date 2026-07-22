import { describe, expect, test } from "vitest";
import { buildSyntheticAdventureProject } from "../../test-helpers/synthetic-adventure-project";
import { analyzeProject } from "../../analysis";
import { buildArrangementPlan } from "../../orchestration/plan-builder";
import { buildDefaultVariants } from "../builder";
import { buildAdaptiveMetadata } from "../adaptive";

function arrangedProject() {
  const project = buildSyntheticAdventureProject();
  project.analysis = analyzeProject(project);
  project.arrangement = buildArrangementPlan({
    project,
    recipeId: "cinematic_adventure",
    seed: 6,
    preserveUserOverrides: false,
  });
  return project;
}

describe("buildDefaultVariants", () => {
  test("produces exactly the six required baseline variants", () => {
    const project = arrangedProject();
    const variants = buildDefaultVariants(project.arrangement!);
    const kinds: string[] = variants.map((v) => v.kind);
    expect(kinds.sort()).toEqual(
      ["combat", "danger", "exploration", "finale", "full", "reduced"].sort(),
    );
  });

  test("Reduced keeps core roles and drops auxiliary layers relative to Full", () => {
    const project = arrangedProject();
    const variants = buildDefaultVariants(project.arrangement!);
    const full = variants.find((v) => v.kind === "full")!;
    const reduced = variants.find((v) => v.kind === "reduced")!;
    expect(reduced.enabledLayers.length).toBeLessThanOrEqual(
      full.enabledLayers.length,
    );
    expect(reduced.intensity).toBeLessThan(full.intensity);
  });

  test("every variant references the same base arrangement", () => {
    const project = arrangedProject();
    const variants = buildDefaultVariants(project.arrangement!);
    expect(
      variants.every((v) => v.baseArrangementId === project.arrangement!.id),
    ).toBe(true);
  });
});

describe("buildAdaptiveMetadata", () => {
  test("prepares cue points and loop regions without running any adaptive logic itself", () => {
    const project = arrangedProject();
    const variants = buildDefaultVariants(project.arrangement!);
    const adaptive = buildAdaptiveMetadata(
      project.arrangement!,
      variants,
      project.timeline.ticksPerQuarterNote * 4,
    );

    expect(adaptive.cuePoints.length).toBeGreaterThan(0);
    expect(adaptive.intensityLevels.length).toBeGreaterThan(0);
    for (const cue of adaptive.cuePoints) {
      expect(
        cue.compatibleVariantIds.every((id) =>
          variants.some((v) => v.id === id),
        ),
      ).toBe(true);
    }
  });
});
