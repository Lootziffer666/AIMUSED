import { describe, expect, it } from "vitest"
import { videoToStage } from "./hands/coordMap"
import { HandController, type ThereminHandEvent } from "./hands/HandController"
import {
  extendedFingerCount,
  type HandLandmarks,
  handRoll,
  isFist,
  isOpenHand,
  type Landmark,
  pinchDistance,
} from "./hands/landmarks"
import { StrikeDetector, velocityFromHandSpeed } from "./hands/StrikeDetector"

// Synthetic 21-point hand. Fingers point up from the wrist.
function makeHand(extended: boolean, wx = 0.5, wy = 0.9): HandLandmarks {
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({
    x: wx,
    y: wy,
    z: 0,
  }))
  lm[0] = { x: wx, y: wy, z: 0 }
  const cols = [
    { mcp: 5, pip: 6, dip: 7, tip: 8, dx: -0.06 },
    { mcp: 9, pip: 10, dip: 11, tip: 12, dx: -0.02 },
    { mcp: 13, pip: 14, dip: 15, tip: 16, dx: 0.02 },
    { mcp: 17, pip: 18, dip: 19, tip: 20, dx: 0.06 },
  ]
  for (const f of cols) {
    // Curled fingers fold back towards the palm, so the tip ends up closer
    // to the wrist than the PIP joint – that is what makes a fist a fist.
    lm[f.mcp] = { x: wx + f.dx, y: wy - 0.15, z: 0 }
    lm[f.pip] = { x: wx + f.dx, y: wy - (extended ? 0.3 : 0.1), z: 0 }
    lm[f.dip] = { x: wx + f.dx, y: wy - (extended ? 0.4 : 0.12), z: 0 }
    lm[f.tip] = { x: wx + f.dx, y: wy - (extended ? 0.5 : 0.05), z: 0 }
  }
  lm[1] = { x: wx - 0.08, y: wy - 0.05, z: 0 }
  lm[2] = { x: wx - 0.12, y: wy - 0.1, z: 0 }
  lm[3] = { x: wx - 0.14, y: wy - 0.15, z: 0 }
  lm[4] = { x: wx - 0.15, y: wy - 0.2, z: 0 }
  return lm
}

describe("Geometric gestures", () => {
  it("counts extended fingers", () => {
    expect(extendedFingerCount(makeHand(true))).toBe(4)
    expect(extendedFingerCount(makeHand(false))).toBe(0)
  })

  it("detects open hand and fist", () => {
    expect(isOpenHand(makeHand(true))).toBe(true)
    expect(isOpenHand(makeHand(false))).toBe(false)
    expect(isFist(makeHand(false))).toBe(true)
    expect(isFist(makeHand(true))).toBe(false)
  })

  it("measures wrist roll from the knuckle line", () => {
    expect(handRoll(makeHand(true))).toBeLessThan(5)
    const rotated = makeHand(true)
    rotated[17] = { x: rotated[17].x, y: rotated[17].y - 0.12, z: 0 } // 45 deg
    expect(handRoll(rotated)).toBeGreaterThan(40)
    expect(handRoll(rotated)).toBeLessThan(50)
  })

  it("normalizes pinch distance by hand size", () => {
    const open = makeHand(true)
    const pinching = makeHand(true)
    pinching[4] = {
      ...pinching[8],
      x: pinching[8].x - 0.01,
      y: pinching[8].y + 0.01,
    }
    expect(pinchDistance(pinching)).toBeLessThan(pinchDistance(open))
  })
})

describe("Strike detector", () => {
  it("fires on fast downward motion inside a zone, respects cooldown", () => {
    const d = new StrikeDetector()
    expect(d.update("kick", 0.5, 0.3, 0)).toBeNull() // first frame
    expect(d.update("kick", 0.5, 0.305, 16)).toBeNull() // slow drift
    expect(d.update("kick", 0.5, 0.36, 32)).not.toBeNull() // 3.4 fh/s strike
    expect(d.update("kick", 0.5, 0.42, 48)).toBeNull() // cooldown
    expect(d.update("kick", 0.5, 0.7, 200)).not.toBeNull() // after cooldown
    expect(d.update(null, 0.5, 0.8, 216)).toBeNull() // outside any zone
  })

  it("keeps per-zone cooldowns independent", () => {
    const d = new StrikeDetector()
    d.update("kick", 0.2, 0.3, 0)
    expect(d.update("kick", 0.2, 0.36, 16)).not.toBeNull()
    // other zone, still inside the kick cooldown window
    expect(d.update("snare", 0.8, 0.42, 24)).not.toBeNull()
    expect(d.update("kick", 0.2, 0.48, 32)).toBeNull()
  })

  it("maps hand speed to velocity", () => {
    expect(velocityFromHandSpeed(0)).toBe(30)
    expect(velocityFromHandSpeed(2)).toBe(78)
    expect(velocityFromHandSpeed(10)).toBe(127)
  })
})

