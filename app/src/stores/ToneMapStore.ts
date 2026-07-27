import type {
  AlignmentMap,
  AlignmentPoint,
  InstrumentLibraryManifest,
  MotifDirection,
  MotifGraph,
  OrchestrationPlan,
  PairedSourceManifest,
  ToneMapObservation,
  ToneMapProject,
  ToneMapTrainingRecord,
} from "@signal-app/tonemap-core"
import { action, makeObservable, observable } from "mobx"
import { createBuiltinLibrary } from "../services/tonemap/builtinLibrary"
import type { LoadedAudio, LoadedMidi } from "../services/tonemap/pipeline"

export type ToneMapTab = "source" | "map" | "dramaturgy" | "orchestration"

/**
 * Working state of the tone map workspace.
 *
 * The loaded files stay here as *decoded* data only – the tone map project
 * and the plan are the documents, the source files are never modified and
 * never written back.
 */
export class ToneMapStore {
  tab: ToneMapTab = "source"
  midi: LoadedMidi | null = null
  audio: LoadedAudio | null = null
  manifest: PairedSourceManifest | null = null
  alignment: AlignmentMap | null = null
  manualAnchors: AlignmentPoint[] = []
  project: ToneMapProject | null = null
  motifGraph: MotifGraph | null = null
  plan: OrchestrationPlan | null = null
  libraries: InstrumentLibraryManifest[] = [createBuiltinLibrary()]
  trainingRecords: ToneMapTrainingRecord[] = []
  selectedNodeId: string | null = null
  selectedPartId: string | null = null
  busy: string | null = null
  error: string | null = null

  constructor() {
    makeObservable(this, {
      tab: observable,
      midi: observable.ref,
      audio: observable.ref,
      manifest: observable.ref,
      alignment: observable.ref,
      manualAnchors: observable.ref,
      project: observable.ref,
      motifGraph: observable.ref,
      plan: observable.ref,
      libraries: observable.ref,
      trainingRecords: observable.ref,
      selectedNodeId: observable,
      selectedPartId: observable,
      busy: observable,
      error: observable,
      setTab: action,
      setSource: action,
      setAnalysis: action,
      setPlan: action,
      setSelectedNode: action,
      setSelectedPart: action,
      addManualAnchor: action,
      removeManualAnchor: action,
      addTrainingRecord: action,
      addLibrary: action,
      updateObservation: action,
      addDirection: action,
      removeDirection: action,
      setBusy: action,
      setError: action,
      reset: action,
    })
  }

  setTab(tab: ToneMapTab) {
    this.tab = tab
  }

  setSource(options: {
    midi: LoadedMidi | null
    audio: LoadedAudio | null
    manifest: PairedSourceManifest | null
  }) {
    this.midi = options.midi
    this.audio = options.audio
    this.manifest = options.manifest
  }

  setAnalysis(options: {
    project: ToneMapProject
    motifGraph: MotifGraph
    alignment?: AlignmentMap
  }) {
    this.project = options.project
    this.motifGraph = options.motifGraph
    this.alignment = options.alignment ?? null
    this.selectedNodeId =
      options.project.observations[0]?.sourceRef ?? this.selectedNodeId
  }

  setPlan(plan: OrchestrationPlan | null) {
    this.plan = plan
    if (plan && !plan.parts.some((part) => part.id === this.selectedPartId)) {
      this.selectedPartId = plan.parts[0]?.id ?? null
    }
  }

  setSelectedNode(id: string | null) {
    this.selectedNodeId = id
  }

  setSelectedPart(id: string | null) {
    this.selectedPartId = id
  }

  addManualAnchor(anchor: AlignmentPoint) {
    this.manualAnchors = [...this.manualAnchors, anchor].sort(
      (a, b) => a.midiTick - b.midiTick,
    )
  }

  removeManualAnchor(index: number) {
    this.manualAnchors = this.manualAnchors.filter((_, i) => i !== index)
  }

  addTrainingRecord(record: ToneMapTrainingRecord) {
    this.trainingRecords = [...this.trainingRecords, record]
  }

  addLibrary(library: InstrumentLibraryManifest) {
    this.libraries = [
      ...this.libraries.filter((entry) => entry.id !== library.id),
      library,
    ]
  }

  /**
   * A human correction replaces the derived claim and says so in the
   * provenance – automation never silently overwrites it afterwards.
   */
  updateObservation(
    id: string,
    update: (o: ToneMapObservation) => ToneMapObservation,
  ) {
    if (!this.project) return
    this.project = {
      ...this.project,
      updatedAt: new Date().toISOString(),
      observations: this.project.observations.map((entry) =>
        entry.id === id ? update(entry) : entry,
      ),
    }
  }

  addDirection(direction: MotifDirection) {
    if (!this.project) return
    this.project = {
      ...this.project,
      updatedAt: new Date().toISOString(),
      directions: [...this.project.directions, direction],
    }
  }

  removeDirection(id: string) {
    if (!this.project) return
    this.project = {
      ...this.project,
      updatedAt: new Date().toISOString(),
      directions: this.project.directions.filter((entry) => entry.id !== id),
    }
  }

  setBusy(busy: string | null) {
    this.busy = busy
    if (busy !== null) this.error = null
  }

  setError(error: string | null) {
    this.error = error
    this.busy = null
  }

  reset() {
    this.midi = null
    this.audio = null
    this.manifest = null
    this.alignment = null
    this.manualAnchors = []
    this.project = null
    this.motifGraph = null
    this.plan = null
    this.selectedNodeId = null
    this.selectedPartId = null
    this.busy = null
    this.error = null
  }
}
