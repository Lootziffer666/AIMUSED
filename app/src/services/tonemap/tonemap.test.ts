import {
  encodeWav,
  midiToGraph,
  syntheticMotifMidi,
  wavDecoder,
} from "@signal-app/tonemap-core"
import { describe, expect, it } from "vitest"
import { ToneMapStore } from "../../stores/ToneMapStore"
import { BUILTIN_LIBRARY_ID, createBuiltinLibrary } from "./builtinLibrary"
import { analyze, assetWarnings, manifestFor } from "./pipeline"
import { sniffAudioFormat } from "./webAudioDecoder"

/**
 * The app side of the tone map: format sniffing, the pipeline glue and the
 * workspace store. The analysis itself is covered in `tonemap-core`.
 */

function loadedMidi() {
  const bytes = syntheticMotifMidi()
  // identical to what loadMidiFile produces, minus the File wrapper
  return { fileName: "theme.mid", bytes, graph: midiToGraph(bytes) }
}

describe("sniffAudioFormat", () => {
  it("recognizes a WAV container from its bytes", () => {
    const wav = encodeWav({
      sampleRate: 8000,
      channels: [new Float32Array(64)],
      frameCount: 64,
    })
    expect(sniffAudioFormat(wav)).toBe("wav")
  })

  it("recognizes FLAC, Ogg Vorbis, Opus and MP3 signatures", () => {
    const pad = (head: number[]) => {
      const bytes = new Uint8Array(64)
      bytes.set(head)
      return bytes
    }
    const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))

    expect(sniffAudioFormat(pad(ascii("fLaC")))).toBe("flac")

    const opus = new Uint8Array(64)
    opus.set(ascii("OggS"))
    opus.set(ascii("OpusHead"), 28)
    expect(sniffAudioFormat(opus)).toBe("opus")

    const vorbis = new Uint8Array(64)
    vorbis.set(ascii("OggS"))
    vorbis.set(ascii("vorbis"), 28)
    expect(sniffAudioFormat(vorbis)).toBe("ogg")

    expect(sniffAudioFormat(pad(ascii("ID3")))).toBe("mp3")
    expect(sniffAudioFormat(pad([0xff, 0xfb, 0x90, 0x00]))).toBe("mp3")
  })

  it("returns undefined instead of guessing", () => {
    expect(sniffAudioFormat(new Uint8Array(64))).toBeUndefined()
  })
})

describe("manifestFor", () => {
  it("puts referenced media into the ignored directories", () => {
    const manifest = manifestFor(loadedMidi(), null, { id: "theme" })
    expect(manifest.midi.path).toBe("reference-midi/theme.mid")
    expect(assetWarnings(manifest)).toEqual([])
  })

  it("defaults to not redistributable", () => {
    const manifest = manifestFor(loadedMidi(), null, { id: "theme" })
    expect(manifest.rights.publiclyRedistributable).toBe(false)
    expect(manifest.rights.analysisAllowedLocally).toBe(true)
  })

  it("warns when a path escapes the ignored directories", () => {
    const manifest = manifestFor(loadedMidi(), null, { id: "theme" })
    const escaped = {
      ...manifest,
      midi: { ...manifest.midi, path: "assets/x.mid" },
    }
    expect(assetWarnings(escaped)[0]).toContain("must not be committed")
  })
})

describe("analyze", () => {
  it("builds a project with observations from MIDI alone", () => {
    const midi = loadedMidi()
    const manifest = manifestFor(midi, null, { id: "theme" })
    const result = analyze({
      midi,
      audio: null,
      manifest,
      projectName: "theme",
    })

    expect(result.project.observations.length).toBeGreaterThan(0)
    expect(result.alignment).toBeUndefined()
    for (const observation of result.project.observations) {
      expect(observation.acousticFeatures).toBeUndefined()
      expect(observation.confidence).toBeLessThanOrEqual(1)
    }
  })

  it("leaves the source bytes untouched", () => {
    const midi = loadedMidi()
    const before = Uint8Array.from(midi.bytes)
    analyze({
      midi,
      audio: null,
      manifest: manifestFor(midi, null, { id: "theme" }),
      projectName: "theme",
    })
    expect(Array.from(midi.bytes)).toEqual(Array.from(before))
  })
})

describe("ToneMapStore", () => {
  it("starts with the built-in library and no project", () => {
    const store = new ToneMapStore()
    expect(store.project).toBeNull()
    expect(store.libraries).toHaveLength(1)
    expect(store.libraries[0].id).toBe(BUILTIN_LIBRARY_ID)
  })

  it("records a manual correction as manually confirmed", () => {
    const store = new ToneMapStore()
    const midi = loadedMidi()
    store.setAnalysis(
      analyze({
        midi,
        audio: null,
        manifest: manifestFor(midi, null, { id: "theme" }),
        projectName: "theme",
      }),
    )
    const first = store.project?.observations[0]
    expect(first).toBeDefined()
    if (!first) return

    store.updateObservation(first.id, (entry) => ({
      ...entry,
      musicalFunction: {
        value: "counter-melody",
        provenance: {
          ...entry.musicalFunction.provenance,
          source: "user",
          status: "manually-confirmed",
          confidence: 1,
        },
      },
    }))

    const updated = store.project?.observations[0]
    expect(updated?.musicalFunction.value).toBe("counter-melody")
    expect(updated?.musicalFunction.provenance.status).toBe(
      "manually-confirmed",
    )
  })

  it("replaces a library with the same id instead of stacking duplicates", () => {
    const store = new ToneMapStore()
    store.addLibrary({ ...createBuiltinLibrary(), name: "renamed" })
    expect(store.libraries).toHaveLength(1)
    expect(store.libraries[0].name).toBe("renamed")
  })

  it("keeps manual anchors sorted by tick", () => {
    const store = new ToneMapStore()
    const anchor = (midiTick: number) => ({
      midiTick,
      midiBeat: midiTick / 480,
      audioTimeSeconds: midiTick / 480,
      confidence: 1,
      method: "manual-anchor",
      manual: true,
    })
    store.addManualAnchor(anchor(960))
    store.addManualAnchor(anchor(0))
    expect(store.manualAnchors.map((a) => a.midiTick)).toEqual([0, 960])
    store.removeManualAnchor(0)
    expect(store.manualAnchors.map((a) => a.midiTick)).toEqual([960])
  })

  it("clears the error when new work starts", () => {
    const store = new ToneMapStore()
    store.setError("boom")
    expect(store.busy).toBeNull()
    store.setBusy("analyzing")
    expect(store.error).toBeNull()
  })
})

describe("built-in library", () => {
  it("states a locator but no measured timbre", () => {
    const library = createBuiltinLibrary()
    for (const patch of library.patches) {
      expect(patch.soundFontPreset).toBeDefined()
      // the program number locates the sound, it is not the semantics
      expect(patch.timbre).toBeUndefined()
      expect(patch.family).toBeTruthy()
      expect(patch.range.lowMidi).toBeLessThan(patch.range.highMidi)
    }
  })

  it("decodes its own WAV fixtures through the pure decoder", () => {
    const wav = encodeWav({
      sampleRate: 8000,
      channels: [Float32Array.from({ length: 16 }, (_, i) => i / 16)],
      frameCount: 16,
    })
    const pcm = wavDecoder.decode(wav)
    expect(pcm.sampleRate).toBe(8000)
    expect(pcm.frameCount).toBe(16)
  })
})
