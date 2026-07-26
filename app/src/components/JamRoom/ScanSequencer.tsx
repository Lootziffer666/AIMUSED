import styled from "@emotion/styled"
import { getTempo, type TrackId } from "@signal-app/core"
import { useToast } from "dialog-hooks"
import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { DEFAULT_TEMPO } from "../../Constants"
import type {
  MusePerformanceNote,
  MusePerformanceTake,
} from "../../entities/performance/MusePerformanceTake"
import { useRouter } from "../../hooks/useRouter"
import { useStores } from "../../hooks/useStores"
import { applyJamRoomTakeToSong } from "../../services/jamRoom/jamRoomSongAdapter"
import {
  handleCameraError,
  millisecondsToLoopTick,
  snapToScale,
} from "../../services/jamRoom/jamRoomUtils"
import {
  advanceScanLines,
  createScanLines,
  DEFAULT_SCAN_CONFIG,
  sampleRowLuminance,
  type ScanLineState,
} from "../../services/jamRoom/scanSequencer"
import { Button, PrimaryButton } from "../ui/Button"

const Container = styled.div`
  position: relative;
  display: grid;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  color: white;
  background: #06080d;
`

const Canvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
`

const HiddenVideo = styled.video`
  display: none;
`

const Shade = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(180deg, rgba(0, 0, 0, 0.75), transparent 24%),
    linear-gradient(0deg, rgba(0, 0, 0, 0.82), transparent 30%);
`

const Interface = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 0;
  pointer-events: none;
`

const Header = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem clamp(1rem, 4vw, 2rem);

  h1 {
    margin: 0;
    font-size: clamp(1rem, 3vw, 1.5rem);
    letter-spacing: 0.08em;
  }

  p {
    margin: 0.3rem 0 0;
    color: rgba(255, 255, 255, 0.68);
    font-size: 0.78rem;
  }
`

const ScannerLabel = styled.div<{ recording: boolean }>`
  align-self: center;
  justify-self: center;
  padding: 1rem 1.4rem;
  border: 1px solid
    ${({ recording }) =>
      recording ? "rgba(82, 255, 188, 0.8)" : "rgba(255, 255, 255, 0.2)"};
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  box-shadow: ${({ recording }) =>
    recording ? "0 0 32px rgba(82, 255, 188, 0.28)" : "none"};
  text-align: center;

  strong {
    display: block;
    font-size: 1.2rem;
  }

  span {
    color: rgba(255, 255, 255, 0.64);
    font-size: 0.72rem;
  }
`

const Footer = styled.footer`
  display: grid;
  gap: 0.75rem;
  padding: 1rem clamp(1rem, 4vw, 2rem);
  pointer-events: auto;
`

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
`

const Sensitivity = styled.label`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 0.4rem;
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.75rem;

  input {
    width: min(11rem, 28vw);
  }
`

const Layers = styled.div`
  display: flex;
  min-height: 1.8rem;
  justify-content: center;
  gap: 0.45rem;
  overflow-x: auto;
`

const Layer = styled.div`
  flex: 0 0 auto;
  padding: 0.3rem 0.65rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  font-size: 0.72rem;
`

const Notice = styled.div`
  max-width: 24rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid rgba(255, 180, 70, 0.45);
  border-radius: 0.4rem;
  color: #ffd08a;
  background: rgba(20, 12, 2, 0.84);
  font-size: 0.75rem;