describe("Video-to-stage mapping", () => {
  it("keeps the center at the center", () => {
    const p = videoToStage(0.5, 0.5, 1600, 900, 800, 600)
    expect(p.x).toBeCloseTo(400)
    expect(p.y).toBeCloseTo(300)
  })

  it("mirrors x for the flipped video display", () => {
    const a = videoToStage(0.25, 0.5, 1600, 900, 800, 600)
    const b = videoToStage(0.75, 0.5, 1600, 900, 800, 600)
    expect(a.x + b.x).toBeCloseTo(800)
    expect(a.x).toBeGreaterThan(b.x) // left in video appears right on screen
  })
})

describe("Hand controller", () => {
  interface Sink {
    theremin: ThereminHandEvent[]
    strikes: { x: number; y: number; speed: number }[]
  }
  function makeController(
    zoneIdAt: (x: number, y: number) => string | null = () => null,
  ) {
    const sink: Sink = { theremin: [], strikes: [] }
    const ctrl = new HandController({
      toStage: (nx, ny) => ({ x: nx * 800, y: ny * 600 }),
      zoneIdAt,
      onDrumStrike: (x, y, speed) => sink.strikes.push({ x, y, speed }),
      onTheremin: (e) => sink.theremin.push(e),
    })
    return { sink, ctrl }
  }

  it("opens the theremin on an open left hand, mutes on fist", () => {
    const { sink, ctrl } = makeController()
    // model label "Right" in image space = user's LEFT hand
    ctrl.handleFrame({
      hands: [{ landmarks: makeHand(true), handedness: "Right", score: 0.9 }],
      timeMs: 0,
    })
    expect(sink.theremin).toHaveLength(1)
    expect(sink.theremin[0].type).toBe("on")
    ctrl.handleFrame({
      hands: [{ landmarks: makeHand(false), handedness: "Right", score: 0.9 }],
      timeMs: 50,
    })
    expect(sink.theremin[1].type).toBe("off")
  })

  it("emits move events with vibrato and bend while sustaining", () => {
    const { sink, ctrl } = makeController()
    ctrl.handleFrame({
      hands: [
        {
          landmarks: makeHand(true, 0.5, 0.9),
          handedness: "Right",
          score: 0.9,
        },
      ],
      timeMs: 0,
    })
    ctrl.handleFrame({
      hands: [
        {
          landmarks: makeHand(true, 0.55, 0.7),
          handedness: "Right",
          score: 0.9,
        },
      ],
      timeMs: 100,
    })
    const move = sink.theremin.find((e) => e.type === "move")
    expect(move).toBeDefined()
    if (move && move.type === "move") {
      expect(move.vibratoCents).toBeGreaterThan(0)
      expect(move.bendCents).toBeGreaterThan(0) // moved right
    }
  })

  it("turns the theremin off when the hand disappears", () => {
    const { sink, ctrl } = makeController()
    ctrl.handleFrame({
      hands: [{ landmarks: makeHand(true), handedness: "Right", score: 0.9 }],
      timeMs: 0,
    })
    ctrl.handleFrame({ hands: [], timeMs: 400 })
    expect(sink.theremin[sink.theremin.length - 1].type).toBe("off")
  })

  it("triggers drum strikes with the right hand", () => {
    const { sink, ctrl } = makeController(() => "kick")
    // model label "Left" in image space = user's RIGHT hand
    ctrl.handleFrame({
      hands: [
        { landmarks: makeHand(true, 0.5, 0.3), handedness: "Left", score: 0.9 },
      ],
      timeMs: 0,
    })
    ctrl.handleFrame({
      hands: [
        {
          landmarks: makeHand(true, 0.5, 0.36),
          handedness: "Left",
          score: 0.9,
        },
      ],
      timeMs: 16,
    })
    expect(sink.strikes).toHaveLength(1)
    expect(sink.strikes[0].x).toBeCloseTo(400)
  })

  it("swaps hand roles when calibrated", () => {
    const { sink, ctrl } = makeController(() => "kick")
    ctrl.swapped = true
    ctrl.handleFrame({
      hands: [
        { landmarks: makeHand(true, 0.5, 0.3), handedness: "Left", score: 0.9 },
      ],
      timeMs: 0,
    })
    ctrl.handleFrame({
      hands: [
        {
          landmarks: makeHand(true, 0.5, 0.36),
          handedness: "Left",
          score: 0.9,
        },
      ],
      timeMs: 16,
    })
    expect(sink.strikes).toHaveLength(0) // now the theremin hand, no drums
    expect(sink.theremin.some((e) => e.type === "on")).toBe(true)
  })

  it("reset() releases a stuck sustain", () => {
    const { sink, ctrl } = makeController()
    ctrl.handleFrame({
      hands: [{ landmarks: makeHand(true), handedness: "Right", score: 0.9 }],
      timeMs: 0,
    })
    ctrl.reset()
    expect(sink.theremin[sink.theremin.length - 1].type).toBe("off")
  })
})
