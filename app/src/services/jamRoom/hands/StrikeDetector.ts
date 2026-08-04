// Detects drum strikes from wrist motion:
// a strike = wrist inside a zone + fast downward movement,
// with a per-zone cooldown to prevent machine-gun retriggers.

export class StrikeDetector {
  readonly cooldownMs: number
  readonly minSpeed: number // frame-heights per second, downward

  private lastHit: Record<string, number> = {}
  private prev: { x: number; y: number; t: number } | null = null

  constructor(opts?: { cooldownMs?: number; minSpeed?: number }) {
    this.cooldownMs = opts?.cooldownMs ?? 130
    this.minSpeed = opts?.minSpeed ?? 0.9
  }

  // Returns strike speed (frame-heights/sec) when a strike happened.
  update(
    zoneId: string | null,
    nx: number,
    ny: number,
    tMs: number,
  ): { speed: number } | null {
    let speed = 0
    if (this.prev) {
      const dt = (tMs - this.prev.t) / 1000
      if (dt > 0) speed = (ny - this.prev.y) / dt // positive = downward
    }
    this.prev = { x: nx, y: ny, t: tMs }

    if (!zoneId) return null
    const last = this.lastHit[zoneId] ?? Number.NEGATIVE_INFINITY
    if (speed > this.minSpeed && tMs - last > this.cooldownMs) {
      this.lastHit[zoneId] = tMs
      return { speed }
    }
    return null
  }
}

// Frame-heights/sec -> MIDI velocity
export function velocityFromHandSpeed(speedFhPerSec: number): number {
  return Math.round(Math.min(127, Math.max(30, 30 + speedFhPerSec * 24)))
}
