import styled from "@emotion/styled"
import { type FC, useCallback, useEffect, useRef, useState } from "react"
import { noteNameWithOctString } from "../../helpers/noteNumberString"
import {
  checkMediaAvailability,
  MediaUnavailableError,
} from "../../helpers/secureContext"
import { Localized, useLocalization } from "../../localize/useLocalization"
import { HandTracker } from "../../services/jamRoom/hands/HandTracker"
import { INDEX_TIP, MIDDLE_TIP } from "../../services/jamRoom/hands/landmarks"
import {
  StrikeDetector,
  velocityFromHandSpeed,
} from "../../services/jamRoom/hands/StrikeDetector"
import { handleCameraError } from "../../services/jamRoom/jamRoomUtils"
import {
  detectPaperKeyboard,
  type KeyZone,
  keyAt,
  keysToZones,
} from "../../services/jamRoom/vision/paperKeyboard"
import { Button } from "../ui/Button"
import { Chip } from "../ui/Panel"

/**
 * A keyboard printed or drawn on paper, played with the hands.
 *
 * The camera does two different jobs here and they run at different rates. The
 * *drawing* is read once, on request: paper does not move, and re-detecting it
 * every frame would spend the frame rate on a picture that never changes. The
 * *hands* are tracked continuously, because they are the only moving part.
 *
 * A strike is a fingertip inside a key moving down fast, the same test the drum
 * zones use. Paper gives no release, so a struck key is held for a fixed short
 * moment – long enough to sound and to be recorded as a note, short enough not
 * to smear into the next one.
 */

const HOLD_MS = 220

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem;
  border-top: 1px solid var(--color-divider);
  background: var(--color-background);
`

const Stage = styled.div`
  position: relative;
  width: 100%;
  max-height: 14rem;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 0.4rem;
  background: var(--color-background-dark);
`

const Video = styled.video`
  width: 100%;
  height: 100%;
  object-fit: cover;

  &[data-mirrored="true"] {
    transform: scaleX(-1);
  }
`

const KeyBox = styled.div`
  position: absolute;
  box-sizing: border-box;
  border: 1px solid var(--color-theme);
  border-radius: 0.15rem;
  color: var(--color-text);
  font-size: 0.55rem;
  text-align: center;
  pointer-events: none;

  &[data-black="true"] {
    border-color: var(--color-text-secondary);
    background: rgb(0 0 0 / 45%);
  }

  &[data-lit="true"] {
    background: var(--color-theme);
  }
`

const Row = styled.div`
  display: flex;
  gap: 0.4rem;
  align-items: center;
  flex-wrap: wrap;
  color: var(--color-text-secondary);
  font-size: 0.7rem;
`

const Message = styled.div`
  color: var(--color-text-secondary);
  font-size: 0.7rem;
