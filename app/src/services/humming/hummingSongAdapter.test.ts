import type { MuseHummingImportResult } from "@signal-app/orchestration-core"
import {
  assignHummingTrackChannel,
  buildHummingTrackNotes,
  confidenceToVelocity,
  hummingTrackName,
  PERCUSSION_CHANNEL,
  secondsToTicks,
} from "./hummingSongAdapter"

describe("secondsToTicks", () => {
  it("converts seconds to ticks at a constant tempo", () => {
    // 120 bpm -> 2 quarter notes per second -> 2 * timebase ticks per second
    expect(secondsToTicks(1, 120, 480)).toBe(960)
    expect(secondsToTicks(0.5, 120, 480)).toBe(480)
  })

  it("scales with a different tempo", () => {
    // 60 bpm -> 1 quarter note per second -> timebase ticks per second
    expect(secondsToTicks(1, 60, 480)).toBe(480)
  })

  it("never returns negative ticks", () => {
    expect(secondsToTicks(-1, 120, 480)).toBe(0)
  })

  it("rounds to the nearest whole tick", () => {
    expect(secondsToTicks(1 / 3, 120, 480)).toBe(Math.round((1 / 3) * 2 * 480))
  })
})

describe("confidenceToVelocity", () => {
  it("maps 0 confidence to the low end of the range", () => {
    expect(confidenceToVelocity(0)).toBe(40)
  })

  it("maps 1 confidence to the high end of the range", () => {
    expect(confidenceToVelocity(1)).toBe(120)
  })

  it("clamps out-of-range confidence values", () => {
    expect(confidenceToVelocity(-5)).toBe(40)
    expect(confidenceToVelocity(5)).toBe(120)
  })
})

describe("assignHummingTrackChannel", () => {
  it("always assigns channel 9 for percussion, regardless of usage", () => {
    expect(assignHummingTrackChannel([], "percussion")).toBe(PERCUSSION_CHANNEL)
    expect(assignHummingTrackChannel([0, 1, 2], "percussion")).toBe(
      PERCUSSION_CHANNEL,
    )
  })

  it("picks the lowest unused non-9 channel for melody/bass", () => {
    expect(assignHummingTrackChannel([], "melody")).toBe(0)
    expect(assignHummingTrackChannel([0], "melody")).toBe(1)
    expect(assignHummingTrackChannel([0, 1, 2], "bass")).toBe(3)
  })

  it("skips channel 9 even when it is free", () => {
    expect(
      assignHummingTrackChannel([0, 1, 2, 3, 4, 5, 6, 7, 8], "melody"),
    ).toBe(10)
  })

  it("ignores undefined channels (e.g. the conductor track)", () => {
    expect(assignHummingTrackChannel([undefined, 0], "melody")).toBe(1)
  })

  it("falls back to channel 0 when every non-percussion channel is taken", () => {
    const allNonPercussion = Array.from({ length: 16 }, (_, i) => i).filter(
      (c) => c !== PERCUSSION_CHANNEL,
    )
    expect(assignHummingTrackChannel(allNonPercussion, "melody")).toBe(0)
  })
})

describe("buildHummingTrackNotes", () => {
  const baseResult: MuseHummingImportResult = {
    recordingId: "rec-1",
    detectedNotes: [
      {
        pitch: 60.4,
        startSeconds: 0,
        durationSeconds: 0.5,
        confidence: 1,
        evidence: { frameCount: 1, onsetStrength: 1, medianPitch: 60 },
      },
      {
        pitch: 62,
        startSeconds: 0.5,
        durationSeconds: 0.25,
        confidence: 0,
        evidence: { frameCount: 1, onsetStrength: 0, medianPitch: 62 },
      },
    ],
    onsets: [],
    reviewStatus: "approved",
    quantization: { strength: 0.5, gridSubdivision: 8 },
  }

  it("converts each detected note to tick-based fields at 120bpm", () => {
    const notes = buildHummingTrackNotes(baseResult, 120, 480)
    expect(notes).toEqual([
      { tick: 0, duration: 480, noteNumber: 60, velocity: 120 },
      { tick: 480, duration: 240, noteNumber: 62, velocity: 40 },
    ])
  })

  it("rounds fractional pitches and clamps to the MIDI note range", () => {
    const result: MuseHummingImportResult = {
      ...baseResult,
      detectedNotes: [
        {
          pitch: -5,
          startSeconds: 0,
          durationSeconds: 0.1,
          confidence: 0.5,
          evidence: { frameCount: 1, onsetStrength: 0, medianPitch: -5 },
        },
        {
          pitch: 200,
          startSeconds: 0,
          durationSeconds: 0.1,
          confidence: 0.5,
          evidence: { frameCount: 1, onsetStrength: 0, medianPitch: 200 },
        },
      ],
    }
    const notes = buildHummingTrackNotes(result, 120, 480)
    expect(notes[0].noteNumber).toBe(0)
    expect(notes[1].noteNumber).toBe(127)
  })

  it("gives every note at least 1 tick of duration", () => {
    const result: MuseHummingImportResult = {
      ...baseResult,
      detectedNotes: [
        {
          pitch: 60,
          startSeconds: 0,
          durationSeconds: 0,
          confidence: 1,
          evidence: { frameCount: 1, onsetStrength: 0, medianPitch: 60 },
        },
      ],
    }
    const notes = buildHummingTrackNotes(result, 120, 480)
    expect(notes[0].duration).toBe(1)
  })
})

describe("hummingTrackName", () => {
  it("labels the track with its target role", () => {
    expect(hummingTrackName("melody")).toBe("Humming (melody)")
    expect(hummingTrackName("bass")).toBe("Humming (bass)")
    expect(hummingTrackName("percussion")).toBe("Humming (percussion)")
  })
})
