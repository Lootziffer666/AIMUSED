import { describe, expect, it } from "vitest"
import { alignMidiToAudio } from "../alignment/alignment.ts"
import { DeterministicFeatureExtractor } from "../audio/features.ts"
import { syntheticMotifAudio } from "../audio/synthetic.ts"
import { midiToGraph } from "../midi/eventGraph.ts"
import { syntheticMotifMidi } from "../midi/synthetic.ts"
import {
  deriveTimbreComplements,
  normalizeTimbreVector,
  TIMBRE_AXES,
} from "../schema/tonemap.ts"
import {
  parseToneMapProject,
  serializeToneMapProject,
} from "../schema/validate.ts"
import { MigrationRegistry, SchemaError } from "../schema/version.ts"
import { buildToneMapProject } from "./observations.ts"

const graph = midiToGraph(syntheticMotifMidi())
const extractor = new DeterministicFeatureExtractor()

describe("Tone map project", () => {
  it("builds an identity graph of song, voices, phrases and motifs", () => {
    const { project } = buildToneMapProject(graph, { id: "t1", name: "Theme" })
    const kinds = new Set(project.nodes.map((node) => node.kind))
    expect(kinds.has("song")).toBe(true)
    expect(kinds.has("voice")).toBe(true)
    expect(kinds.has("phrase")).toBe(true)
    expect(kinds.has("motif")).toBe(true)
    expect(kinds.has("motif-occurrence")).toBe(true)
    expect(project.schemaVersion).toBe("muse.tonemap.v1")
  })

  it("links motif variants to their motif with the transform", () => {
    const { project } = buildToneMapProject(graph, { id: "t1", name: "Theme" })
    const occurrence = project.nodes.find(
      (node) => node.kind === "motif-occurrence",
    )
    expect(occurrence?.variantOfId).toBeDefined()
    expect(occurrence?.variantTransform).toHaveProperty("transposeSemitones")
  })

  it("gives every observation evidence and a confidence", () => {
    const { project } = buildToneMapProject(graph, { id: "t1", name: "Theme" })
    expect(project.observations.length).toBeGreaterThan(0)
    for (const observation of project.observations) {
      expect(observation.confidence).toBeGreaterThan(0)
      expect(observation.confidence).toBeLessThanOrEqual(1)
      expect(
        observation.musicalFunction.provenance.extractionMethod,
      ).toBeTruthy()
      expect(observation.evidence.length).toBeGreaterThan(0)
    }
  })

  it("recognises the bass voice and the melody", () => {
    const { project } = buildToneMapProject(graph, { id: "t1", name: "Theme" })
    const functions = project.observations.map(
      (observation) => observation.musicalFunction.value,
    )
    expect(functions).toContain("bass")
    expect(
      functions.some(
        (fn) => fn === "primary-melody" || fn === "counter-melody",
      ),
    ).toBe(true)
  })

  it("puts the melody further forward than the bass", () => {
    const { project } = buildToneMapProject(graph, { id: "t1", name: "Theme" })
    const melody = project.observations.find(
      (observation) => observation.musicalFunction.value === "primary-melody",
    )
    const bass = project.observations.find(
      (observation) => observation.musicalFunction.value === "bass",
    )
    if (melody && bass) {
      expect(melody.prominence.value.level).toBeGreaterThan(
        bass.prominence.value.level,
      )
    }
  })

  it("works without audio and says so through lower confidence", () => {
    const symbolicOnly = buildToneMapProject(graph, { id: "t1", name: "Theme" })
    const observation = symbolicOnly.project.observations[0]
    expect(observation.acousticFeatures).toBeUndefined()
    expect(observation.timbreIntent.density).toBeDefined()
    expect(observation.prominence.provenance.confidence).toBeLessThan(0.5)
  })

  it("adds acoustic features and timbre when audio is aligned", () => {
    const features = extractor.extract(
      syntheticMotifAudio({ sampleRate: 22050 }),
    )
    const alignment = alignMidiToAudio(graph, features)
    const { project } = buildToneMapProject(graph, {
      id: "t1",
      name: "Theme",
      features,
      alignment,
      sourcePairId: "pair-1",
    })
    const observation = project.observations[0]
    expect(observation.acousticFeatures).toBeDefined()
    expect(observation.timbreIntent.brightness).toBeGreaterThan(0)
    expect(project.sourcePairId).toBe("pair-1")
    expect(
      observation.evidence.some((entry) => entry.kind === "audio-feature"),
    ).toBe(true)
  })
})

