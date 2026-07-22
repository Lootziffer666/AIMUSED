import { describe, expect, test } from "vitest";
import { buildSyntheticAdventureProject } from "../../test-helpers/synthetic-adventure-project";
import { buildOriginalRenderableProject } from "../original-render";

describe("buildOriginalRenderableProject", () => {
  test("plays back the untouched source note-for-note", () => {
    const project = buildSyntheticAdventureProject();
    const totalSourceNotes = project.tracks.reduce(
      (sum, t) => sum + t.notes.length,
      0,
    );

    const renderable = buildOriginalRenderableProject(project);
    expect(renderable.notes.length).toBe(totalSourceNotes);
    expect(renderable.groups).toEqual([
      { id: "original", name: "Original", family: "other" },
    ]);
  });
});
