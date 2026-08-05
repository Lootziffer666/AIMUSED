export interface HandLandmark {
  x: number
  y: number
  z: number
}

export interface HandData {
  landmarks: HandLandmark[]
  handedness: "Left" | "Right"
  score: number
}

export interface GestureState {
  leftHand: HandData | null
  rightHand: HandData | null
  leftChord: string
  rightMode: "drums" | "bass" | "melody" | "fx"
  bar: number
  bpm: number
  isPlaying: boolean
}

export interface ChordGrade {
  num: number
  pose: boolean[]
  degree: string
  chord: string
  notes: string
}

export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
]

export const GRADES: ChordGrade[] = [
  {
    num: 1,
    pose: [true, false, false],
    degree: "I",
    chord: "Am",
    notes: "C4 E4 A4",
  },
  {
    num: 2,
    pose: [false, true, false],
    degree: "II",
    chord: "Bdim",
    notes: "B3 D4 F4",
  },
  {
    num: 3,
    pose: [false, false, true],
    degree: "III",
    chord: "C",
    notes: "C4 E4 G4",
  },
  {
    num: 4,
    pose: [true, true, false],
    degree: "IV",
    chord: "Dm",
    notes: "D4 F4 A4",
  },
  {
    num: 5,
    pose: [true, false, true],
    degree: "V",
    chord: "Em",
    notes: "E4 G4 B4",
  },
  {
    num: 6,
    pose: [false, true, true],
    degree: "VI",
    chord: "F",
    notes: "F4 A4 C5",
  },
  {
    num: 7,
    pose: [true, true, true],
    degree: "VII",
    chord: "G",
    notes: "G4 B4 D5",
  },
]
