import { describe, expect, it } from "vitest"
import type { InstrumentLibraryManifest } from "../libraries/manifest.ts"
import { midiToGraph } from "../midi/eventGraph.ts"
import { syntheticMotifMidi } from "../midi/synthetic.ts"
import { buildMotifGraph } from "../motifs/motifGraph.ts"
import {
  assignInstrument,
  createPlanFromGraph,
  type OrchestrationPlan,
} from "../orchestration/plan.ts"
import type { PatchCandidate } from "../schema/tonemap.ts"
import { LIBRARY_MANIFEST_SCHEMA_VERSION } from "../schema/version.ts"
import {
  createRenderAdapter,
  describeJobs,
  FluidSynthRenderAdapter,
  MidiRenderAdapter,
  SfizzRenderAdapter,
} from "./adapters.ts"
import { createRenderManifest, isStale, planFingerprint } from "./manifest.ts"
import { planToMidi, planToStemMidi } from "./renderPlan.ts"

/**
 * Rendering is planned, not executed: an adapter says what to write and what
 * to run. So the tests check exactly that – valid MIDI, sane channels, honest
 * issues when a patch cannot be resolved, and a manifest that notices when the
 * plan has moved on.
 */

function fixture(): {
  plan: OrchestrationPlan
  graph: ReturnType<typeof midiToGraph>
} {
  const graph = midiToGraph(syntheticMotifMidi())
  const plan = createPlanFromGraph(graph, buildMotifGraph(graph), {
    toneMapProjectId: "project-1",
  })
  return { plan, graph }
}

function candidate(overrides: Partial<PatchCandidate> = {}): PatchCandidate {
  return {
    patchId: "lib:violin",
    libraryId: "lib",
    displayName: "Violin",
    family: "strings",
    instrument: "violin",
    articulation: "sustain",
    score: 0.9,
    reasons: ["register: sits in the comfortable range"],
    ...overrides,
  }
}

function sfzLibrary(rootPath?: string): InstrumentLibraryManifest {
  return {
    schemaVersion: LIBRARY_MANIFEST_SCHEMA_VERSION,
    id: "lib",
    name: "Test library",
    rootPath,
    patches: [
      {
        id: "lib:violin",
        displayName: "Violin",
        family: "strings",
        instrument: "violin",
        articulation: "sustain",
        range: { lowMidi: 55, highMidi: 100 },
        sfzPath: "Strings/violin.sfz",
      },
      {
        id: "lib:no-sfz",
        displayName: "Preset only",
        family: "keys",
        instrument: "piano",
        articulation: "sustain",
        range: { lowMidi: 21, highMidi: 108 },
        soundFontPreset: { bank: 0, program: 0 },
      },
    ],
  }
}

describe("planToMidi", () => {
  it("writes a MIDI file that reads back as the same notes", () => {
    const { plan, graph } = fixture()
    const result = planToMidi(plan, { source: graph })
    const reread = midiToGraph(result.bytes)

    const planned = plan.parts.flatMap((part) => part.notes)
    expect(reread.notes).toHaveLength(planned.length)
    expect(reread.ticksPerQuarterNote).toBe(graph.ticksPerQuarterNote)

    const pitches = (list: { noteNumber: number }[]) =>
      list.map((note) => note.noteNumber).sort((a, b) => a - b)
    expect(pitches(reread.notes)).toEqual(pitches(planned))
  })

  it("keeps the conductor track from the source", () => {
    const { plan, graph } = fixture()
    const reread = midiToGraph(planToMidi(plan, { source: graph }).bytes)
    expect(reread.tempoMap.length).toBe(graph.tempoMap.length)
    expect(reread.tempoMap[0]?.bpm).toBeCloseTo(
      graph.tempoMap[0]?.bpm ?? 120,
      3,
    )
  })

  it("gives every part its own channel and keeps 10 for percussion", () => {
    const { plan } = fixture()
    const many: OrchestrationPlan = {
      ...plan,
      parts: Array.from({ length: 4 }, (_, i) => ({
        ...plan.parts[0],
        id: `part-${i}`,
        label: `part ${i}`,
        family: i === 2 ? ("percussion" as const) : ("strings" as const),
      })),
    }
    const { assignments } = planToMidi(many)
    expect(assignments.find((a) => a.partId === "part-2")?.channel).toBe(9)
    const melodic = assignments
      .filter((a) => a.partId !== "part-2")
      .map((a) => a.channel)
    expect(new Set(melodic).size).toBe(melodic.length)
    expect(melodic).not.toContain(9)
  })

  it("says so when there are more parts than channels", () => {
    const { plan } = fixture()
    const many: OrchestrationPlan = {
      ...plan,
      parts: Array.from({ length: 20 }, (_, i) => ({
        ...plan.parts[0],
        id: `part-${i}`,
        label: `part ${i}`,
      })),
    }
    const { warnings } = planToMidi(many)
    expect(warnings.join(" ")).toContain("more parts than MIDI channels")
  })

  it("writes the chosen preset as a program change", () => {
    const { plan } = fixture()
    const patches = {
      [plan.parts[0].id]: candidate({
        soundFontPreset: { bank: 2, program: 42 },
      }),
    }
    const reread = midiToGraph(planToMidi(plan, { patches }).bytes)
    const programs = reread.tracks
      .flatMap((track) => track.events)
      .filter(
        (item) => (item.event as { type?: string }).type === "programChange",
      )
    expect(programs.length).toBeGreaterThan(0)
  })

  it("skips muted parts", () => {
    const { plan } = fixture()
    const muted: OrchestrationPlan = {
      ...plan,
      parts: plan.parts.map((part, index) => ({ ...part, muted: index === 0 })),
    }
    const stems = planToStemMidi(muted)
    expect(stems.map((stem) => stem.partId)).not.toContain(plan.parts[0].id)
  })

  it("turns a prominence envelope into volume changes", () => {
    const { plan } = fixture()
    const withEnvelope: OrchestrationPlan = {
      ...plan,
      parts: [
        {
          ...plan.parts[0],
          prominence: {
            points: [
              { tick: 0, value: 0.2 },
              { tick: 1920, value: 1 },
            ],
          },
        },
      ],
    }
    const reread = midiToGraph(planToMidi(withEnvelope).bytes)
    const volumes = reread.tracks
      .flatMap((track) => track.events)
      .map((item) => item.event as { type?: string; controllerType?: number })
      .filter(
        (event) => event.type === "controller" && event.controllerType === 7,
      )
    expect(volumes.length).toBeGreaterThan(1)
  })
})

