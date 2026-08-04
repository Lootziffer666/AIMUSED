// MediaPipe hand landmark indices (21 points)
export const WRIST = 0
export const THUMB_CMC = 1
export const THUMB_MCP = 2
export const THUMB_IP = 3
export const THUMB_TIP = 4
export const INDEX_MCP = 5
export const INDEX_PIP = 6
export const INDEX_DIP = 7
export const INDEX_TIP = 8
export const MIDDLE_MCP = 9
export const MIDDLE_PIP = 10
export const MIDDLE_DIP = 11
export const MIDDLE_TIP = 12
export const RING_MCP = 13
export const RING_PIP = 14
export const RING_DIP = 15
export const RING_TIP = 16
export const PINKY_MCP = 17
export const PINKY_PIP = 18
export const PINKY_DIP = 19
export const PINKY_TIP = 20

export interface Landmark {
  x: number
  y: number
  z: number
}

export type HandLandmarks = Landmark[]

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

export function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

// A finger counts as extended when its tip is clearly farther from the
// wrist than its PIP joint (robust against hand size and distance).
export function fingerExtended(
  lm: HandLandmarks,
  tip: number,
  pip: number,
): boolean {
  return dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * 1.15
}

export function extendedFingerCount(lm: HandLandmarks): number {
  let count = 0
  if (fingerExtended(lm, INDEX_TIP, INDEX_PIP)) count++
  if (fingerExtended(lm, MIDDLE_TIP, MIDDLE_PIP)) count++
  if (fingerExtended(lm, RING_TIP, RING_PIP)) count++
  if (fingerExtended(lm, PINKY_TIP, PINKY_PIP)) count++
  return count
}

// Open hand: 3+ fingers extended -> sustain
export function isOpenHand(lm: HandLandmarks): boolean {
  return extendedFingerCount(lm) >= 3
}

// Fist: no fingers extended -> mute
export function isFist(lm: HandLandmarks): boolean {
  return extendedFingerCount(lm) === 0
}

// Hand size reference for normalizing distances
export function handSize(lm: HandLandmarks): number {
  return dist(lm[WRIST], lm[MIDDLE_MCP])
}

// Thumb-index pinch distance, normalized by hand size
export function pinchDistance(lm: HandLandmarks): number {
  const size = handSize(lm)
  if (size <= 0) return 1
  return dist(lm[THUMB_TIP], lm[INDEX_TIP]) / size
}

// Wrist roll: deviation of the knuckle line (index MCP -> pinky MCP)
// from horizontal. 0 = natural upright hand, up to 90 = fully rolled.
export function handRoll(lm: HandLandmarks): number {
  const a = lm[INDEX_MCP]
  const b = lm[PINKY_MCP]
  let deg = Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI)
  if (deg > 90) deg = 180 - deg
  return deg
}
