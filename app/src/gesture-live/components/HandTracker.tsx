import React, { useRef, useEffect, useCallback } from "react"
import { HandData, HAND_CONNECTIONS } from "../types"

interface HandTrackerProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  leftHand: HandData | null
  rightHand: HandData | null
  width?: number
  height?: number
}

const PALETTE = {
  left: "#ff6b4a",
  right: "#4ecdc4",
  joint: "rgba(255,255,255,0.9)",
  connection: "rgba(255,107,74,0.5)",
}

function drawHand(
  ctx: CanvasRenderingContext2D,
  hand: HandData,
  color: string,
  width: number,
  height: number,
) {
  const lm = hand.landmarks

  // Draw connections
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.lineCap = "round"

  for (const [start, end] of HAND_CONNECTIONS) {
    const s = lm[start]
    const e = lm[end]
    ctx.globalAlpha = 0.45
    ctx.beginPath()
    ctx.moveTo(s.x * width, s.y * height)
    ctx.lineTo(e.x * width, e.y * height)
    ctx.stroke()
  }

  // Draw joints
  ctx.globalAlpha = 1
  for (let i = 0; i < lm.length; i++) {
    const p = lm[i]
    const isTip = [4, 8, 12, 16, 20].includes(i)
    const isWrist = i === 0

    ctx.beginPath()
    ctx.arc(
      p.x * width,
      p.y * height,
      isWrist ? 5 : isTip ? 3.5 : 2.5,
      0,
      Math.PI * 2,
    )
    ctx.fillStyle = isWrist ? color : "rgba(255,255,255,0.85)"
    ctx.fill()

    if (isTip || isWrist) {
      ctx.strokeStyle = color
      ctx.lineWidth = 1.2
      ctx.stroke()
    }
  }

  // Draw palm center crosshair
  const wrist = lm[0]
  const middle = lm[9]
  const palmX = (wrist.x + middle.x) / 2
  const palmY = (wrist.y + middle.y) / 2

  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.globalAlpha = 0.6
  const cx = palmX * width
  const cy = palmY * height
  ctx.beginPath()
  ctx.moveTo(cx - 8, cy)
  ctx.lineTo(cx + 8, cy)
  ctx.moveTo(cx, cy - 8)
  ctx.lineTo(cx, cy + 8)
  ctx.stroke()

  // Label
  ctx.globalAlpha = 0.8
  ctx.font = "10px var(--kimi-font-mono, monospace)"
  ctx.fillStyle = color
  ctx.fillText(hand.handedness === "Left" ? "L" : "R", cx + 12, cy + 12)
}

export const HandTracker: React.FC<HandTrackerProps> = ({
  videoRef,
  leftHand,
  rightHand,
  width = 1280,
  height = 720,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    // Match canvas to video
    canvas.width = video.videoWidth || width
    canvas.height = video.videoHeight || height

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Mirror transform (video is mirrored via CSS, canvas must match)
    ctx.save()
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)

    if (leftHand)
      drawHand(ctx, leftHand, PALETTE.left, canvas.width, canvas.height)
    if (rightHand)
      drawHand(ctx, rightHand, PALETTE.right, canvas.width, canvas.height)

    ctx.restore()
  }, [leftHand, rightHand, videoRef, width, height])

  useEffect(() => {
    let raf: number
    const loop = () => {
      draw()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [draw])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 3,
      }}
    />
  )
}
