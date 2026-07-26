import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision"
import type { HandLandmarks } from "./landmarks"

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"

export interface TrackedHand {
  landmarks: HandLandmarks
  handedness: "Left" | "Right" // raw model label, IMAGE space (not user space)
  score: number
}

export interface HandFrame {
  hands: TrackedHand[]
  timeMs: number
}

export class HandTracker {
  private landmarker: HandLandmarker
  private video: HTMLVideoElement
  private raf = 0
  onFrame: ((f: HandFrame) => void) | null = null

  private constructor(landmarker: HandLandmarker, video: HTMLVideoElement) {
    this.landmarker = landmarker
    this.video = video
  }

  static async create(video: HTMLVideoElement): Promise<HandTracker> {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL)
    const make = (delegate: "GPU" | "CPU") =>
      HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "VIDEO",
        numHands: 2,
      })
    let landmarker: HandLandmarker
    try {
      landmarker = await make("GPU")
    } catch {
      landmarker = await make("CPU")
    }
    return new HandTracker(landmarker, video)
  }

  start() {
    const loop = () => {
      if (this.video.readyState >= 2) {
        try {
          const result = this.landmarker.detectForVideo(
            this.video,
            performance.now(),
          )
          if (result && this.onFrame) {
            const hands: TrackedHand[] = result.landmarks.map((lms, i) => ({
              landmarks: lms.map((l) => ({ x: l.x, y: l.y, z: l.z })),
              handedness:
                (result.handednesses?.[i]?.[0]?.categoryName as
                  | "Left"
                  | "Right") ?? "Right",
              score: result.handednesses?.[i]?.[0]?.score ?? 0,
            }))
            this.onFrame({ hands, timeMs: performance.now() })
          }
        } catch {
          // single bad frame – keep running
        }
      }
      this.raf = requestAnimationFrame(loop)
    }
    loop()
  }

  stop() {
    cancelAnimationFrame(this.raf)
    try {
      this.landmarker.close()
    } catch {
      // already closed
    }
  }
}
