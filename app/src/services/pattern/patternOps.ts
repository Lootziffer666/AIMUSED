import {
  gridTicks,
  type MuseBezierEnvelope,
  type MusePattern,
  type MusePatternLayerKind,
  type MusePatternNote,
  type MusePatternTrackLayer,
} from "../../entities/pattern/MusePattern"

/**
 * Pure pattern operations. Every function returns a new pattern and never
 * mutates its input, which makes undo/redo a plain stack of snapshots and
 * keeps the whole editing model testable without React or audio.
 */

let idCounter = 0
function makeId(prefix: string): string {
  idCounter += 1
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${random}-${idCounter}`
}

const LAYER_COLORS = [
  "#a78bfa",
  "#f472b6",
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#fb7185",
  "#22d3ee",
  "#c084fc",
]

export const DEFAULT_GRID_DIVISION = 16
export const DEFAULT_TIMEBASE = 480
export const DEFAULT_PATTERN_STEPS = 16

export interface CreateLayerOptions {
  name?: string
  kind?: MusePatternLayerKind
  color?: string
  program?: number
  drumZoneId?: string
  sampleId?: string
}

export function createLayer(
  options: CreateLayerOptions = {},
  index = 0,
): MusePatternTrackLayer {
  const kind = options.kind ?? "melodic"
  return {
    id: makeId("layer"),
    name: options.name ?? (kind === "melodic" ? "Piano" : "Percussion"),
    kind,
    color: options.color ?? LAYER_COLORS[index % LAYER_COLORS.length],
    program: options.program,
    drumZoneId: options.drumZoneId,
    sampleId: options.sampleId,
    transpose: 0,
    visible: true,
    muted: false,
    soloed: false,
    locked: false,
    notes: [],
  }
}

export function createPattern(options?: {
  name?: string
  timebase?: number
  gridDivision?: number
  steps?: number
  layers?: MusePatternTrackLayer[]
}): MusePattern {
  const timebase = options?.timebase ?? DEFAULT_TIMEBASE
  const gridDivision = options?.gridDivision ?? DEFAULT_GRID_DIVISION
  const steps = options?.steps ?? DEFAULT_PATTERN_STEPS
  const step = Math.max(1, Math.round((timebase * 4) / gridDivision))
  const now = new Date().toISOString()
  return {
    id: makeId("pattern"),
    name: options?.name ?? "New pattern",
    startTick: 0,
    lengthTicks: step * steps,
    gridDivision,
    timebase,
    trackLayers: options?.layers ?? [
      createLayer({ name: "Piano", kind: "melodic", program: 0 }, 0),
    ],
    createdAt: now,
    updatedAt: now,
  }
}

function touch(pattern: MusePattern): MusePattern {
  return { ...pattern, updatedAt: new Date().toISOString() }
}

function mapLayer(
  pattern: MusePattern,
  layerId: string,
  fn: (layer: MusePatternTrackLayer) => MusePatternTrackLayer,
): MusePattern {
  let changed = false
  const trackLayers = pattern.trackLayers.map((layer) => {
    if (layer.id !== layerId) return layer
    changed = true
    return fn(layer)
  })
  if (!changed) return pattern
  return touch({ ...pattern, trackLayers })
}

/** Edits are refused on locked layers – the guard lives in one place. */
export function isLayerEditable(
  pattern: MusePattern,
  layerId: string,
): boolean {
  const layer = pattern.trackLayers.find((l) => l.id === layerId)
  return layer !== undefined && !layer.locked
}

// ---------- layers ----------

export function addLayer(
  pattern: MusePattern,
  options: CreateLayerOptions = {},
): MusePattern {
  const layer = createLayer(options, pattern.trackLayers.length)
  return touch({ ...pattern, trackLayers: [...pattern.trackLayers, layer] })
}

export function removeLayer(
  pattern: MusePattern,
  layerId: string,
): MusePattern {
  const trackLayers = pattern.trackLayers.filter((l) => l.id !== layerId)
  if (trackLayers.length === pattern.trackLayers.length) return pattern
  return touch({ ...pattern, trackLayers })
}

export function updateLayer(
  pattern: MusePattern,
  layerId: string,
  patch: Partial<Omit<MusePatternTrackLayer, "id" | "notes">>,
): MusePattern {
  return mapLayer(pattern, layerId, (layer) => ({ ...layer, ...patch }))
}

export function toggleLayerFlag(
  pattern: MusePattern,
  layerId: string,
  flag: "visible" | "muted" | "soloed" | "locked",
): MusePattern {
  return mapLayer(pattern, layerId, (layer) => ({
    ...layer,
    [flag]: !layer[flag],
  }))
}

// ---------- notes ----------

export interface AddNoteOptions {
  startTick: number
  durationTicks?: number
  noteNumber: number
  velocity?: number
}

export function addNote(
  pattern: MusePattern,
  layerId: string,
  options: AddNoteOptions,
): { pattern: MusePattern; noteId: string | null } {
  if (!isLayerEditable(pattern, layerId)) return { pattern, noteId: null }
  const note: MusePatternNote = {
    id: makeId("note"),
    startTick: Math.max(0, Math.round(options.startTick)),
    durationTicks: Math.max(
      1,
      Math.round(options.durationTicks ?? gridTicks(pattern)),
    ),
    noteNumber: Math.min(127, Math.max(0, Math.round(options.noteNumber))),
    velocity: Math.min(127, Math.max(1, Math.round(options.velocity ?? 88))),
  }
  return {
    pattern: mapLayer(pattern, layerId, (layer) => ({
      ...layer,
      notes: [...layer.notes, note],
    })),
    noteId: note.id,
  }
}

function mapNote(
  pattern: MusePattern,
  layerId: string,
  noteId: string,
  fn: (note: MusePatternNote) => MusePatternNote,
): MusePattern {
  if (!isLayerEditable(pattern, layerId)) return pattern
  return mapLayer(pattern, layerId, (layer) => ({
    ...layer,
    notes: layer.notes.map((n) => (n.id === noteId ? fn(n) : n)),
  }))
}

export function moveNote(
  pattern: MusePattern,
  layerId: string,
  noteId: string,
  deltaTicks: number,
  deltaNoteNumber: number,
): MusePattern {
  return mapNote(pattern, layerId, noteId, (note) => ({
    ...note,
    startTick: Math.max(0, Math.round(note.startTick + deltaTicks)),
    noteNumber: Math.min(
      127,
      Math.max(0, Math.round(note.noteNumber + deltaNoteNumber)),
    ),
  }))
}

/**
 * Absolute placement – used by drag gestures, which always compute the target
 * from the position the drag started at instead of accumulating deltas.
 */
export function setNotePosition(
  pattern: MusePattern,
  layerId: string,
  noteId: string,
  startTick: number,
  noteNumber: number,
): MusePattern {
  return mapNote(pattern, layerId, noteId, (note) => ({
    ...note,
    startTick: Math.max(0, Math.round(startTick)),
    noteNumber: Math.min(127, Math.max(0, Math.round(noteNumber))),
  }))
}

/** Resizes from the right edge: only the duration changes. */
export function resizeNote(
  pattern: MusePattern,
  layerId: string,
  noteId: string,
  durationTicks: number,
): MusePattern {
  return mapNote(pattern, layerId, noteId, (note) => ({
    ...note,
    durationTicks: Math.max(1, Math.round(durationTicks)),
  }))
}

/** Resizes from the left edge: start and duration move in opposite directions. */
export function resizeNoteStart(
  pattern: MusePattern,
  layerId: string,
  noteId: string,
  startTick: number,
): MusePattern {
  return mapNote(pattern, layerId, noteId, (note) => {
    const end = note.startTick + note.durationTicks
    const nextStart = Math.max(0, Math.min(Math.round(startTick), end - 1))
    return {
      ...note,
      startTick: nextStart,
      durationTicks: Math.max(1, end - nextStart),
    }
  })
}

export function setNotePitch(
  pattern: MusePattern,
  layerId: string,
  noteId: string,
  noteNumber: number,
): MusePattern {
  return mapNote(pattern, layerId, noteId, (note) => ({
    ...note,
    noteNumber: Math.min(127, Math.max(0, Math.round(noteNumber))),
  }))
}

export function setNoteVelocity(
  pattern: MusePattern,
  layerId: string,
  noteId: string,
  velocity: number,
): MusePattern {
  return mapNote(pattern, layerId, noteId, (note) => ({
    ...note,
    velocity: Math.min(127, Math.max(1, Math.round(velocity))),
  }))
}

export function setNoteEnvelope(
  pattern: MusePattern,
  layerId: string,
  noteId: string,
  which: "volumeEnvelope" | "expressionEnvelope",
  envelope: MuseBezierEnvelope | undefined,
): MusePattern {
  return mapNote(pattern, layerId, noteId, (note) => ({
    ...note,
    [which]: envelope,
  }))
}

export function removeNote(
  pattern: MusePattern,
  layerId: string,
  noteId: string,
): MusePattern {
  if (!isLayerEditable(pattern, layerId)) return pattern
  return mapLayer(pattern, layerId, (layer) => ({
    ...layer,
    notes: layer.notes.filter((n) => n.id !== noteId),
  }))
}

export function findNote(
  pattern: MusePattern,
  layerId: string,
  noteId: string,
): MusePatternNote | undefined {
  return pattern.trackLayers
    .find((l) => l.id === layerId)
    ?.notes.find((n) => n.id === noteId)
}

/** Quantizes note starts (and optionally lengths) to the pattern grid. */
export function quantizeLayer(
  pattern: MusePattern,
  layerId: string,
  options: { lengths?: boolean } = {},
): MusePattern {
  const step = gridTicks(pattern)
  return mapLayer(pattern, layerId, (layer) => ({
    ...layer,
    notes: layer.notes.map((note) => ({
      ...note,
      startTick: Math.round(note.startTick / step) * step,
      durationTicks: options.lengths
        ? Math.max(step, Math.round(note.durationTicks / step) * step)
        : note.durationTicks,
    })),
  }))
}

export function snapTick(pattern: MusePattern, tick: number): number {
  const step = gridTicks(pattern)
  return Math.max(0, Math.round(tick / step) * step)
}

// ---------- pattern length ----------

/**
 * Changes the active length. Notes beyond the new end are *kept* – they are
 * simply no longer active. Nothing is deleted without an explicit request.
 */
export function setPatternLength(
  pattern: MusePattern,
  lengthTicks: number,
): MusePattern {
  const step = gridTicks(pattern)
  const next = Math.max(step, Math.round(lengthTicks))
  if (next === pattern.lengthTicks) return pattern
  return touch({ ...pattern, lengthTicks: next })
}

export function setPatternSteps(
  pattern: MusePattern,
  steps: number,
): MusePattern {
  return setPatternLength(
    pattern,
    Math.max(1, Math.round(steps)) * gridTicks(pattern),
  )
}

/**
 * Changing the grid keeps the musical length in ticks, so existing notes stay
 * where they are and only the visible raster changes.
 */
export function setGridDivision(
  pattern: MusePattern,
  gridDivision: number,
): MusePattern {
  const next = Math.max(1, Math.round(gridDivision))
  if (next === pattern.gridDivision) return pattern
  return touch({ ...pattern, gridDivision: next })
}

export function setPatternName(
  pattern: MusePattern,
  name: string,
): MusePattern {
  return touch({ ...pattern, name })
}

/** Notes that start after the end marker: kept, dimmed, never played. */
export function overhangNotes(
  pattern: MusePattern,
): { layerId: string; note: MusePatternNote }[] {
  return pattern.trackLayers.flatMap((layer) =>
    layer.notes
      .filter((note) => note.startTick >= pattern.lengthTicks)
      .map((note) => ({ layerId: layer.id, note })),
  )
}

export function hasOverhang(pattern: MusePattern): boolean {
  return pattern.trackLayers.some((layer) =>
    layer.notes.some((note) => note.startTick >= pattern.lengthTicks),
  )
}

/** The deliberate, destructive counterpart to `setPatternLength`. */
export function trimOverhang(pattern: MusePattern): MusePattern {
  if (!hasOverhang(pattern)) return pattern
  return touch({
    ...pattern,
    trackLayers: pattern.trackLayers.map((layer) => ({
      ...layer,
      notes: layer.notes.filter((note) => note.startTick < pattern.lengthTicks),
    })),
  })
}

export function noteCount(pattern: MusePattern): number {
  return pattern.trackLayers.reduce((sum, l) => sum + l.notes.length, 0)
}
