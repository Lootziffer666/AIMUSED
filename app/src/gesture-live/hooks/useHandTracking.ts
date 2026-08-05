import { useEffect, useRef, useCallback, useState } from "react"
import { HandData } from "../types"

interface UseHandTrackingOptions {
  onResults: (left: HandData | null, right: HandData | null) => void
  enabled?: boolean
  videoRef: React.RefObject<HTMLVideoElement | null>
}

export function useHandTracking({
  onResults,
  enabled = true,
  videoRef,
}: UseHandTrackingOptions) {
  const handsRef = useRef<any>(null)
  const cameraRef = useRef<any>(null)
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const init = useCallback(async () => {
    if (!videoRef.current) return

    try {
      const { Hands } = await import("@mediapipe/hands")
      const { Camera } = await import("@mediapipe/camera_utils")

      const hands = new Hands({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      })

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7,
      })

      hands.onResults((results: any) => {
        let left: HandData | null = null
        let right: HandData | null = null

        if (results.multiHandLandmarks && results.multiHandedness) {
          for (let i = 0; i < results.multiHandLandmarks.length; i++) {
            const landmarks = results.multiHandLandmarks[i]
            const label = results.multiHandedness[i].label as "Left" | "Right"
            const score = results.multiHandedness[i].score

            const handData: HandData = {
              landmarks: landmarks.map((lm: any) => ({
                x: lm.x,
                y: lm.y,
                z: lm.z,
              })),
              handedness: label,
              score,
            }

            if (label === "Left") left = handData
            else right = handData
          }
        }

        onResults(left, right)
      })

      handsRef.current = hands

      const camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (handsRef.current && videoRef.current) {
            await handsRef.current.send({ image: videoRef.current })
          }
        },
        width: 1280,
        height: 720,
      })

      cameraRef.current = camera
      await camera.start()
      setIsReady(true)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to init hand tracking",
      )
      console.error("Hand tracking init error:", err)
    }
  }, [onResults, videoRef])

  useEffect(() => {
    if (!enabled) return
    init()

    return () => {
      cameraRef.current?.stop?.()
      handsRef.current?.close?.()
    }
  }, [enabled, init])

  return { isReady, error }
}
