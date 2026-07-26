import { describe, expect, it } from "vitest"
import {
  advanceScanLines,
  createScanLines,
  DEFAULT_SCAN_CONFIG,
  sampleRowLuminance,
} from "./scanSequencer"

describe("scan sequencer", () => {
  it("creates evenly distributed scan lines", () => {
    const lines = createScanLines(4)
    expect(lines.map((line) => line.yRatio)).toEqual([0.125, 0.375, 0.625, 0.875])
  })

  it("samples row luminance from the configured camera strip", () => {
    const data = new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      0, 0, 0, 255,
      255, 255, 255, 255,
    ])
    const values = sampleRowLuminance(
      { data, width: 2, height: 2 },
      { ...DEFAULT_SCAN_CONFIG, lineCount: 2, sampleXRatio: 1, sampleWidth: 1 },
    )
    expect(values[0]).toBeCloseTo(255)
    expect(values[1]).toBeCloseTo(255)
  })

  it("does not trigger on the initialization frame", () => {
    const result = advanceScanLines(
      createScanLines(1),
      [220],
      16,
      400,
      { ...DEFAULT_SCAN_CONFIG, lineCount: 1 },
    )
    expect(result.events).toEqual([])
    expect(result.lines[0].active).toBe(false)
  })

  it("emits one event when a brightness pulse crosses the trigger line", () => {
    const config = {
      ...DEFAULT_SCAN_CONFIG,
      lineCount: 1,
      sensitivity: 20,
      pulseSpeed: 1000,
      triggerRatio: 0.5,
    }
    const initialized = advanceScanLines(
      createScanLines(1),
      [10],
      16,
      100,
      config,
    ).lines
    const activated = advanceScanLines(initialized, [100], 10, 100, config)
    expect(activated.lines[0].active).toBe(true)
    expect(activated.events).toEqual([])

    const crossed = advanceScanLines(
      activated.lines,
      [100],
      50,
      100,
      config,
    )
    expect(crossed.events).toHaveLength(1)
    expect(crossed.events[0].noteIndex).toBe(0)

    const after = advanceScanLines(crossed.lines, [100], 10, 100, config)
    expect(after.events).toEqual([])
  })
})