`

interface ScanLayer {
  trackId: TrackId
  noteCount: number
}

const C_MAJOR = [0, 2, 4, 5, 7, 9, 11]

export const ScanSequencer: FC = () => {
  const { songStore, player, synthGroup } = useStores()
  const { setPath } = useRouter()
  const toast = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationRef = useRef<number | null>(null)
  const stopTimerRef = useRef<number | null>(null)
  const linesRef = useRef<ScanLineState[]>(
    createScanLines(DEFAULT_SCAN_CONFIG.lineCount),
  )
  const lastFrameRef = useRef(performance.now())
  const recordingRef = useRef(false)
  const recordingStartedAtRef = useRef(0)
  const pendingNotesRef = useRef<MusePerformanceNote[]>([])

  const [cameraReady, setCameraReady] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [capturedCount, setCapturedCount] = useState(0)
  const [sensitivity, setSensitivity] = useState(
    DEFAULT_SCAN_CONFIG.sensitivity,
  )
  const [layers, setLayers] = useState<ScanLayer[]>([])

  const song = songStore.song
  const loopLength = song.timebase * 16
  const config = useMemo(
    () => ({ ...DEFAULT_SCAN_CONFIG, sensitivity }),
    [sensitivity],
  )

  const currentBpm = useCallback(() => {
    const conductor = song.conductorTrack
    return conductor ? (getTempo(conductor.events, 0) ?? DEFAULT_TEMPO) : DEFAULT_TEMPO
  }, [song])

  useEffect(() => {
    setLayers([])
    pendingNotesRef.current = []
    setCapturedCount(0)
  }, [song])

  useEffect(() => {
    let cancelled = false

    const setupCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 960 },
            height: { ideal: 720 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
        setCameraReady(true)
      } catch (error) {
        setNotice(handleCameraError(error))
      }
    }

    void setupCamera()
    return () => {
      cancelled = true
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
      }
      if (stopTimerRef.current !== null) {
        clearTimeout(stopTimerRef.current)
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      player.allSoundsOffChannel(0)
    }
  }, [player])

  const previewNote = useCallback(
    (noteNumber: number, velocity: number) => {
      synthGroup.activate()
      player.sendEvent({
        type: "channel",
        subtype: "noteOn",
        channel: 0,
        noteNumber,
        velocity,
      })
      player.sendEvent(
        {
          type: "channel",
          subtype: "noteOff",
          channel: 0,
          noteNumber,
          velocity: 0,
        },
        0.18,
      )
    },
    [player, synthGroup],
  )

  useEffect(() => {
    if (!cameraReady) return
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    const context = canvas.getContext("2d")
    if (!context) return

    const offscreen = document.createElement("canvas")
    offscreen.width = 320
    offscreen.height = 240
    const offscreenContext = offscreen.getContext("2d", {
      willReadFrequently: true,
    })
    if (!offscreenContext) return

    const draw = (now: number) => {
      const pixelRatio = Math.max(1, window.devicePixelRatio || 1)
      const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio))
      const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        context.clearRect(0, 0, width, height)
        context.drawImage(video, 0, 0, width, height)

        offscreenContext.drawImage(
          video,
          0,
          0,
          offscreen.width,
          offscreen.height,
        )
        const imageData = offscreenContext.getImageData(
          0,
          0,
          offscreen.width,
          offscreen.height,
        )
        const luminances = sampleRowLuminance(imageData, config)
        const frame = advanceScanLines(
          linesRef.current,
          luminances,
          now - lastFrameRef.current,
          width,
          {
            ...config,
            pulseSpeed: config.pulseSpeed * pixelRatio,
          },
        )
        linesRef.current = frame.lines

        for (const event of frame.events) {
          const noteNumber = snapToScale(48 + event.noteIndex, 0, C_MAJOR)
          if (recordingRef.current) {
            const tick = millisecondsToLoopTick(
              now - recordingStartedAtRef.current,
              currentBpm(),
              song.timebase,
              loopLength,
            )
            pendingNotesRef.current.push({
              tick,
              duration: Math.max(1, Math.round(song.timebase / 2)),
              noteNumber,
              velocity: event.velocity,
            })
            setCapturedCount(pendingNotesRef.current.length)
            previewNote(noteNumber, event.velocity)
          }
        }

        const sampleX = width * config.sampleXRatio
        const triggerX = width * config.triggerRatio
        context.lineWidth = Math.max(1, pixelRatio)
        context.strokeStyle = "rgba(255, 255, 255, 0.2)"

        for (const line of linesRef.current) {
          const y = line.yRatio * height
          context.beginPath()
          context.moveTo(0, y)
          context.lineTo(width, y)
          context.stroke()

          if (line.active) {
            context.fillStyle = `rgba(82, 255, 188, ${line.triggered ? 0.95 : 0.65})`
            context.beginPath()
            context.arc(
              line.pulseX,
              y,
              Math.max(4, 5 * pixelRatio),
              0,
              Math.PI * 2,
            )
            context.fill()
          }
        }

        context.strokeStyle = "rgba(255, 183, 66, 0.9)"
        context.beginPath()
        context.moveTo(sampleX, 0)
        context.lineTo(sampleX, height)
        context.stroke()

        context.strokeStyle = "rgba(82, 255, 188, 0.9)"
        context.beginPath()
        context.moveTo(triggerX, 0)
        context.lineTo(triggerX, height)
        context.stroke()
      }

      lastFrameRef.current = now
      animationRef.current = requestAnimationFrame(draw)
    }

    lastFrameRef.current = performance.now()
    animationRef.current = requestAnimationFrame(draw)
    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
    }
  }, [
    cameraReady,
    config,
    currentBpm,
    loopLength,
    previewNote,
    song.timebase,
  ])

  const stopCapture = useCallback(() => {
    if (!recordingRef.current) return
    recordingRef.current = false
    setIsRecording(false)
    if (stopTimerRef.current !== null) {
      clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
    player.allSoundsOffChannel(0)

    const notes = pendingNotesRef.current
    pendingNotesRef.current = []
    setCapturedCount(0)

    if (notes.length === 0) {
      toast.error("Keine deutliche Bildbewegung erkannt.")
      return
    }

    const take: MusePerformanceTake = {
      id: crypto.randomUUID(),
      source: "gesture-instrument",
      notes,
      drumHits: [],
      controls: [],
      confidence: 0.8,
      role: "texture",
      loopStartTick: 0,
      loopLengthTicks: loopLength,
      createdAt: new Date().toISOString(),
    }
    const track = applyJamRoomTakeToSong(song, take)
    setLayers((previous) => [
      ...previous,
      { trackId: track.id, noteCount: notes.length },
    ])
    toast.success(`${notes.length} Kameratöne als Texture-Layer übernommen.`)
  }, [loopLength, player, song, toast])

  const startCapture = useCallback(() => {
    if (!cameraReady) {
      toast.error("Die Kamera ist noch nicht bereit.")
      return
    }
    if (recordingRef.current) {
      stopCapture()
      return
    }

    pendingNotesRef.current = []
    setCapturedCount(0)
    recordingStartedAtRef.current = performance.now()
    recordingRef.current = true
    setIsRecording(true)

    const durationMilliseconds = Math.round((16 * 60 * 1000) / currentBpm())
    stopTimerRef.current = window.setTimeout(stopCapture, durationMilliseconds)
  }, [cameraReady, currentBpm, stopCapture, toast])

  const undoLayer = useCallback(() => {
    setLayers((previous) => {
      const last = previous.at(-1)
      if (!last) return previous
      song.removeTrack(last.trackId)
      return previous.slice(0, -1)
    })
  }, [song])

  return (
    <Container>
      <HiddenVideo ref={videoRef} muted playsInline />
      <Canvas ref={canvasRef} />
      <Shade />
      <Interface>
        <Header>
          <div>
            <h1>MUSE CAMERA SEQUENCER</h1>
            <p>
              Bewege Gegenstände, Hände oder Zeichnungen durch die orange
              Erfassungslinie.
            </p>
          </div>
          {notice && <Notice>{notice}</Notice>}
        </Header>

        <ScannerLabel recording={isRecording}>
          <strong>{isRecording ? capturedCount : layers.length}</strong>
          <span>{isRecording ? "ERKANNTE TÖNE" : "CAMERA LAYERS"}</span>
        </ScannerLabel>

        <Footer>
          <Layers>
            {layers.map((layer, index) => (
              <Layer key={`${layer.trackId}-${index}`}>
                Scan {index + 1}: {layer.noteCount} Töne
              </Layer>
            ))}
          </Layers>
          <Controls>
            <PrimaryButton onClick={startCapture}>
              {isRecording ? "Stop & add layer" : "Scan 4 bars"}
            </PrimaryButton>
            <Sensitivity>
              Empfindlichkeit
              <input
                type="range"
                min={16}
                max={90}
                step={1}
                value={sensitivity}
                onChange={(event) => setSensitivity(Number(event.target.value))}
              />
            </Sensitivity>
            <Button onClick={undoLayer} disabled={layers.length === 0}>
              Undo camera layer
            </Button>
            <Button onClick={() => setPath("/jam")}>Back to Jam Room</Button>
            <Button onClick={() => setPath("/track")}>Edit in Piano Roll</Button>
          </Controls>
        </Footer>
      </Interface>
    </Container>
  )
}