describe("MidiRenderAdapter", () => {
  it("gives stems with the same label distinct file names", () => {
    const { plan } = fixture()
    const duplicated: OrchestrationPlan = {
      ...plan,
      parts: [
        { ...plan.parts[0], id: "a", label: "Theme" },
        { ...plan.parts[0], id: "b", label: "Theme" },
        { ...plan.parts[0], id: "c", label: "Theme" },
      ],
    }
    const jobs = new MidiRenderAdapter().plan({
      plan: duplicated,
      libraries: [],
      patches: {},
      outputDirectory: "render",
    })
    const paths = jobs.filter((job) => job.partId).map((job) => job.outputPath)
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths).toEqual([
      "render/theme.mid",
      "render/theme-2.mid",
      "render/theme-3.mid",
    ])
  })

  it("plans a mix and one stem per part, and needs nothing installed", () => {
    const { plan, graph } = fixture()
    const jobs = new MidiRenderAdapter().plan({
      plan,
      libraries: [],
      patches: {},
      outputDirectory: "render",
      source: graph,
    })
    expect(jobs[0].id).toBe("mix")
    expect(jobs).toHaveLength(1 + plan.parts.length)
    for (const job of jobs) {
      expect(job.inputs[0].bytes.length).toBeGreaterThan(0)
      expect(job.outputPath.endsWith(".mid")).toBe(true)
      expect(job.issues).toEqual([])
    }
  })
})

describe("SfizzRenderAdapter", () => {
  it("builds a command when the library root is configured", () => {
    const { plan } = fixture()
    const patches = Object.fromEntries(
      plan.parts.map((part) => [part.id, candidate()]),
    )
    const jobs = new SfizzRenderAdapter().plan({
      plan,
      libraries: [sfzLibrary("/opt/samples")],
      patches,
      outputDirectory: "render",
      sampleRate: 44100,
    })
    expect(jobs[0].command?.program).toBe("sfizz_render")
    expect(jobs[0].command?.args).toContain("/opt/samples/Strings/violin.sfz")
    expect(jobs[0].command?.args).toContain("44100")
    expect(jobs[0].issues).toEqual([])
  })

  it("reports a missing library root instead of inventing a path", () => {
    const { plan } = fixture()
    const patches = Object.fromEntries(
      plan.parts.map((part) => [part.id, candidate()]),
    )
    const jobs = new SfizzRenderAdapter().plan({
      plan,
      libraries: [sfzLibrary()],
      patches,
      outputDirectory: "render",
    })
    expect(jobs[0].command).toBeUndefined()
    expect(jobs[0].issues.join(" ")).toContain("rootPath")
  })

  it("reports a patch that has no SFZ", () => {
    const { plan } = fixture()
    const patches = Object.fromEntries(
      plan.parts.map((part) => [
        part.id,
        candidate({ patchId: "lib:no-sfz", displayName: "Preset only" }),
      ]),
    )
    const jobs = new SfizzRenderAdapter().plan({
      plan,
      libraries: [sfzLibrary("/opt/samples")],
      patches,
      outputDirectory: "render",
    })
    expect(jobs[0].issues.join(" ")).toContain("no sfzPath")
  })

  it("reports a part with no chosen patch", () => {
    const { plan } = fixture()
    const jobs = new SfizzRenderAdapter().plan({
      plan,
      libraries: [sfzLibrary("/opt/samples")],
      patches: {},
      outputDirectory: "render",
    })
    expect(jobs[0].issues.join(" ")).toContain("no patch chosen")
  })
})

