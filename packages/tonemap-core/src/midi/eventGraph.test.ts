import { describe, expect, it } from "vitest"
import { graphToJsonl, graphToTsv, notesToTsv } from "./debugFormat.ts"
import {
  graphToMidi,
  MidiGraphError,
  midiToGraph,
  secondsToTick,
  tickToSeconds,
} from "./eventGraph.ts"
import {
  buildMidiFile,
  syntheticMotifMidi,
  syntheticReferenceMidi,
  syntheticSingleNoteMidi,
} from "./synthetic.ts"

function roundTrip(bytes: Uint8Array) {
  const graph = midiToGraph(bytes)
  const written = graphToMidi(graph)
  return { graph, written, reparsed: midiToGraph(written) }
}

function eventSignature(graph: ReturnType<typeof midiToGraph>) {
  return graph.tracks.map((track) =>
    track.events.map((item) => {
      const { deltaTime: _ignored, ...rest } = item.event as unknown as Record<
        string,
        unknown
      >
      return `${item.tick}|${JSON.stringify(rest)}`
    }),
  )
}

describe("MIDI round trip", () => {
  it("keeps a single note byte-identical", () => {
    const bytes = syntheticSingleNoteMidi()
    const { written, graph } = roundTrip(bytes)
    expect(Array.from(written)).toEqual(Array.from(bytes))
    expect(graph.notes).toHaveLength(1)
    expect(graph.notes[0].startTick).toBe(0)
    expect(graph.notes[0].endTick).toBe(480)
  })

  it("keeps the awkward reference file byte-identical", () => {
    const bytes = syntheticReferenceMidi()
    const { written } = roundTrip(bytes)
    expect(Array.from(written)).toEqual(Array.from(bytes))
  })

  it("preserves every event in order across the round trip", () => {
    const { graph, reparsed } = roundTrip(syntheticReferenceMidi())
    expect(eventSignature(reparsed)).toEqual(eventSignature(graph))
  })

  it("keeps a chord as three simultaneous notes", () => {
    const { graph } = roundTrip(syntheticReferenceMidi())
    const chord = graph.notes.filter(
      (n) => n.startTick === 0 && n.trackIndex === 1 && n.channel === 0,
    )
    expect(chord.map((n) => n.noteNumber).sort((a, b) => a - b)).toEqual([
      60, 64, 67,
    ])
  })

  it("pairs overlapping notes of the same pitch first-in-first-out", () => {
    const { graph } = roundTrip(syntheticReferenceMidi())
    const overlapping = graph.notes
      .filter((n) => n.noteNumber === 72)
      .sort((a, b) => a.startTick - b.startTick)
    expect(overlapping).toHaveLength(2)
    expect(overlapping[0].startTick).toBe(960)
    expect(overlapping[0].endTick).toBe(1920)
    expect(overlapping[1].startTick).toBe(1200)
    expect(overlapping[1].endTick).toBe(2160)
    // the second note starts before the first ends
    expect(overlapping[1].startTick).toBeLessThan(overlapping[0].endTick)
  })

  it("never derives duration from the distance to the next note", () => {
    // two notes: a short one followed much later by another
    const bytes = buildMidiFile({
      tracks: [
        [
          {
            tick: 0,
            event: {
              type: "noteOn",
              channel: 0,
              noteNumber: 60,
              velocity: 80,
            } as never,
          },
          {
            tick: 120,
            event: {
              type: "noteOff",
              channel: 0,
              noteNumber: 60,
              velocity: 0,
            } as never,
          },
          {
            tick: 1920,
            event: {
              type: "noteOn",
              channel: 0,
              noteNumber: 62,
              velocity: 80,
            } as never,
          },
          {
            tick: 2040,
            event: {
              type: "noteOff",
              channel: 0,
              noteNumber: 62,
              velocity: 0,
            } as never,
          },
        ],
      ],
    })
    const graph = midiToGraph(bytes)
    expect(graph.notes[0].endTick - graph.notes[0].startTick).toBe(120)
    expect(graph.notes[1].endTick - graph.notes[1].startTick).toBe(120)
  })

  it("treats note-on with velocity 0 as note-off", () => {
    const bytes = buildMidiFile({
      tracks: [
        [
          {
            tick: 0,
            event: {
              type: "noteOn",
              channel: 0,
              noteNumber: 64,
              velocity: 90,
            } as never,
          },
          {
            tick: 240,
            event: {
              type: "noteOn",
              channel: 0,
              noteNumber: 64,
              velocity: 0,
            } as never,
          },
        ],
      ],
    })
    const graph = midiToGraph(bytes)
    expect(graph.notes).toHaveLength(1)
    expect(graph.notes[0].endTick).toBe(240)
  })

  it("keeps several channels inside one track", () => {
    const { graph } = roundTrip(syntheticReferenceMidi())
    expect(graph.tracks[1].channels).toEqual([0, 3])
    expect(graph.notes.some((n) => n.channel === 3)).toBe(true)
  })

  it("keeps identical events at the same tick", () => {
    const { graph, reparsed } = roundTrip(syntheticReferenceMidi())
    const modulation = (g: typeof graph) =>
      g.tracks[1].events.filter(
        (e) =>
          (e.event as { type: string; controllerType?: number }).type ===
            "controller" &&
          (e.event as { controllerType?: number }).controllerType === 1,
      )
    expect(modulation(graph)).toHaveLength(2)
    expect(modulation(reparsed)).toHaveLength(2)
  })

  it("keeps program changes, sustain, pitch bend and aftertouch", () => {
    const { reparsed } = roundTrip(syntheticReferenceMidi())
    const types = reparsed.tracks[1].events.map(
      (e) => (e.event as { type: string }).type,
    )
    expect(types).toContain("programChange")
    expect(types).toContain("pitchBend")
    expect(types).toContain("channelAftertouch")
    expect(types).toContain("noteAftertouch")
    const sustain = reparsed.tracks[1].events.filter(
      (e) => (e.event as { controllerType?: number }).controllerType === 64,
    )
    expect(sustain).toHaveLength(2)
  })

  it("keeps SysEx as an opaque event", () => {
    const { graph, reparsed } = roundTrip(syntheticReferenceMidi())
    expect(graph.opaque.length).toBeGreaterThan(0)
    expect(reparsed.opaque.length).toBe(graph.opaque.length)
  })

  it("keeps tempo changes, time and key signatures, markers and lyrics", () => {
    const { reparsed } = roundTrip(syntheticReferenceMidi())
    expect(reparsed.tempoMap.map((t) => t.tick)).toEqual([0, 1920])
    expect(reparsed.tempoMap[1].bpm).toBeCloseTo(150)
    expect(reparsed.timeSignatureMap[0]).toMatchObject({
      numerator: 4,
      denominator: 4,
    })
    expect(reparsed.keySignatureMap[0]).toMatchObject({ key: -3, scale: 0 })
    expect(reparsed.markers.map((m) => m.text)).toEqual(["Intro", "Theme"])
    expect(reparsed.texts.some((t) => t.kind === "lyrics")).toBe(true)
  })

  it("reports unterminated notes instead of dropping them", () => {
    const bytes = buildMidiFile({
      tracks: [
        [
          {
            tick: 0,
            event: {
              type: "noteOn",
              channel: 0,
              noteNumber: 60,
              velocity: 80,
            } as never,
          },
          {
            tick: 480,
            event: { type: "marker", text: "end", meta: true } as never,
          },
        ],
      ],
    })
    const graph = midiToGraph(bytes)
    expect(graph.notes).toHaveLength(1)
    expect(graph.notes[0].unterminated).toBe(true)
    expect(graph.warnings.some((w) => w.includes("without note-off"))).toBe(
      true,
    )
  })

  it("rejects files it cannot represent instead of guessing", () => {
    expect(() => midiToGraph(new Uint8Array([1, 2, 3]))).toThrow(MidiGraphError)
  })
})

