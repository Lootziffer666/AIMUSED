import { describe, expect, test } from "vitest";
import { buildSyntheticAdventureMidi } from "../../test-helpers/synthetic-adventure";
import { createProjectFromMidiBytes } from "../../project/create";
import {
  analyzeProject,
  buildArrangementPlan,
} from "@signal-app/orchestration-core";
import {
  MuseProjectFileError,
  parseProjectFile,
  serializeProjectFile,
} from "../project-file";

function fullProject() {
  const project = createProjectFromMidiBytes(
    "adventure.mid",
    buildSyntheticAdventureMidi(),
  );
  project.analysis = analyzeProject(project);
  project.arrangement = buildArrangementPlan({
    project,
    recipeId: "cinematic_adventure",
    seed: 9,
    preserveUserOverrides: false,
  });
  return project;
}

describe("project file roundtrip", () => {
  test("serialize -> parse reproduces an equivalent project", () => {
    const project = fullProject();
    const text = serializeProjectFile(project);
    const restored = parseProjectFile(text);
    expect(restored).toEqual(project);
  });

  test("rejects invalid JSON with a clear, non-crashing error", () => {
    expect(() => parseProjectFile("{ this is not json")).toThrow(
      MuseProjectFileError,
    );
  });

  test("rejects a JSON object missing required fields", () => {
    expect(() => parseProjectFile(JSON.stringify({ hello: "world" }))).toThrow(
      MuseProjectFileError,
    );
  });

  test("rejects a project file missing the MIDI source", () => {
    const project = fullProject();
    const { source, ...rest } = project as any;
    expect(() => parseProjectFile(JSON.stringify(rest))).toThrow(/MIDI-Quelle/);
  });

  test("rejects a project file from a future, unsupported schema version", () => {
    const project = fullProject();
    const future = { ...project, schemaVersion: 999 };
    expect(() => parseProjectFile(JSON.stringify(future))).toThrow(
      /neueren MUSE-Version/,
    );
  });

  test("fills in missing optional fields (variants/adaptive) for forward compatibility", () => {
    const project = fullProject();
    const { variants, adaptive, ...rest } = project as any;
    const restored = parseProjectFile(JSON.stringify(rest));
    expect(restored.variants).toEqual([]);
    expect(restored.adaptive.intensityLevels.length).toBeGreaterThan(0);
  });
});
