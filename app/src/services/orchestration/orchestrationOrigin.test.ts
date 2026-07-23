import { TrackId } from "@signal-app/core"
import type {
  MuseArrangementPlan,
  MuseInstrumentAssignment,
} from "@signal-app/orchestration-core"
import { AppliedOrchestrationTrack } from "./orchestrationExport"
import { findTrackOrchestrationOrigin } from "./orchestrationOrigin"

function buildAssignment(
  overrides: Partial<MuseInstrumentAssignment> = {},
): MuseInstrumentAssignment {
  return {
    id: "assignment-1",
    targetTrackId: "muse-track-1",
    role: { value: "melody", origin: "analysis", locked: false, reason: "Detected as the main melodic line." },
    instrumentId: {
      value: "violin",
      origin: "recipe",
      locked: false,
      reason: "Cinematic Adventure recipe prefers strings for melody.",
    },
    doublingInstrumentIds: { value: [], origin: "recipe", locked: false, reason: "" },
    octaveShift: { value: 0, origin: "recipe", locked: false, reason: "" },
    articulation: { value: "legato", origin: "recipe", locked: false, reason: "" },
    muted: { value: false, origin: "recipe", locked: false, reason: "" },
    ...overrides,
  }
}

function buildPlan(assignments: MuseInstrumentAssignment[]): MuseArrangementPlan {
  return {
    id: "plan-1",
    recipeId: "cinematic_adventure",
    sourceProjectId: "project-1",
    createdAt: new Date().toISOString(),
    seed: 1,
    sections: [],
    assignments,
    dynamics: [],
    layers: [],
    warnings: [],
  }
}

describe("findTrackOrchestrationOrigin", () => {
  const trackId = 42 as TrackId
  const assignment = buildAssignment()
  const plan = buildPlan([assignment])
  const appliedTrack: AppliedOrchestrationTrack = {
    trackId,
    groupId: "strings",
    groupName: "Strings",
    assignmentId: assignment.id,
  }

  it("returns undefined when there is no arrangement loaded", () => {
    expect(
      findTrackOrchestrationOrigin([appliedTrack], null, trackId),
    ).toBeUndefined()
  })

  it("returns undefined for a track that was never applied by orchestration", () => {
    const otherTrackId = 99 as TrackId
    expect(
      findTrackOrchestrationOrigin([appliedTrack], plan, otherTrackId),
    ).toBeUndefined()
  })

  it("returns undefined for an applied track with no assignmentId recorded", () => {
    const legacyTrack: AppliedOrchestrationTrack = {
      trackId,
      groupId: "strings",
      groupName: "Strings",
    }
    expect(
      findTrackOrchestrationOrigin([legacyTrack], plan, trackId),
    ).toBeUndefined()
  })

  it("returns undefined when the assignmentId no longer resolves against the current arrangement (stale)", () => {
    const staleAppliedTrack: AppliedOrchestrationTrack = {
      ...appliedTrack,
      assignmentId: "assignment-does-not-exist",
    }
    expect(
      findTrackOrchestrationOrigin([staleAppliedTrack], plan, trackId),
    ).toBeUndefined()
  })

  it("resolves the instrument-assignment origin/reason/role for an applied track", () => {
    const result = findTrackOrchestrationOrigin([appliedTrack], plan, trackId)

    expect(result).toEqual({
      origin: "recipe",
      reason: "Cinematic Adventure recipe prefers strings for melody.",
      role: "melody",
    })
  })
})
