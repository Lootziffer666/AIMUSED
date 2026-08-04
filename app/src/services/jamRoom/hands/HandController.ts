import type { HandFrame, TrackedHand } from "./HandTracker"
import { handRoll, isFist, isOpenHand, WRIST } from "./landmarks"
import { StrikeDetector } from "./StrikeDetector"

export type ThereminHandEvent =
  | { type: "on"; t: number; speed: number } // t = normalized height, 1 = high
  | { type: "move"; t: number; vibratoCents: number; bendCents: number }
  | { type: "off" }

export interface HandControllerOptions {
  toStage: (nx: number, ny: number) => { x: number; y: number }
  zoneIdAt: (xPx: number, yPx: number) => string | null
  onDrumStrike: (xPx: number, yPx: number, speed: number) => void
  onTheremin: (e: ThereminHandEvent) => void
}

// Assigns roles (left hand = expression instrument, right hand = drums)
// and turns landmark streams into musical events.
export class HandController {
  // Swap left/right assignment (calibration for mirrored views)
  swapped = false
  lastAssigned: { side: "left" | "right"; hand: TrackedHand }[] = []

  private opts: HandControllerOptions
  private strike = new StrikeDetector()
  private thereminActive = false
  private lastLeftSeen = Number.NEGATIVE_INFINITY
  private prevLeft: { x: number; y: number; t: number } | null = null
  private leftVx = 0

  constructor(opts: HandControllerOptions) {
    this.opts = opts
  }

  handleFrame(frame: HandFrame) {
    this.lastAssigned = []

    let left: TrackedHand | null = null
    let right: TrackedHand | null = null
    for (const h of frame.hands) {
      // MediaPipe labels are IMAGE space; the selfie view mirrors them,
      // so a hand labeled "Left" in the image is the user's RIGHT hand.
      const userSide: "left" | "right" =
        h.handedness === "Left" ? "right" : "left"
      const side: "left" | "right" = this.swapped
        ? userSide === "left"
          ? "right"
          : "left"
        : userSide
      if (side === "left" && !left) left = h
      else if (side === "right" && !right) right = h
    }
    if (left) this.lastAssigned.push({ side: "left", hand: left })
    if (right) this.lastAssigned.push({ side: "right", hand: right })

    this.updateTheremin(left, frame.timeMs)
    this.updateDrums(right, frame.timeMs)
  }

  // Open hand -> sustain, fist -> mute, hand lost -> off
  private updateTheremin(hand: TrackedHand | null, timeMs: number) {
    if (!hand) {
      this.prevLeft = null
      if (this.thereminActive && timeMs - this.lastLeftSeen > 250) {
        this.thereminActive = false
        this.opts.onTheremin({ type: "off" })
      }
      return
    }
    this.lastLeftSeen = timeMs
    const lm = hand.landmarks
    const wrist = lm[WRIST]

    let speed = 0
    if (this.prevLeft) {
      const dt = (timeMs - this.prevLeft.t) / 1000
      if (dt > 0) {
        this.leftVx = (wrist.x - this.prevLeft.x) / dt
        speed =
          Math.hypot(wrist.x - this.prevLeft.x, wrist.y - this.prevLeft.y) / dt
      }
    }
    this.prevLeft = { x: wrist.x, y: wrist.y, t: timeMs }

    const t = 1 - wrist.y
    if (this.thereminActive) {
      if (isFist(lm)) {
        this.thereminActive = false
        this.opts.onTheremin({ type: "off" })
      } else {
        // knuckle roll -> vibrato depth, lateral speed -> pitch bend
        const rollDeg = handRoll(lm)
        const vibratoCents = 4 + Math.min(1, rollDeg / 60) * 26
        const bendCents = Math.max(-60, Math.min(60, this.leftVx * 45))
        this.opts.onTheremin({ type: "move", t, vibratoCents, bendCents })
      }
    } else if (isOpenHand(lm)) {
      this.thereminActive = true
      this.opts.onTheremin({ type: "on", t, speed })
    }
  }

  private updateDrums(hand: TrackedHand | null, timeMs: number) {
    if (!hand) return
    const wrist = hand.landmarks[WRIST]
    const stage = this.opts.toStage(wrist.x, wrist.y)
    const zoneId = this.opts.zoneIdAt(stage.x, stage.y)
    const strike = this.strike.update(zoneId, wrist.x, wrist.y, timeMs)
    if (strike) {
      this.opts.onDrumStrike(stage.x, stage.y, strike.speed)
    }
  }

  // Call on disable/unmount so a sustained note never gets stuck
  reset() {
    if (this.thereminActive) {
      this.thereminActive = false
      this.opts.onTheremin({ type: "off" })
    }
    this.lastAssigned = []
  }
}
