import { describe, expect, it } from "vitest"
import type { MusePerformanceTake } from "../../entities/performance/MusePerformanceTake"
import {
  assignRoleAutomatically,
  calculateLoopPosition,
  calculateVelocityFromSpeed,
  generateKeyBoundNotes,
  handleCameraError,
  layerTakeWithoutOverwriting,
  millisecondsToLoopTick,
  normalizeTake,
  protectOriginalTakes,
  shouldGenerateAccompaniment,
  snapToScale,
  testDrumZoneHit,
  undoLastTake,
} from "./jamRoomUtils"

const take = (
  overrides: Partial<MusePerformanceTake> = {},
): MusePerformanceTake => ({
  id: "take-1",
  source: "voice",
  notes: [],
  drumHits: [],
  controls: [],
  confidence: 0.9,
  role: "melody",
  loopStartTick: 0,
  loopLengthTicks: 7680,
  createdAt: "2026-07-26T00:00:00.000Z",
  ...overrides,
})

describe("Jam Room logic", () => {
  it("normalizes notes, drum hits and confidence", () => {
    const result = normalizeTake(
      take({
        notes: [
          { tick: -3, duration: 0, noteNumber: 200, velocity: 100 },
          { tick: 10.4, duration: 40.6, noteNumber: 60.2, velocity: 140 },
        ],
        drumHits: [
          { tick: 4.4, zoneId: "kick", velocity: 200, confidence: 2 },
        ],
        confidence: 1.5,
      }),
    )
    expect(result.notes).toEqual([
      { tick: 10, duration: 41, noteNumber: 60, velocity: 127 },
    ])
    expect(result.drumHits[0]).toMatchObject({
      tick: 4,
      velocity: 127,
      confidence: 1,
    })
    expect(result.confidence).toBe(1)
  })

  it("tests rectangular drum-zone hits", () => {
    const zone = {
      id: "kick",
      x: 100,
      y: 100,
      width: 50,
      height: 50,
      instrument: "kick",
    }
    expect(testDrumZoneHit(zone, 125, 125)).toBe(true)
    expect(testDrumZoneHit(zone, 50, 50)).toBe(false)
  })

  it("maps gesture speed to MIDI velocity", () => {
    expect(calculateVelocityFromSpeed(0)).toBe(1)
    expect(calculateVelocityFromSpeed(10)).toBe(50)
    expect(calculateVelocityFromSpeed(50)).toBe(127)
  })

  it("snaps across octave boundaries to the nearest scale note", () => {
    expect(snapToScale(71, 0, [0, 2, 4, 5, 7, 9, 11])).toBe(71)
    expect(snapToScale(73, 0, [0, 2, 4, 5, 7, 9, 11])).toBe(72)
    expect(
      generateKeyBoundNotes([61], 0, [0, 2, 4, 5, 7, 9, 11])[0]
        .noteNumber,
    ).toBe(60)
  })

  it("converts wall-clock timing into a shared loop position", () => {
    expect(calculateLoopPosition(2000, 1920)).toBe(80)
    expect(calculateLoopPosition(-10, 1920)).toBe(1910)
    expect(millisecondsToLoopTick(1000, 120, 480, 7680)).toBe(960)
  })

  it("layers and undoes takes without mutation", () => {
    const first = take({ id: "1" })
    const second = take({ id: "2" })
    const layered = layerTakeWithoutOverwriting([first], second)
    expect(layered).toHaveLength(2)
    expect(undoLastTake(layered)).toEqual([first])
  })

  it("assigns roles automatically", () => {
    expect(assignRoleAutomatically("voice", false)).toBe("melody")
    expect(assignRoleAutomatically("voice", true)).toBe("percussion")
    expect(assignRoleAutomatically("painted-drums", false)).toBe("percussion")
    expect(assignRoleAutomatically("gesture-instrument", false)).toBe("guitar")
  })

  it("only creates accompaniment after a valid melody take", () => {
    expect(
      shouldGenerateAccompaniment([
        take({
          notes: [{ tick: 0, duration: 480, noteNumber: 60, velocity: 80 }],
        }),
      ]),
    ).toBe(true)
    expect(shouldGenerateAccompaniment([take({ confidence: 0.2 })])).toBe(false)
    expect(
      shouldGenerateAccompaniment([
        take({ role: "percussion", source: "painted-drums" }),
      ]),
    ).toBe(false)
  })

  it("preserves original take identities", () => {
    const original = [take({ id: "1" })]
    const mutated = [take({ id: "1", confidence: 0 }), take({ id: "2" })]
    expect(protectOriginalTakes(original, mutated)).toEqual([
      original[0],
      mutated[1],
    ])
  })

  it("handles camera failures without throwing", () => {
    expect(handleCameraError(new DOMException("", "NotAllowedError"))).toContain(
      "verweigert",
    )
    expect(handleCameraError(new DOMException("", "NotFoundError"))).toContain(
      "Keine Kamera",
    )
    expect(handleCameraError(new Error("boom"))).toContain("ohne Video")
  })
})
