import { TrackId } from "@signal-app/core"
import {
  AppliedOrchestrationTrack,
  filterEventsByTrackIds,
  groupAppliedTracksByFamily,
} from "./orchestrationExport"

describe("filterEventsByTrackIds", () => {
  it("keeps only events whose trackId is in the given set", () => {
    const events = [
      { trackId: 1, tick: 0 },
      { trackId: 2, tick: 10 },
      { trackId: 3, tick: 20 },
      { trackId: 2, tick: 30 },
    ]

    const result = filterEventsByTrackIds(events, new Set([2]))

    expect(result).toEqual([
      { trackId: 2, tick: 10 },
      { trackId: 2, tick: 30 },
    ])
  })

  it("returns an empty array when no events match", () => {
    const events = [{ trackId: 1, tick: 0 }]
    expect(filterEventsByTrackIds(events, new Set([99]))).toEqual([])
  })

  it("returns all events when the set covers every trackId", () => {
    const events = [
      { trackId: 1, tick: 0 },
      { trackId: 2, tick: 10 },
    ]
    expect(filterEventsByTrackIds(events, new Set([1, 2]))).toEqual(events)
  })
})

describe("groupAppliedTracksByFamily", () => {
  it("groups tracks by groupId, preserving first-seen group order", () => {
    const tracks: AppliedOrchestrationTrack[] = [
      { trackId: 1 as TrackId, groupId: "strings", groupName: "Strings" },
      { trackId: 2 as TrackId, groupId: "brass", groupName: "Brass" },
      { trackId: 3 as TrackId, groupId: "strings", groupName: "Strings" },
    ]

    const groups = groupAppliedTracksByFamily(tracks)

    expect(groups).toEqual([
      { groupId: "strings", groupName: "Strings", trackIds: [1, 3] },
      { groupId: "brass", groupName: "Brass", trackIds: [2] },
    ])
  })

  it("returns an empty array for no tracks", () => {
    expect(groupAppliedTracksByFamily([])).toEqual([])
  })
})
