export type PerformanceSource =
  | "voice"
  | "gesture-instrument"
  | "painted-drums"
  | "accompaniment"

export interface MusePerformanceNote {
  tick: number
  duration: number
  noteNumber: number
  velocity: number
}

export interface MusePerformanceDrumHit {
  tick: number
  zoneId: string
  velocity: number
  confidence: number
}

export interface MusePerformanceControlEvent {
  tick: number
  type: "pitch-bend" | "modulation" | "expression" | "sustain"
  value: number
}

export type MuseTrackRole =
  | "melody"
  | "bass"
  | "percussion"
  | "harmony"
  | "texture"
  | "guitar"
  | "pad"

export interface MusePerformanceTake {
  id: string
  source: PerformanceSource
  rawReference?: string
  notes: MusePerformanceNote[]
  drumHits: MusePerformanceDrumHit[]
  controls: MusePerformanceControlEvent[]
  confidence: number
  role: MuseTrackRole
  loopStartTick: number
  loopLengthTicks: number
  createdAt: string
}