`

export interface PaperKeysProps {
  onNoteOn: (noteNumber: number, velocity: number) => void
  onNoteOff: (noteNumber: number) => void
}

export const PaperKeys: FC<PaperKeysProps> = ({ onNoteOn, onNoteOff }) => {
  const localized = useLocalization()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [facing, setFacing] = useState<"user" | "environment">("environment")
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zones, setZones] = useState<KeyZone[]>([])
  const [anchored, setAnchored] = useState(true)
  const [lit, setLit] = useState<ReadonlySet<number>>(() => new Set())

  const zonesRef = useRef(zones)
  zonesRef.current = zones
  const onNoteOnRef = useRef(onNoteOn)
  onNoteOnRef.current = onNoteOn
  const onNoteOffRef = useRef(onNoteOff)
  onNoteOffRef.current = onNoteOff

  useEffect(() => {
    let cancelled = false
    const setup = async () => {
      try {
        const availability = checkMediaAvailability()
        if (!availability.available) {
          throw new MediaUnavailableError(availability.reason)
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setError(null)
        setReady(true)
      } catch (e) {
        setReady(false)
        setError(localized[handleCameraError(e) as "camera-error"])
      }
    }
    void setup()
    return () => {
      cancelled = true
      setReady(false)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [facing, localized])

  /** One frame, one reading of the drawing. */
  const scan = useCallback(() => {
    const video = videoRef.current
    if (!video || video.videoWidth <= 0) {
      setError(localized["jam-paper-no-camera"])
      return
    }
    const width = Math.min(480, video.videoWidth)
    const height = Math.round((video.videoHeight / video.videoWidth) * width)
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) return
    context.drawImage(video, 0, 0, width, height)

    const keyboard = detectPaperKeyboard(
      context.getImageData(0, 0, width, height),
    )
    if (!keyboard) {
      setZones([])
      setError(localized["jam-keys-nothing-found"])
      return
    }
    setZones(keysToZones(keyboard, { mirrored: facing === "user" }))
    setAnchored(keyboard.anchored)
    setError(null)
  }, [facing, localized])

  /** Hands run every frame; a strike on a key plays it. */
  useEffect(() => {
    if (!ready || zones.length === 0) return
    const video = videoRef.current
    if (!video) return

    let tracker: HandTracker | null = null
    let stopped = false
    const detectors = new Map<number, StrikeDetector>()
    const timers = new Map<number, number>()

    const strike = (noteNumber: number, velocity: number) => {
      const running = timers.get(noteNumber)
      if (running !== undefined) window.clearTimeout(running)
      else onNoteOnRef.current(noteNumber, velocity)
      timers.set(
        noteNumber,
        window.setTimeout(() => {
          timers.delete(noteNumber)
          onNoteOffRef.current(noteNumber)
          setLit((notes) => {
            const next = new Set(notes)
            next.delete(noteNumber)
            return next
          })
        }, HOLD_MS),
      )
      setLit((notes) => new Set(notes).add(noteNumber))
    }

    HandTracker.create(video)
      .then((instance) => {
        if (stopped) {
          instance.stop()
          return
        }
        tracker = instance
        instance.onFrame = (frame) => {
          for (const [index, hand] of frame.hands.entries()) {
            for (const tip of [INDEX_TIP, MIDDLE_TIP]) {
              const point = hand.landmarks[tip]
              if (!point) continue
              // landmarks are already normalized to the frame; the video is
              // mirrored on screen for the front camera and so are the zones,
              // so both live in the same space
              const x = (facing === "user" ? 1 - point.x : point.x) * 100
              const y = point.y * 100
              const zone = keyAt(zonesRef.current, x, y)
              const id = index * 2 + tip
              let detector = detectors.get(id)
              if (!detector) {
                detector = new StrikeDetector({ minSpeed: 0.7 })
                detectors.set(id, detector)
              }
              const hit = detector.update(
                zone?.id ?? null,
                x / 100,
                y / 100,
                frame.timeMs,
              )
              if (hit && zone) {
                strike(zone.noteNumber, velocityFromHandSpeed(hit.speed))
              }
            }
          }
        }
        instance.start()
      })
      .catch(() => setError(localized["jam-hands-unavailable"]))

    return () => {
      stopped = true
      tracker?.stop()
      for (const [note, timer] of timers) {
        window.clearTimeout(timer)
        onNoteOffRef.current(note)
      }
      timers.clear()
    }
  }, [facing, localized, ready, zones.length])

  return (
    <Panel>
      <Stage>
        <Video
          ref={videoRef}
          data-mirrored={facing === "user"}
          autoPlay
          playsInline
          muted
        />
        {zones.map((zone) => (
          <KeyBox
            key={zone.id}
            data-black={zone.black}
            data-lit={lit.has(zone.noteNumber)}
            style={{
              left: `${zone.xPct}%`,
              top: `${zone.yPct}%`,
              width: `${zone.widthPct}%`,
              height: `${zone.heightPct}%`,
            }}
          >
            {zone.black ? "" : noteNameWithOctString(zone.noteNumber)}
          </KeyBox>
        ))}
      </Stage>

      <Row>
        <Button onClick={scan} disabled={!ready}>
          <Localized name="jam-scan-keys" />
        </Button>
        <Chip
          data-selected={facing === "environment"}
          onClick={() =>
            setFacing((f) => (f === "user" ? "environment" : "user"))
          }
        >
          <Localized name="jam-rear-camera" />
        </Chip>
        {zones.length > 0 && (
          <span>
            {localized["jam-keys-found"]}:{" "}
            {zones.filter((z) => !z.black).length}
          </span>
        )}
        {zones.length > 0 && !anchored && (
          <Chip data-tone="danger">
            <Localized name="jam-keys-unanchored" />
          </Chip>
        )}
      </Row>

      {error !== null && <Message>{error}</Message>}
    </Panel>
  )
}