describe("FluidSynthRenderAdapter", () => {
  it("builds one command for the whole arrangement", () => {
    const { plan } = fixture()
    const patches = Object.fromEntries(
      plan.parts.map((part) => [
        part.id,
        candidate({ soundFontPreset: { bank: 0, program: 40 } }),
      ]),
    )
    const jobs = new FluidSynthRenderAdapter().plan({
      plan,
      libraries: [],
      patches,
      outputDirectory: "render",
      soundFontPath: "/usr/share/sf2/general.sf2",
    })
    expect(jobs).toHaveLength(1)
    expect(jobs[0].command?.program).toBe("fluidsynth")
    expect(jobs[0].command?.display).toContain("general.sf2")
    expect(jobs[0].issues).toEqual([])
  })

  it("says what is missing without a SoundFont", () => {
    const { plan } = fixture()
    const jobs = new FluidSynthRenderAdapter().plan({
      plan,
      libraries: [],
      patches: {},
      outputDirectory: "render",
    })
    expect(jobs[0].command).toBeUndefined()
    expect(jobs[0].issues.join(" ")).toContain("no SoundFont given")
    expect(jobs[0].issues.join(" ")).toContain("no SoundFont preset")
  })
})

describe("adapter registry", () => {
  it("creates the three adapters by name", () => {
    expect(createRenderAdapter("midi").name).toBe("midi")
    expect(createRenderAdapter("sfizz").name).toBe("sfizz")
    expect(createRenderAdapter("FluidSynth").name).toBe("fluidsynth")
  })

  it("lists the available adapters when the name is unknown", () => {
    expect(() => createRenderAdapter("reaper")).toThrow(
      /available: midi, sfizz, fluidsynth/,
    )
  })

  it("describes a dry run in words", () => {
    const { plan } = fixture()
    const jobs = new MidiRenderAdapter().plan({
      plan,
      libraries: [],
      patches: {},
      outputDirectory: "render",
    })
    const text = describeJobs(jobs)
    expect(text).toContain("write render/arrangement.mid")
    expect(text).toContain("nothing to run")
  })
})

describe("render manifest", () => {
  it("records the patches and why they were chosen", () => {
    const { plan } = fixture()
    const patches = { [plan.parts[0].id]: candidate() }
    const jobs = new MidiRenderAdapter().plan({
      plan,
      libraries: [],
      patches,
      outputDirectory: "render",
    })
    const manifest = createRenderManifest({
      adapter: "midi",
      plan,
      patches,
      jobs,
      outputDirectory: "render",
      libraries: [{ id: "lib", name: "Test library", version: "1.0" }],
      now: "2026-01-01T00:00:00.000Z",
    })

    expect(manifest.schemaVersion).toBe("muse.render-manifest.v1")
    expect(manifest.toneMapProjectId).toBe("project-1")
    expect(manifest.patches[0].reasons[0]).toContain("comfortable range")
    expect(manifest.outputs).toHaveLength(jobs.length)
  })

  it("counts a MIDI render as complete even though nothing runs", () => {
    const { plan } = fixture()
    const jobs = new MidiRenderAdapter().plan({
      plan,
      libraries: [],
      patches: {},
      outputDirectory: "render",
    })
    // the written file *is* the output, so there is nothing left to execute
    expect(jobs.every((job) => job.command === undefined)).toBe(true)
    const manifest = createRenderManifest({
      adapter: "midi",
      plan,
      patches: {},
      jobs,
      outputDirectory: "render",
      libraries: [],
    })
    expect(manifest.complete).toBe(true)
  })

  it("is incomplete when a job has issues or no command", () => {
    const { plan } = fixture()
    const jobs = new SfizzRenderAdapter().plan({
      plan,
      libraries: [sfzLibrary()],
      patches: {},
      outputDirectory: "render",
    })
    const manifest = createRenderManifest({
      adapter: "sfizz",
      plan,
      patches: {},
      jobs,
      outputDirectory: "render",
      libraries: [],
    })
    expect(manifest.complete).toBe(false)
    expect(manifest.outputs[0].issues.length).toBeGreaterThan(0)
  })

  it("notices when the plan has moved on since the render", () => {
    const { plan } = fixture()
    const patches = { [plan.parts[0].id]: candidate() }
    const manifest = createRenderManifest({
      adapter: "midi",
      plan,
      patches,
      jobs: [],
      outputDirectory: "render",
      libraries: [],
    })
    expect(isStale(manifest, plan, patches)).toBe(false)

    const changed = assignInstrument(plan, plan.parts[0].id, {
      family: "brass",
      instrument: "trumpet",
    })
    expect(isStale(manifest, changed, patches)).toBe(true)
  })

  it("gives the same fingerprint for the same plan", () => {
    const { plan } = fixture()
    const patches = { [plan.parts[0].id]: candidate() }
    expect(planFingerprint(plan, patches)).toBe(planFingerprint(plan, patches))
  })
})