describe("Timbre axes", () => {
  it("derives complements instead of storing them twice", () => {
    const full = deriveTimbreComplements({
      brightness: 0.8,
      softness: 0.3,
      movement: 0.6,
    })
    expect(full.darkness).toBeCloseTo(0.2)
    expect(full.hardness).toBeCloseTo(0.7)
    expect(full.stability).toBeCloseTo(0.4)
    expect(full.smoothness).toBeUndefined() // roughness was not given
  })

  it("folds complement input back onto the canonical axis", () => {
    const vector = normalizeTimbreVector({ darkness: 0.75, hardness: 0.25 })
    expect(vector.brightness).toBeCloseTo(0.25)
    expect(vector.softness).toBeCloseTo(0.75)
  })

  it("prefers the canonical axis when both are given", () => {
    const vector = normalizeTimbreVector({ brightness: 0.9, darkness: 0.9 })
    expect(vector.brightness).toBe(0.9)
  })

  it("keeps every axis inside 0..1", () => {
    const vector = normalizeTimbreVector(
      Object.fromEntries(TIMBRE_AXES.map((axis) => [axis, 5])),
    )
    for (const axis of TIMBRE_AXES) expect(vector[axis]).toBe(1)
  })
})

describe("Schema validation and migration", () => {
  const { project } = buildToneMapProject(graph, { id: "t1", name: "Theme" })

  it("accepts a valid project", () => {
    const parsed = parseToneMapProject(
      JSON.parse(serializeToneMapProject(project)),
    )
    expect(parsed.ok).toBe(true)
    expect(parsed.value?.nodes.length).toBe(project.nodes.length)
  })

  it("rejects an unknown version instead of guessing", () => {
    const parsed = parseToneMapProject({
      ...project,
      schemaVersion: "muse.tonemap.v9",
    })
    expect(parsed.ok).toBe(false)
    expect(parsed.errors[0].message).toContain("unknown schema version")
  })

  it("reports missing mandatory fields", () => {
    const { ticksPerQuarterNote: _dropped, ...broken } = project
    const parsed = parseToneMapProject(broken)
    expect(parsed.ok).toBe(false)
    expect(
      parsed.errors.some((issue) => issue.path.includes("ticksPerQuarterNote")),
    ).toBe(true)
  })

  it("runs a registered migration hook", () => {
    const registry = new MigrationRegistry("muse.tonemap.v1", [
      {
        from: "muse.tonemap.v0",
        to: "muse.tonemap.v1",
        migrate: (document) => ({
          ...document,
          name: `${document.name} (migrated)`,
        }),
      },
    ])
    const parsed = parseToneMapProject(
      { ...project, schemaVersion: "muse.tonemap.v0" },
      registry,
    )
    expect(parsed.ok).toBe(true)
    expect(parsed.value?.name).toBe("Theme (migrated)")
  })

  it("keeps unknown fields through a round trip", () => {
    const withExtra = {
      ...JSON.parse(serializeToneMapProject(project)),
      experimentalTag: "written by a newer MUSE",
    }
    const parsed = parseToneMapProject(withExtra)
    expect(parsed.ok).toBe(true)
    expect(parsed.value?.unknownFields?.experimentalTag).toBe(
      "written by a newer MUSE",
    )

    const written = JSON.parse(serializeToneMapProject(parsed.value!))
    expect(written.experimentalTag).toBe("written by a newer MUSE")
  })

  it("warns instead of failing for a dangling reference", () => {
    const parsed = parseToneMapProject({
      ...project,
      observations: [
        { ...project.observations[0], sourceRef: "does-not-exist" },
      ],
    })
    expect(parsed.ok).toBe(true)
    expect(
      parsed.warnings.some((issue) => issue.message.includes("no node")),
    ).toBe(true)
  })

  it("refuses duplicate migrations", () => {
    const registry = new MigrationRegistry("v1")
    registry.register({ from: "v0", to: "v1", migrate: (d) => d })
    expect(() =>
      registry.register({ from: "v0", to: "v1", migrate: (d) => d }),
    ).toThrow(SchemaError)
  })
})
