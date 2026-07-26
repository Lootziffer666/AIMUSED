import { describe, expect, it } from "vitest"
import {
  buildSongMakerEvents,
  createEmptySongMakerPattern,
  hasSongMakerContent,
  songMakerStepEvents,
  toggleSongMakerCell,
} from "./songMaker"

describe("song maker grid", () => {
  it("creates an empty 14 by 16 melody grid and five drum lanes", () => {
    const pattern = createEmptySongMakerPattern()
    expect(pattern.melody).toHaveLength(14)
    expect(pattern.melody[0]).toHaveLength(16)
    expect(pattern.drums).toHaveLength(5)
    expect(hasSongMakerContent(pattern)).toBe(false)
  })

  it("toggles cells immutably", () => {
    const original = createEmptySongMakerPattern()
    const changed = toggleSongMakerCell(original, "melody", 2, 3)
    expect(changed).not.toBe(original)
    expect(original.melody[2][3]).toBe(false)
    expect(changed.melody[2][3]).toBe(true)
  })

  it("builds scale-bound notes and drum hits on timebase-derived steps", () => {
    let pattern = createEmptySongMakerPattern()
    pattern = toggleSongMakerCell(pattern, "melody", 12, 1)
    pattern = toggleSongMakerCell(pattern, "drums", 0, 4)

    const events = buildSongMakerEvents(pattern, 480)
    expect(events.melodyNotes).toEqual([
      {
        tick: 120,
        duration: 120,
        noteNumber: 60,
        velocity: 82,
      },
    ])
    expect(events.drumHits[0]).toMatchObject({
      tick: 480,
      zoneId: "kick",
      velocity: 112,
    })
    expect(events.loopLengthTicks).toBe(1920)
  })

  it("returns only events belonging to the requested preview step", () => {
    let pattern = createEmptySongMakerPattern()
    pattern = toggleSongMakerCell(pattern, "melody", 13, 0)
    pattern = toggleSongMakerCell(pattern, "melody", 11, 1)
    const events = buildSongMakerEvents(pattern, 480)

    expect(songMakerStepEvents(events, 0, 480).melodyNotes).toHaveLength(1)
    expect(songMakerStepEvents(events, 1, 480).melodyNotes).toHaveLength(1)
    expect(songMakerStepEvents(events, 2, 480).melodyNotes).toHaveLength(0)
  })
})
