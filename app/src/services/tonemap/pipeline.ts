import type {
  AlignmentMap,
  AlignmentPoint,
  AudioFeatureResult,
  MidiGraph,
  MotifGraph,
  PairedSourceManifest,
  PcmBuffer,
  ToneMapProject,
} from "@signal-app/tonemap-core"
import {
  alignMidiToAudio,
  buildToneMapProject,
  checkManifestAssets,
  createPairedSourceManifest,
  DeterministicFeatureExtractor,
  guessAudioFormat,
  midiToGraph,
} from "@signal-app/tonemap-core"
import {
  createBrowserDecoderRegistry,
  sniffAudioFormat,
} from "./webAudioDecoder"

/**
 * Glue between the browser and `tonemap-core`.
 *
 * Everything here happens locally: files are read through the file input, no
 * byte leaves the machine, and the imported MIDI is never written back.
 */

export interface LoadedMidi {
  fileName: string
  bytes: Uint8Array
  graph: MidiGraph
}

export interface LoadedAudio {
  fileName: string
  format: string
  pcm: PcmBuffer
  features: AudioFeatureResult
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}

export async function loadMidiFile(file: File): Promise<LoadedMidi> {
  const bytes = await readFileBytes(file)
  return { fileName: file.name, bytes, graph: midiToGraph(bytes) }
}

export interface AnalyzeAudioOptions {
  getContext: () => BaseAudioContext
  /** Analysis is deterministic, so the frame size is part of the result */
  frameSize?: number
  hopSize?: number
}

export async function loadAudioFile(
  file: File,
  options: AnalyzeAudioOptions,
): Promise<LoadedAudio> {
  const bytes = await readFileBytes(file)
  const format =
    sniffAudioFormat(bytes) ?? guessAudioFormat(file.name) ?? "unknown"
  const registry = createBrowserDecoderRegistry(options.getContext)
  const pcm = await registry.decodeAsync(format, bytes)
  const extractor = new DeterministicFeatureExtractor()
  const features = extractor.extract(pcm, {
    frameSize: options.frameSize,
    hopSize: options.hopSize,
  })
  return { fileName: file.name, format, pcm, features }
}

/**
 * Manifest for a pair. Paths are the *file names* the user picked, not
 * handles: nothing is copied into the project, and the rights flags stay at
 * the conservative default until someone says otherwise.
 */
export function manifestFor(
  midi: LoadedMidi,
  audio: LoadedAudio | null,
  options: { id: string; title?: string } = { id: "pair" },
): PairedSourceManifest {
  return createPairedSourceManifest({
    id: options.id,
    title: options.title,
    midiPath: `reference-midi/${midi.fileName}`,
    audioPath: audio ? `reference-audio/${audio.fileName}` : undefined,
    audioFormat: audio
      ? (guessAudioFormat(audio.fileName) ?? undefined)
      : undefined,
  })
}

export function assetWarnings(manifest: PairedSourceManifest): string[] {
  return checkManifestAssets(manifest)
    .filter((check) => !check.isPrivateLocation)
    .map((check) => check.message ?? check.path)
}

export interface AnalysisResult {
  project: ToneMapProject
  motifGraph: MotifGraph
  alignment?: AlignmentMap
}

export function analyze(options: {
  midi: LoadedMidi
  audio: LoadedAudio | null
  manifest: PairedSourceManifest
  manualAnchors?: AlignmentPoint[]
  projectName: string
}): AnalysisResult {
  const { midi, audio, manifest, manualAnchors, projectName } = options

  const alignment = audio
    ? alignMidiToAudio(midi.graph, audio.features, {
        knownOffsetMs: manifest.relationship.knownOffsetMs,
        manualAnchors,
        sourcePairId: manifest.id,
      })
    : undefined

  const { project, motifGraph } = buildToneMapProject(midi.graph, {
    id: manifest.id,
    name: projectName,
    features: audio?.features,
    alignment,
    sourcePairId: manifest.id,
  })

  return { project, motifGraph, alignment }
}