describe("Tempo mapping", () => {
  it("converts ticks to seconds across a tempo change", () => {
    const graph = midiToGraph(syntheticReferenceMidi())
    // 1920 ticks at 120 bpm = 4 beats = 2 s
    expect(tickToSeconds(graph, 1920)).toBeCloseTo(2, 5)
    // one more beat at 150 bpm = 0.4 s
    expect(tickToSeconds(graph, 2400)).toBeCloseTo(2.4, 5)
  })

  it("round trips seconds back to ticks", () => {
    const graph = midiToGraph(syntheticReferenceMidi())
    for (const tick of [0, 480, 1920, 2400, 3840]) {
      expect(secondsToTick(graph, tickToSeconds(graph, tick))).toBeCloseTo(
        tick,
        3,
      )
    }
  })
})

describe("Debug formats", () => {
  it("writes one JSON object per event", () => {
    const graph = midiToGraph(syntheticSingleNoteMidi())
    const lines = graphToJsonl(graph, { withSeconds: true }).trim().split("\n")
    expect(lines).toHaveLength(graph.tracks[0].events.length)
    const first = JSON.parse(lines[0])
    expect(first).toHaveProperty("tick")
    expect(first).toHaveProperty("seconds")
    expect(first).not.toHaveProperty("deltaTime")
  })

  it("writes a TSV header and one row per event", () => {
    const graph = midiToGraph(syntheticMotifMidi())
    const rows = graphToTsv(graph).trim().split("\n")
    expect(rows[0].split("\t")[0]).toBe("id")
    expect(rows).toHaveLength(graph.tracks[0].events.length + 1)
  })

  it("writes a note view with explicit durations", () => {
    const graph = midiToGraph(syntheticMotifMidi())
    const rows = notesToTsv(graph).trim().split("\n")
    expect(rows).toHaveLength(graph.notes.length + 1)
    expect(rows[1].split("\t")[6]).toBe("420")
  })
})
