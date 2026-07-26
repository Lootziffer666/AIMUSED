import type { MusePerformanceTake } from "../../../entities/performance/MusePerformanceTake"
import type { JamAudioEngine } from "./JamAudioEngine"

// 4-bar loop, 16th-note grid, look-ahead scheduling
// ("A Tale of Two Clocks" pattern: setInterval + AudioContext clock)
export class LoopScheduler {
  readonly timebase: number
  bpm: number
  takes: MusePerformanceTake[] = []
  onLoopComplete?: (loopIndex: number) => void
  onPosition?: (step: number, stepsPerLoop: number) => void

  private engine: JamAudioEngine
  private timer: number | null = null
  private loopStartTime = 0
  private nextStep = 0
  private loopIndex = 0
  private readonly lookAhead = 0.12
  private readonly intervalMs = 25

  constructor(engine: JamAudioEngine, timebase: number, bpm: number) {
    this.engine = engine
    this.timebase = timebase
    this.bpm = bpm
  }

  get secondsPerTick(): number {
    return 60 / this.bpm / this.timebase
  }

  get stepTicks(): number {
    return Math.floor(this.timebase / 4)
  }

  // 4 bars of 16th notes
  get stepsPerLoop(): number {
    return 4 * 4 * 4
  }

  get loopSeconds(): number {
    return this.stepsPerLoop * this.stepTicks * this.secondsPerTick
  }

  get isRunning(): boolean {
    return this.timer !== null
  }

  get loopStart(): number {
    return this.loopStartTime
  }

  get currentLoopIndex(): number {
    return this.loopIndex
  }

  setBpm(b: number) {
    this.bpm = b
    if (this.timer !== null) {
      this.loopStartTime = this.engine.now() + 0.06
      this.nextStep = 0
    }
  }

  start() {
    if (this.timer !== null) return
    this.engine.ensureContext()
    this.loopStartTime = this.engine.now() + 0.08
    this.nextStep = 0
    this.loopIndex = 0
    this.timer = window.setInterval(this.tick, this.intervalMs)
  }

  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  currentLoopPositionTicks(): number {
    if (this.timer === null) return 0
    const elapsed = this.engine.now() - this.loopStartTime
    const wrapped =
      ((elapsed % this.loopSeconds) + this.loopSeconds) % this.loopSeconds
    return wrapped / this.secondsPerTick
  }

  private tick = () => {
    const horizon = this.engine.now() + this.lookAhead
    while (true) {
      const stepTime =
        this.loopStartTime +
        this.nextStep * this.stepTicks * this.secondsPerTick
      if (stepTime > horizon) break
      if (stepTime >= this.engine.now() - 0.03) {
        this.scheduleStep(this.nextStep, this.loopStartTime)
        this.onPosition?.(this.nextStep, this.stepsPerLoop)
      }
      this.nextStep += 1
      if (this.nextStep >= this.stepsPerLoop) {
        this.nextStep = 0
        this.loopStartTime += this.loopSeconds
        this.loopIndex += 1
        this.onLoopComplete?.(this.loopIndex)
      }
    }
  }

  private scheduleStep(step: number, loopStart: number) {
    const stepStart = step * this.stepTicks
    const stepEnd = stepStart + this.stepTicks
    const spt = this.secondsPerTick
    for (const take of this.takes) {
      for (const n of take.notes) {
        if (n.tick >= stepStart && n.tick < stepEnd) {
          this.engine.playMelodicNoteAt(
            loopStart + n.tick * spt,
            take,
            n.noteNumber,
            n.velocity,
            Math.max(0.08, n.duration * spt),
          )
        }
      }
      for (const h of take.drumHits) {
        if (h.tick >= stepStart && h.tick < stepEnd) {
          this.engine.playDrumAt(loopStart + h.tick * spt, h.zoneId, h.velocity)
        }
      }
    }
  }
}
