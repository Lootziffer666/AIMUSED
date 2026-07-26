import styled from "@emotion/styled"
import { type FC, type RefObject, useCallback, useEffect, useRef } from "react"
import { videoToStage } from "../../services/jamRoom/hands/coordMap"
import {
  HandController,
  type ThereminHandEvent,
} from "../../services/jamRoom/hands/HandController"
import { HandTracker } from "../../services/jamRoom/hands/HandTracker"
import {
  HAND_CONNECTIONS,
  isFist,
  isOpenHand,
} from "../../services/jamRoom/hands/landmarks"

const OverlayCanvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 16;
`

const SIDE_COLOR: Record<string, string> = {
  left: "#ff2e88",
  right: "#f5a524",
}

interface HandOverlayProps {
  videoRef: RefObject<HTMLVideoElement | null>
  stageRef: RefObject<HTMLDivElement | null>
  enabled: boolean
  swapped: boolean
  zoneIdAt: (xPx: number, yPx: number) => string | null
  onDrumStrike: (xPx: number, yPx: number, speed: number) => void
  onTheremin: (e: ThereminHandEvent) => void
  onStatus: (s: "loading" | "running" | "error", msg?: string) => void
}

export const HandOverlay: FC<HandOverlayProps> = ({
  videoRef,
  stageRef,
  enabled,
  swapped,
  zoneIdAt,
  onDrumStrike,
  onTheremin,
  onStatus,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const controllerRef = useRef<HandController | null>(null)
  const trailRef = useRef<Record<string, { x: number; y: number }[]>>({})

  // latest-value refs so the tracker loop never sees stale closures
  const liveRef = useRef({
    swapped,
    zoneIdAt,
    onDrumStrike,
    onTheremin,
    onStatus,
  })
  liveRef.current = { swapped, zoneIdAt, onDrumStrike, onTheremin, onStatus }

  const draw = useCallback(() => {
    const cv = canvasRef.current
    const stage = stageRef.current
    const video = videoRef.current
    const ctrl = controllerRef.current
    if (!cv || !stage || !video || !ctrl) return
    if (cv.width !== stage.clientWidth || cv.height !== stage.clientHeight) {
      cv.width = stage.clientWidth
      cv.height = stage.clientHeight
    }
    const g = cv.getContext("2d")
    if (!g) return
    g.clearRect(0, 0, cv.width, cv.height)

    const vw = video.videoWidth
    const vh = video.videoHeight

    for (const { side, hand } of ctrl.lastAssigned) {
      const color = SIDE_COLOR[side]
      const pts = hand.landmarks.map((lm) =>
        videoToStage(lm.x, lm.y, vw, vh, cv.width, cv.height),
      )

      // wrist trail
      const trail = trailRef.current[side] ?? []
      trail.push(pts[0])
      if (trail.length > 14) trail.shift()
      trailRef.current[side] = trail
      for (let i = 1; i < trail.length; i++) {
        g.globalAlpha = (i / trail.length) * 0.35
        g.strokeStyle = color
        g.lineWidth = 2
        g.beginPath()
        g.moveTo(trail[i - 1].x, trail[i - 1].y)
        g.lineTo(trail[i].x, trail[i].y)
        g.stroke()
      }
      g.globalAlpha = 1

      // skeleton
      g.strokeStyle = color
      g.lineWidth = 2
      g.shadowColor = color
      g.shadowBlur = 8
      g.globalAlpha = 0.85
      g.beginPath()
      for (const [a, b] of HAND_CONNECTIONS) {
        g.moveTo(pts[a].x, pts[a].y)
        g.lineTo(pts[b].x, pts[b].y)
      }
      g.stroke()
      g.shadowBlur = 0
      g.globalAlpha = 1

      // joints
      for (let i = 0; i < pts.length; i++) {
        const isTip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20
        g.fillStyle = isTip ? "#ffffff" : color
        g.beginPath()
        g.arc(pts[i].x, pts[i].y, isTip ? 4 : 2.5, 0, Math.PI * 2)
        g.fill()
      }

      // gesture ring + role label at wrist
      const fist = isFist(hand.landmarks)
      const open = isOpenHand(hand.landmarks)
      g.beginPath()
      g.arc(pts[0].x, pts[0].y, 17, 0, Math.PI * 2)
      g.strokeStyle = fist
        ? "#ff4d3d"
        : open
          ? "#2dd4a7"
          : "rgba(255,255,255,0.35)"
      g.lineWidth = 3
      g.stroke()
      g.fillStyle = color
      g.font = "700 10px ui-monospace, Menlo, monospace"
      g.fillText(
        side === "left" ? "EXPR" : "DRUM",
        pts[0].x + 24,
        pts[0].y - 16,
      )
    }
  }, [stageRef, videoRef])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let tracker: HandTracker | null = null
    liveRef.current.onStatus("loading")

    const boot = async () => {
      const video = videoRef.current
      const stage = stageRef.current
      if (!video || !stage) {
        liveRef.current.onStatus("error", "Kamera noch nicht bereit.")
        return
      }
      if (video.readyState < 2) {
        await new Promise<void>((resolve) => {
          video.addEventListener("loadeddata", () => resolve(), { once: true })
          window.setTimeout(resolve, 3000)
        })
      }
      if (cancelled) return
      if (video.readyState < 2) {
        liveRef.current.onStatus(
          "error",
          "Kein Kamerabild – Hand-Tracking pausiert.",
        )
        return
      }
      try {
        tracker = await HandTracker.create(video)
      } catch {
        if (!cancelled) {
          liveRef.current.onStatus(
            "error",
            "Hand-Modell nicht ladbar (offline?). Zeiger-Steuerung bleibt aktiv.",
          )
        }
        return
      }
      if (cancelled) {
        tracker.stop()
        return
      }
      const controller = new HandController({
        toStage: (nx, ny) =>
          videoToStage(
            nx,
            ny,
            video.videoWidth,
            video.videoHeight,
            stage.clientWidth,
            stage.clientHeight,
          ),
        zoneIdAt: (x, y) => liveRef.current.zoneIdAt(x, y),
        onDrumStrike: (x, y, speed) =>
          liveRef.current.onDrumStrike(x, y, speed),
        onTheremin: (e) => liveRef.current.onTheremin(e),
      })
      controllerRef.current = controller
      tracker.onFrame = (frame) => {
        controller.swapped = liveRef.current.swapped
        controller.handleFrame(frame)
        draw()
      }
      tracker.start()
      liveRef.current.onStatus("running")
    }

    void boot()

    return () => {
      cancelled = true
      tracker?.stop()
      controllerRef.current?.reset()
      controllerRef.current = null
      trailRef.current = {}
      const cv = canvasRef.current
      const g = cv?.getContext("2d")
      if (cv && g) g.clearRect(0, 0, cv.width, cv.height)
    }
  }, [enabled, draw, stageRef, videoRef])

  return <OverlayCanvas ref={canvasRef} />
}
