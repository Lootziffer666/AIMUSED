import { keyframes } from "@emotion/react"
import styled from "@emotion/styled"
import { getTempo } from "@signal-app/core"
import { useToast } from "dialog-hooks"
import {
  type FC,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { DEFAULT_TEMPO } from "../../Constants"
import type {
  MusePerformanceDrumHit,
  MusePerformanceNote,
  MusePerformanceTake,
  MuseTrackRole,
} from "../../entities/performance/MusePerformanceTake"
import { useRouter } from "../../hooks/useRouter"
import { useStores } from "../../hooks/useStores"
import {
  CHANNEL_PROGRAM,
  getJamAudioEngine,
} from "../../services/jamRoom/audio/JamAudioEngine"
import { LoopScheduler } from "../../services/jamRoom/audio/LoopScheduler"
import {
  MelodyTracker,
  VoiceAnalyzer,
} from "../../services/jamRoom/audio/VoiceAnalyzer"
import type { ThereminHandEvent } from "../../services/jamRoom/hands/HandController"
import { velocityFromHandSpeed } from "../../services/jamRoom/hands/StrikeDetector"
import {
  buildScaleNotes,
  handleMicError,
  intervalsForMode,
  keyName,
  noteName,
  quantizeTick,
  velocityFromPointerSpeed,
} from "../../services/jamRoom/inputMapping"
import { applyJamRoomTakeToSong } from "../../services/jamRoom/jamRoomSongAdapter"
import {
  handleCameraError,
  snapToScale,
} from "../../services/jamRoom/jamRoomUtils"
import { generateAccompaniment } from "../../services/jamRoom/music/AccompanimentGenerator"
import {
  detectKey,
  pitchClassHistogram,
} from "../../services/jamRoom/music/KeyAndChords"
import {
  hasMelodicTake,
  undoLastTake,
  wrapTick,
} from "../../services/jamRoom/takeOps"
import { HandOverlay } from "./HandOverlay"

// ---------- styled ----------

const sway = keyframes`
  0% { transform: rotate(-4deg) translateX(-2%); }
  100% { transform: rotate(4deg) translateX(2%); }
`
const recPulse = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 77, 61, 0.55); }
  50% { box-shadow: 0 0 0 14px rgba(255, 77, 61, 0); }
`
const zoneFlash = keyframes`
  0% { transform: translate(-50%, -50%) scale(1); }
  35% { transform: translate(-50%, -50%) scale(1.12); }
  100% { transform: translate(-50%, -50%) scale(1); }
`
const layerIn = keyframes`
  from { opacity: 0; transform: translateX(-14px); }
  to { opacity: 1; transform: translateX(0); }
`
const liveBlink = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
`

const Stage = styled.div`
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  color: #e8eef5;
  background:
    radial-gradient(1100px 700px at 12% -8%, rgba(34, 78, 102, 0.5), transparent 62%),
    radial-gradient(900px 640px at 92% 108%, rgba(112, 62, 32, 0.32), transparent 60%),
    #0b1118;
  font-family: inherit;
`
const Beams = styled.div`
  position: absolute;
  inset: -20%;
  pointer-events: none;
  background:
    conic-gradient(from 195deg at 22% 0%, rgba(64, 160, 190, 0.1) 0deg, transparent 16deg),
    conic-gradient(from 155deg at 78% 0%, rgba(240, 160, 80, 0.08) 0deg, transparent 15deg);
  transform-origin: 50% 0%;
  animation: ${sway} 16s ease-in-out infinite alternate;
`
const Vignette = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(4, 8, 12, 0.75) 100%);
`
const CamVideo = styled.video`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.22;
  transform: scaleX(-1);
  filter: saturate(0.6) contrast(1.05);
`
const CamError = styled.div`
  position: absolute;
  top: 74px;
  right: 24px;
  z-index: 30;
  padding: 8px 14px;
  border: 1px solid rgba(255, 176, 84, 0.4);
  border-radius: 8px;
  color: #ffb054;
  background: rgba(40, 26, 8, 0.85);
  font-size: 12px;
`
const TopBar = styled.div`
  position: relative;
  z-index: 20;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 24px 10px;
`
const Brand = styled.div`
  color: #7d93a8;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.42em;
`
const Title = styled.h1`
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 2px 0 0;
  font-size: 30px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -0.02em;
`
const LiveDot = styled.span<{ on: boolean }>`
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: ${(p) => (p.on ? "#ff4d3d" : "#3a4a5a")};
  animation: ${(p) => (p.on ? liveBlink : "none")} 1.1s infinite;
`
const Readouts = styled.div`
  display: flex;
  gap: 14px;
  align-items: center;
`
const ReadoutBox = styled.div`
  text-align: right;

  .value {
    font-size: 26px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-weight: 700;
    line-height: 1;
  }

  .label {
    margin-top: 3px;
    color: #7d93a8;
    font-size: 9px;
    letter-spacing: 0.3em;
  }
`
const KeySelect = styled.select`
  padding: 5px 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  color: #e8eef5;
  background: rgba(12, 20, 30, 0.9);
  font-size: 12px;
  font-family: ui-monospace, Menlo, monospace;
  cursor: pointer;

  &:hover {
    border-color: rgba(255, 255, 255, 0.35);
  }
`
const SmallBtn = styled.button<{ accent?: string }>`
  padding: 7px 12px;
  border: 1px solid ${(p) => p.accent ?? "rgba(255,255,255,0.14)"};
  border-radius: 6px;
  color: #e8eef5;
  background: rgba(12, 20, 30, 0.85);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.12s ease, background 0.12s ease;

  &:hover {
    border-color: ${(p) => p.accent ?? "#f5a524"};
    transform: translateY(-1px);
  }

  &:active {
    transform: scale(0.96);
  }
`
const MainArea = styled.div`
  position: relative;
  z-index: 15;
  display: flex;
  flex: 1;
  min-height: 0;
  padding-bottom: 88px;
`
const ThereminField = styled.div`
  position: relative;
  width: 26%;
  min-width: 220px;
  margin: 8px 0 8px 24px;
  overflow: hidden;
  border: 1px solid rgba(255, 46, 136, 0.25);
  border-radius: 12px;
  background: linear-gradient(90deg, rgba(255, 46, 136, 0.07), rgba(34, 211, 238, 0.04));
  cursor: crosshair;
  touch-action: none;
`
const StringLine = styled.div<{ active: boolean }>`
  position: absolute;
  right: 8%;
  left: 8%;
  height: 2px;
  background: ${(p) => (p.active ? "#ff2e88" : "rgba(255,255,255,0.10)")};
  box-shadow: ${(p) => (p.active ? "0 0 14px #ff2e88" : "none")};
  transition: background 0.08s ease;
`
const PitchTag = styled.div<{ y: number }>`
  position: absolute;
  top: ${(p) => p.y}%;
  right: 10px;
  color: #ff77b3;
  font-size: 13px;
  font-family: ui-monospace, Menlo, monospace;
  font-weight: 700;
  text-shadow: 0 0 10px rgba(255, 46, 136, 0.8);
  transform: translateY(-50%);
`
const FieldHint = styled.div`
  position: absolute;
  right: 0;
  bottom: 10px;
  left: 0;
  color: #6d8296;
  font-size: 9px;
  letter-spacing: 0.28em;
  text-align: center;
  text-transform: uppercase;
`
const CenterStage = styled.div`
  position: relative;
  flex: 1;
  touch-action: none;
`
const Zone = styled.div<{ color: string; hit: boolean }>`
  position: absolute;
  display: flex;
  width: 132px;
  height: 132px;
  align-items: center;
  justify-content: center;
  border: 3px dashed ${(p) => p.color};
  border-radius: 50%;
  background: ${(p) => (p.hit ? `${p.color}3d` : "rgba(255,255,255,0.02)")};
  box-shadow: ${(p) => (p.hit ? `0 0 34px ${p.color}` : "none")};
  cursor: pointer;
  animation: ${(p) => (p.hit ? zoneFlash : "none")} 0.22s ease;
  user-select: none;
`
const ZoneLabel = styled.span<{ color: string }>`
  color: ${(p) => p.color};
  font-size: 12px;
  font-family: ui-monospace, Menlo, monospace;
  font-weight: 700;
  letter-spacing: 0.18em;
`
const ZoneGrip = styled.div`
  position: absolute;
  top: -6px;
  left: 50%;
  width: 26px;
  height: 12px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.16);
  cursor: grab;
  transform: translateX(-50%);

  &:hover {
    background: rgba(255, 255, 255, 0.35);
  }
`
const RingWrap = styled.div`
  position: absolute;
  top: 46%;
  left: 50%;
  display: flex;
  width: 190px;
  height: 190px;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  transform: translate(-50%, -50%);
`
const RingCenter = styled.div`
  position: absolute;
  text-align: center;

  .bar {
    font-size: 24px;
    font-family: ui-monospace, Menlo, monospace;
    font-weight: 700;
  }

  .sub {
    margin-top: 2px;
    color: #7d93a8;
    font-size: 9px;
    letter-spacing: 0.3em;
  }
`
const VoiceCanvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
`
const LayersShelf = styled.div`
  position: absolute;
  bottom: 14px;
  left: 18px;
  display: flex;
  max-width: 250px;
  flex-direction: column;
  gap: 6px;
`
const LayerPill = styled.div<{ color: string }>`
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 12px;
  border: 1px solid ${(p) => p.color}55;
  border-radius: 8px;
  background: rgba(8, 14, 21, 0.85);
  font-size: 11px;
  animation: ${layerIn} 0.3s ease;
`
const LayerDot = styled.span<{ color: string }>`
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${(p) => p.color};
`
const MuseBadge = styled.span`
  padding: 2px 5px;
  border-radius: 4px;
  color: #0b1118;
  background: #2dd4a7;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.16em;
`
const BottomBar = styled.div`
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 25;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 14px 24px;
  background: linear-gradient(0deg, rgba(6, 10, 16, 0.92) 30%, transparent);
`
const RecButton = styled.button<{ recording: boolean }>`
  width: 58px;
  height: 58px;
  border: 2px solid ${(p) => (p.recording ? "#ff4d3d" : "#f5a524")};
  border-radius: 50%;
  color: ${(p) => (p.recording ? "#ff8a7d" : "#f5c56b")};
  background: ${(p) =>
    p.recording ? "rgba(255, 77, 61, 0.18)" : "rgba(245, 165, 36, 0.10)"};
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.14em;
  white-space: pre-line;
  cursor: pointer;
  transition: transform 0.12s ease;
  animation: ${(p) => (p.recording ? recPulse : "none")} 1.4s infinite;

  &:hover {
    transform: scale(1.06);
  }

  &:active {
    transform: scale(0.94);
  }
`
const ArmButton = styled.button<{ color: string; armed: boolean }>`
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 11px 16px;
  border: 1px solid ${(p) => (p.armed ? p.color : "rgba(255,255,255,0.14)")};
  border-radius: 9px;
  color: ${(p) => (p.armed ? p.color : "#9db1c4")};
  background: ${(p) => (p.armed ? `${p.color}26` : "rgba(12, 20, 30, 0.8)")};
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.12s ease;

  &::before {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${(p) => (p.armed ? p.color : "#3a4a5a")};
    content: "";
  }

  &:hover {
    transform: translateY(-1px);
  }

  &:active {
    transform: scale(0.96);
  }
`
const GhostButton = styled.button`
  padding: 11px 16px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 9px;
  color: #9db1c4;
  background: rgba(12, 20, 30, 0.8);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.12s ease;

  &:hover {
    border-color: rgba(255, 255, 255, 0.4);
    color: #e8eef5;
    transform: translateY(-1px);
  }

  &:active {
    transform: scale(0.96);
  }

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    transform: none;
  }
`
const ExportButton = styled.button`
  margin-left: auto;
  padding: 13px 20px;
  border: none;
  border-radius: 9px;
  color: #161006;
  background: #f5a524;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.12s ease;

  &:hover {
    background: #ffbd4d;
    box-shadow: 0 6px 22px rgba(245, 165, 36, 0.35);
    transform: translateY(-1px);
  }

  &:active {
    transform: scale(0.96);
  }
`
const Hint = styled.div`
  position: absolute;
  bottom: 96px;
  left: 50%;
  z-index: 18;
  color: #6d8296;
  font-size: 11px;
  letter-spacing: 0.1em;
  white-space: nowrap;
  pointer-events: none;
  transform: translateX(-50%);
`

// ---------- config ----------

interface DrumZoneState {
  id: string
  label: string
  color: string
  xPct: number
  yPct: number
}

const INITIAL_ZONES: DrumZoneState[] = [
  { id: "kick", label: "KICK", color: "#ff4d3d", xPct: 24, yPct: 70 },
  { id: "snare", label: "SNARE", color: "#ff8f3f", xPct: 50, yPct: 62 },
  { id: "hihat", label: "HIHAT", color: "#ffd23f", xPct: 76, yPct: 70 },
]

const ADDABLE_ZONES: Omit<DrumZoneState, "xPct" | "yPct">[] = [
  { id: "tom", label: "TOM", color: "#ff5f8f" },
  { id: "clap", label: "CLAP", color: "#ffb37f" },
]

const ZONE_RADIUS_PX = 72

// MUSE layers in the order they join the jam, one per completed loop
const ACCOMPANIMENT_ROLES: MuseTrackRole[] = ["bass", "pad", "guitar"]

const ROLE_COLOR: Record<string, string> = {
  melody: "#f5a524",
  percussion: "#ff8f3f",
  guitar: "#ff2e88",
  bass: "#2dd4a7",
  pad: "#38bdf8",
}

const SOURCE_LABEL: Record<string, string> = {
  voice: "VOX",
  "painted-drums": "DRUMS",
  "gesture-instrument": "EXPR",
  accompaniment: "MUSE",
}

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
]

// ---------- component ----------

export const JamRoom: FC = () => {
  const rootStore = useStores()
  const { songStore, player, synth, synthGroup } = rootStore
  const toast = useToast()
  const { setPath } = useRouter()

  const song = songStore.song
  const timebase = song.timebase
  const STEP_TICKS = Math.floor(timebase / 4)
  const LOOP_TICKS = timebase * 16

  // ---- state ----
  const [takes, setTakes] = useState<MusePerformanceTake[]>([])
  const [zones, setZones] = useState<DrumZoneState[]>(INITIAL_ZONES)
  const [flash, setFlash] = useState<Record<string, boolean>>({})
  const [dragZone, setDragZone] = useState<string | null>(null)
  const [isRecordingVoice, setIsRecordingVoice] = useState(false)
  const [drumsArmed, setDrumsArmed] = useState(false)
  const [thereminArmed, setThereminArmed] = useState(false)
  const [thereminNote, setThereminNote] = useState<number | null>(null)
  const [loopStep, setLoopStep] = useState(0)
  const [loopCount, setLoopCount] = useState(0)
  const [bpm, setBpmState] = useState<number>(() => {
    const conductor = song.conductorTrack
    return conductor
      ? (getTempo(conductor.events, 0) ?? DEFAULT_TEMPO)
      : DEFAULT_TEMPO
  })
  const [musicKey, setMusicKey] = useState<{
    root: number
    mode: "major" | "minor"
    manual: boolean
  }>({ root: 0, mode: "major", manual: false })
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [handsOn, setHandsOn] = useState(false)
  const [handsSwapped, setHandsSwapped] = useState(false)
  const [handsStatus, setHandsStatus] = useState<
    "off" | "loading" | "running" | "error"
  >("off")
  const [handsMsg, setHandsMsg] = useState<string | null>(null)

  // ---- refs ----
  const videoRef = useRef<HTMLVideoElement>(null)
  const camStreamRef = useRef<MediaStream | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const thereminRef = useRef<HTMLDivElement>(null)
  const voiceCanvasRef = useRef<HTMLCanvasElement>(null)
  const schedulerRef = useRef<LoopScheduler | null>(null)
  const analyzerRef = useRef<VoiceAnalyzer | null>(null)
  const trackerRef = useRef<MelodyTracker | null>(null)
  const trailRef = useRef<{ x: number; midi: number }[]>([])
  const drumHitsRef = useRef<MusePerformanceDrumHit[]>([])
  const thereminNotesRef = useRef<MusePerformanceNote[]>([])
  const thereminActiveRef = useRef(false)
  const thereminCaptureRef = useRef<{
    startTick: number
    note: number
    vel: number
  } | null>(null)
  const pointerTrailRef = useRef<{ x: number; y: number; t: number }[]>([])
  const tapsRef = useRef<number[]>([])
  const zonesRef = useRef(zones)
  const programmedChannelsRef = useRef<Set<number>>(new Set())

  const engine = getJamAudioEngine()
  const scaleNotes = useMemo(
    () => buildScaleNotes(musicKey.root, musicKey.mode, 18, 4),
    [musicKey.root, musicKey.mode],
  )
  const intervals = useMemo(
    () => intervalsForMode(musicKey.mode),
    [musicKey.mode],
  )

  useEffect(() => {
    zonesRef.current = zones
  }, [zones])

  // ---- pointer speed ----
  const trackPointer = useCallback((e: ReactPointerEvent) => {
    const now = performance.now()
    pointerTrailRef.current.push({ x: e.clientX, y: e.clientY, t: now })
    if (pointerTrailRef.current.length > 6) pointerTrailRef.current.shift()
  }, [])

  const pointerSpeed = useCallback((): number => {
    const pts = pointerTrailRef.current
    if (pts.length < 2) return 0
    const a = pts[0]
    const b = pts[pts.length - 1]
    const dt = b.t - a.t
    if (dt <= 0) return 0
    return Math.hypot(b.x - a.x, b.y - a.y) / dt
  }, [])

  // ---- camera (stage mirror) ----
  useEffect(() => {
    let cancelled = false
    const setup = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        camStreamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
      } catch (e) {
        setCameraError(handleCameraError(e))
      }
    }
    void setup()
    return () => {
      cancelled = true
      camStreamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // ---- audio hookup: share the app clock, route through the SoundFont ----
  useEffect(() => {
    engine.adoptContext(rootStore.audioContext)
    programmedChannelsRef.current.clear()
    engine.setSoundFontPlayer(
      (time, channel, noteNumber, velocity, duration) => {
        if (!synth.isLoaded) return false
        const delay = Math.max(0, time - engine.now())
        synthGroup.activate()
        if (!programmedChannelsRef.current.has(channel)) {
          programmedChannelsRef.current.add(channel)
          player.sendEvent({
            type: "channel",
            subtype: "programChange",
            channel,
            value: CHANNEL_PROGRAM[channel] ?? 0,
          })
        }
        player.sendEvent(
          { type: "channel", subtype: "noteOn", channel, noteNumber, velocity },
          delay,
        )
        player.sendEvent(
          {
            type: "channel",
            subtype: "noteOff",
            channel,
            noteNumber,
            velocity: 0,
          },
          delay + duration,
        )
        return true
      },
    )
    return () => engine.setSoundFontPlayer(null)
  }, [engine, player, rootStore.audioContext, synth, synthGroup])

  // ---- scheduler lifecycle ----
  const ensureScheduler = useCallback((): LoopScheduler => {
    if (!schedulerRef.current) {
      const s = new LoopScheduler(engine, timebase, bpm)
      s.onPosition = (step) => setLoopStep(step)
      s.onLoopComplete = (i) => setLoopCount(i)
      schedulerRef.current = s
    }
    if (!schedulerRef.current.isRunning) schedulerRef.current.start()
    return schedulerRef.current
  }, [engine, timebase, bpm])

  useEffect(() => {
    if (schedulerRef.current) schedulerRef.current.takes = takes
  }, [takes])

  useEffect(
    () => () => {
      schedulerRef.current?.stop()
      analyzerRef.current?.stop()
      engine.thereminOff()
    },
    [engine],
  )

  // ---- key detection from the first real melodic take ----
  useEffect(() => {
    if (musicKey.manual) return
    const melodic = takes.find(
      (t) =>
        t.generatedBy !== "muse" && t.notes.length >= 3 && t.source === "voice",
    )
    if (!melodic) return
    const det = detectKey(pitchClassHistogram(melodic.notes))
    if (
      det.score > 0.5 &&
      (det.root !== musicKey.root || det.mode !== musicKey.mode)
    ) {
      setMusicKey({ root: det.root, mode: det.mode, manual: false })
      toast.info(`Tonart erkannt: ${keyName(det.root, det.mode)}`)
    }
  }, [takes, musicKey, toast])

  // ---- accompaniment: grows with each completed loop ----
  useEffect(() => {
    if (!hasMelodicTake(takes)) return
    const intensity = Math.min(3, Math.max(1, loopCount)) as 1 | 2 | 3
    const present = new Set(
      takes.filter((t) => t.generatedBy === "muse").map((t) => t.role),
    )
    const wanted: MuseTrackRole[] = ACCOMPANIMENT_ROLES.slice(0, intensity)
    const missing = wanted.filter((r) => !present.has(r))
    if (missing.length === 0) return
    const melodyNotes = takes
      .filter((t) => t.generatedBy !== "muse" && t.notes.length > 0)
      .flatMap((t) => t.notes)
    const generated = generateAccompaniment({
      melodyNotes,
      keyRoot: musicKey.root,
      mode: musicKey.mode,
      timebase,
      loopLengthTicks: LOOP_TICKS,
      intensity,
    }).filter((t) => missing.includes(t.role))
    if (generated.length > 0) setTakes((prev) => [...prev, ...generated])
  }, [loopCount, takes, musicKey, timebase, LOOP_TICKS])

  // ---- voice recording (real mic + pitch tracking) ----
  const loopTickAtTime = useCallback(
    (timeSec: number): number => {
      const s = schedulerRef.current
      if (!s) return 0
      const rel = timeSec - s.loopStart
      return wrapTick(Math.round(rel / s.secondsPerTick), LOOP_TICKS)
    },
    [LOOP_TICKS],
  )

  const drawTrail = useCallback(() => {
    const cv = voiceCanvasRef.current
    if (!cv) return
    const g = cv.getContext("2d")
    if (!g) return
    g.clearRect(0, 0, cv.width, cv.height)
    const trail = trailRef.current
    if (trail.length < 2) return
    g.beginPath()
    trail.forEach((p, i) => {
      const x = p.x * cv.width
      const y = (1 - (p.midi - 48) / 40) * cv.height
      if (i === 0) g.moveTo(x, y)
      else g.lineTo(x, y)
    })
    g.strokeStyle = "#f5a524"
    g.lineWidth = 3
    g.lineJoin = "round"
    g.shadowColor = "#f5a524"
    g.shadowBlur = 14
    g.stroke()
  }, [])

  const startVoiceRecording = useCallback(async () => {
    ensureScheduler()
    try {
      const analyzer = await VoiceAnalyzer.start(engine)
      analyzerRef.current = analyzer
      const tracker = new MelodyTracker()
      trackerRef.current = tracker
      trailRef.current = []
      const cv = voiceCanvasRef.current
      if (cv && stageRef.current) {
        cv.width = stageRef.current.offsetWidth
        cv.height = stageRef.current.offsetHeight
      }
      analyzer.onFrame = (f) => {
        if (f.midi !== null && f.midi !== undefined) {
          const s = schedulerRef.current
          if (s) {
            const pos = wrapTick(
              Math.round(s.currentLoopPositionTicks()),
              LOOP_TICKS,
            )
            trailRef.current.push({ x: pos / LOOP_TICKS, midi: f.midi })
            if (trailRef.current.length > 900) trailRef.current.shift()
          }
          drawTrail()
        }
        tracker.addFrame(f)
      }
      setIsRecordingVoice(true)
      toast.success("Aufnahme läuft – sing oder summ in den Loop.")
    } catch (e) {
      toast.error(handleMicError(e))
    }
  }, [LOOP_TICKS, drawTrail, engine, ensureScheduler, toast])

  const stopVoiceRecording = useCallback(() => {
    analyzerRef.current?.stop()
    analyzerRef.current = null
    setIsRecordingVoice(false)
    const raw = trackerRef.current?.finish() ?? []
    trackerRef.current = null
    if (raw.length === 0) {
      toast.info("Nichts erkannt – einfach nochmal versuchen.")
      return
    }
    const notes: MusePerformanceNote[] = raw.map((n) => {
      const startTick = quantizeTick(loopTickAtTime(n.startSec), STEP_TICKS)
      const endRaw = loopTickAtTime(n.endSec)
      let dur = endRaw - startTick
      if (dur < 0) dur += LOOP_TICKS
      dur = Math.max(STEP_TICKS, quantizeTick(dur, STEP_TICKS))
      return {
        tick: startTick,
        duration: Math.min(dur, LOOP_TICKS - STEP_TICKS),
        noteNumber: snapToScale(Math.round(n.midi), musicKey.root, intervals),
        velocity: Math.max(
          45,
          Math.min(115, Math.round(45 + n.loudness * 500)),
        ),
      }
    })
    const conf = raw.reduce((a, n) => a + n.confidence, 0) / raw.length
    const take: MusePerformanceTake = {
      id: crypto.randomUUID(),
      source: "voice",
      notes,
      drumHits: [],
      controls: [],
      confidence: conf,
      role: "melody",
      generatedBy: "user",
      loopStartTick: 0,
      loopLengthTicks: LOOP_TICKS,
      createdAt: new Date().toISOString(),
    }
    setTakes((prev) => [...prev, take])
    toast.success(`${notes.length} Noten im Loop.`)
  }, [LOOP_TICKS, STEP_TICKS, intervals, loopTickAtTime, musicKey.root, toast])

  // ---- drums ----
  const strikeZone = useCallback(
    (z: DrumZoneState, vel: number) => {
      engine.playDrumAt(engine.now(), z.id, vel)
      setFlash((prev) => ({ ...prev, [z.id]: true }))
      window.setTimeout(
        () => setFlash((prev) => ({ ...prev, [z.id]: false })),
        200,
      )
      if (drumsArmed) {
        const s = ensureScheduler()
        drumHitsRef.current.push({
          tick: quantizeTick(
            wrapTick(Math.round(s.currentLoopPositionTicks()), LOOP_TICKS),
            STEP_TICKS,
          ),
          zoneId: z.id,
          velocity: vel,
          confidence: 1,
        })
      }
    },
    [LOOP_TICKS, STEP_TICKS, drumsArmed, engine, ensureScheduler],
  )

  const hitZone = useCallback(
    (z: DrumZoneState) => {
      strikeZone(z, velocityFromPointerSpeed(pointerSpeed()))
    },
    [pointerSpeed, strikeZone],
  )

  // Stage-pixel based hit test, shared by pointer and hand tracking
  const zoneAtPoint = useCallback(
    (xPx: number, yPx: number): DrumZoneState | null => {
      const stage = stageRef.current
      if (!stage) return null
      const r = stage.getBoundingClientRect()
      for (const z of zonesRef.current) {
        const zx = (z.xPct / 100) * r.width
        const zy = (z.yPct / 100) * r.height
        if (Math.hypot(xPx - zx, yPx - zy) <= ZONE_RADIUS_PX) return z
      }
      return null
    },
    [],
  )

  const toggleDrums = useCallback(() => {
    if (drumsArmed) {
      const hits = drumHitsRef.current
      drumHitsRef.current = []
      if (hits.length > 0) {
        const take: MusePerformanceTake = {
          id: crypto.randomUUID(),
          source: "painted-drums",
          notes: [],
          drumHits: hits,
          controls: [],
          confidence: 1,
          role: "percussion",
          generatedBy: "user",
          loopStartTick: 0,
          loopLengthTicks: LOOP_TICKS,
          createdAt: new Date().toISOString(),
        }
        setTakes((prev) => [...prev, take])
        toast.success(`${hits.length} Schläge im Loop.`)
      }
      setDrumsArmed(false)
    } else {
      ensureScheduler()
      drumHitsRef.current = []
      setDrumsArmed(true)
    }
  }, [LOOP_TICKS, drumsArmed, ensureScheduler, toast])

  // ---- zone dragging ----
  useEffect(() => {
    if (!dragZone) return
    const move = (e: PointerEvent) => {
      const r = stageRef.current?.getBoundingClientRect()
      if (!r) return
      const xPct = Math.max(
        6,
        Math.min(94, ((e.clientX - r.left) / r.width) * 100),
      )
      const yPct = Math.max(
        10,
        Math.min(88, ((e.clientY - r.top) / r.height) * 100),
      )
      setZones((prev) =>
        prev.map((z) => (z.id === dragZone ? { ...z, xPct, yPct } : z)),
      )
    }
    const up = () => setDragZone(null)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    return () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
  }, [dragZone])

  const addZone = useCallback(() => {
    const next = ADDABLE_ZONES.find((a) => !zones.some((z) => z.id === a.id))
    if (!next) {
      toast.info("Mehr Zonen gibt es in dieser Version nicht.")
      return
    }
    setZones((prev) => [...prev, { ...next, xPct: 62, yPct: 38 }])
  }, [zones, toast])

  // ---- theremin (continuous pitch, scale-bound) ----
  const noteFromT = useCallback(
    (t: number): number => {
      const clamped = Math.max(0, Math.min(1, t))
      return scaleNotes[Math.round(clamped * (scaleNotes.length - 1))]
    },
    [scaleNotes],
  )

  const noteFromY = useCallback(
    (clientY: number): number => {
      const el = thereminRef.current
      if (!el) return scaleNotes[0]
      const r = el.getBoundingClientRect()
      return noteFromT(1 - (clientY - r.top) / r.height)
    },
    [noteFromT, scaleNotes],
  )

  const finalizeThereminNote = useCallback(
    (cap: { startTick: number; note: number; vel: number }) => {
      const s = schedulerRef.current
      if (!s) return
      const nowTick = wrapTick(
        Math.round(s.currentLoopPositionTicks()),
        LOOP_TICKS,
      )
      let dur = nowTick - cap.startTick
      if (dur < 0) dur += LOOP_TICKS
      thereminNotesRef.current.push({
        tick: cap.startTick,
        duration: Math.max(STEP_TICKS, Math.min(dur, LOOP_TICKS - STEP_TICKS)),
        noteNumber: snapToScale(cap.note, musicKey.root, intervals),
        velocity: cap.vel,
      })
    },
    [LOOP_TICKS, STEP_TICKS, intervals, musicKey.root],
  )

  // Shared theremin control – driven by pointer AND hand tracking
  const thereminBegin = useCallback(
    (note: number, vel: number) => {
      engine.thereminOn(note, vel)
      thereminActiveRef.current = true
      setThereminNote(note)
      if (thereminArmed) {
        const s = ensureScheduler()
        thereminCaptureRef.current = {
          startTick: quantizeTick(
            wrapTick(Math.round(s.currentLoopPositionTicks()), LOOP_TICKS),
            STEP_TICKS,
          ),
          note,
          vel,
        }
      }
    },
    [LOOP_TICKS, STEP_TICKS, engine, ensureScheduler, thereminArmed],
  )

  const thereminMoveShared = useCallback(
    (note: number, vibratoCents: number) => {
      if (!thereminActiveRef.current) return
      engine.thereminSet(note)
      engine.thereminVibrato(vibratoCents)
      setThereminNote(note)
      const cap = thereminCaptureRef.current
      if (cap && Math.abs(note - cap.note) >= 1) {
        finalizeThereminNote(cap)
        const s = schedulerRef.current
        if (s) {
          thereminCaptureRef.current = {
            startTick: quantizeTick(
              wrapTick(Math.round(s.currentLoopPositionTicks()), LOOP_TICKS),
              STEP_TICKS,
            ),
            note,
            vel: cap.vel,
          }
        }
      }
    },
    [LOOP_TICKS, STEP_TICKS, engine, finalizeThereminNote],
  )

  const thereminEnd = useCallback(() => {
    if (!thereminActiveRef.current) return
    engine.thereminOff()
    thereminActiveRef.current = false
    const cap = thereminCaptureRef.current
    if (cap) {
      finalizeThereminNote(cap)
      thereminCaptureRef.current = null
    }
    if (thereminNotesRef.current.length > 0) {
      const take: MusePerformanceTake = {
        id: crypto.randomUUID(),
        source: "gesture-instrument",
        notes: thereminNotesRef.current,
        drumHits: [],
        controls: [],
        confidence: 0.85,
        role: "guitar",
        generatedBy: "user",
        loopStartTick: 0,
        loopLengthTicks: LOOP_TICKS,
        createdAt: new Date().toISOString(),
      }
      setTakes((prev) => [...prev, take])
      thereminNotesRef.current = []
    }
    setThereminNote(null)
  }, [LOOP_TICKS, engine, finalizeThereminNote])

  const onThereminDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      trackPointer(e)
      thereminBegin(
        noteFromY(e.clientY),
        velocityFromPointerSpeed(pointerSpeed()),
      )
    },
    [noteFromY, pointerSpeed, thereminBegin, trackPointer],
  )

  const onThereminMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      trackPointer(e)
      const el = thereminRef.current
      let vibrato = 8
      if (el) {
        const r = el.getBoundingClientRect()
        vibrato = ((e.clientX - r.left) / r.width) * 28
      }
      thereminMoveShared(noteFromY(e.clientY), vibrato)
    },
    [noteFromY, thereminMoveShared, trackPointer],
  )

  const onThereminUp = useCallback(() => {
    thereminEnd()
  }, [thereminEnd])

  // ---- hand tracking sinks ----
  const onHandDrumStrike = useCallback(
    (xPx: number, yPx: number, speed: number) => {
      const z = zoneAtPoint(xPx, yPx)
      if (z) strikeZone(z, velocityFromHandSpeed(speed))
    },
    [strikeZone, zoneAtPoint],
  )

  const onHandTheremin = useCallback(
    (evt: ThereminHandEvent) => {
      if (evt.type === "on") {
        thereminBegin(noteFromT(evt.t), velocityFromHandSpeed(evt.speed))
      } else if (evt.type === "move") {
        thereminMoveShared(
          noteFromT(evt.t) + evt.bendCents / 100,
          evt.vibratoCents,
        )
      } else {
        thereminEnd()
      }
    },
    [noteFromT, thereminBegin, thereminEnd, thereminMoveShared],
  )

  const handZoneIdAt = useCallback(
    (x: number, y: number) => zoneAtPoint(x, y)?.id ?? null,
    [zoneAtPoint],
  )

  const onHandStatus = useCallback(
    (s: "loading" | "running" | "error", msg?: string) => {
      setHandsStatus(s)
      setHandsMsg(msg ?? null)
    },
    [],
  )

  // ---- transport ----
  const setBpm = useCallback((b: number) => {
    setBpmState(b)
    schedulerRef.current?.setBpm(b)
  }, [])

  const onTapTempo = useCallback(() => {
    const now = performance.now()
    const taps = tapsRef.current
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) taps.length = 0
    taps.push(now)
    if (taps.length >= 2) {
      const gaps: number[] = []
      for (let i = 1; i < taps.length; i++) gaps.push(taps[i] - taps[i - 1])
      gaps.sort((a, b) => a - b)
      const median = gaps[Math.floor(gaps.length / 2)]
      setBpm(Math.max(40, Math.min(240, Math.round(60000 / median))))
    }
  }, [setBpm])

  const onUndo = useCallback(() => {
    setTakes((prev) => {
      const next = undoLastTake(prev)
      if (next.length === prev.length)
        toast.info("Nichts zum Rückgängigmachen.")
      return next
    })
  }, [toast])

  const onClear = useCallback(() => {
    setTakes([])
    drumHitsRef.current = []
    thereminNotesRef.current = []
    trailRef.current = []
    setLoopCount(0)
    drawTrail()
  }, [drawTrail])

  const changeKey = useCallback((root: number, mode: "major" | "minor") => {
    setMusicKey({ root, mode, manual: true })
    setTakes((prev) => prev.filter((t) => t.generatedBy !== "muse"))
  }, [])

  const openInPianoRoll = useCallback(() => {
    if (takes.length === 0) {
      toast.info("Noch keine Takes – erst etwas aufnehmen.")
      return
    }
    schedulerRef.current?.stop()
    analyzerRef.current?.stop()
    engine.thereminOff()
    for (const take of takes) applyJamRoomTakeToSong(song, take)
    toast.success(`${takes.length} Takes in die Piano Roll übernommen.`)
    setPath("/track")
  }, [engine, setPath, song, takes, toast])

  // ---- render helpers ----
  const stepsPerLoop = 64
  const progress = loopStep / stepsPerLoop
  const R = 54
  const CIRC = 2 * Math.PI * R
  const bar = Math.floor(loopStep / 16) + 1
  const beat = Math.floor((loopStep % 16) / 4) + 1
  const activeStringIdx =
    thereminNote !== null
      ? Math.max(
          0,
          scaleNotes.findIndex((n) => Math.abs(n - thereminNote) < 0.5),
        )
      : -1

  return (
    <Stage>
      <CamVideo ref={videoRef} autoPlay muted playsInline />
      <Beams />
      <Vignette />
      {cameraError && <CamError>{cameraError}</CamError>}
      {handsStatus === "loading" && <CamError>Hand-Modell lädt…</CamError>}
      {handsStatus === "error" && (
        <CamError>{handsMsg ?? "Hand-Tracking nicht verfügbar."}</CamError>
      )}

      <TopBar>
        <div>
          <Brand>MUSE</Brand>
          <Title>
            JAM ROOM
            <LiveDot on={schedulerRef.current?.isRunning ?? loopStep > 0} />
          </Title>
        </div>
        <Readouts>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <KeySelect
              value={musicKey.root}
              onChange={(e) => changeKey(Number(e.target.value), musicKey.mode)}
              title="Grundton"
            >
              {NOTE_NAMES.map((n, i) => (
                <option key={n} value={i}>
                  {n}
                </option>
              ))}
            </KeySelect>
            <KeySelect
              value={musicKey.mode}
              onChange={(e) =>
                changeKey(musicKey.root, e.target.value as "major" | "minor")
              }
              title="Tongeschlecht"
            >
              <option value="major">dur</option>
              <option value="minor">moll</option>
            </KeySelect>
          </div>
          <ReadoutBox>
            <div className="value">{bpm}</div>
            <div className="label">BPM</div>
          </ReadoutBox>
          <SmallBtn accent="#38bdf8" onClick={onTapTempo}>
            Tap
          </SmallBtn>
        </Readouts>
      </TopBar>

      <MainArea>
        <ThereminField
          ref={thereminRef}
          onPointerDown={onThereminDown}
          onPointerMove={onThereminMove}
          onPointerUp={onThereminUp}
          onPointerCancel={onThereminUp}
        >
          {scaleNotes.slice(0, 12).map((note, i) => (
            <StringLine
              key={note}
              active={i === activeStringIdx % 12}
              style={{ top: `${8 + (i / 11) * 80}%` }}
            />
          ))}
          {thereminNote !== null && (
            <PitchTag
              y={
                88 -
                (scaleNotes.indexOf(Math.round(thereminNote)) /
                  (scaleNotes.length - 1)) *
                  80
              }
            >
              {noteName(Math.round(thereminNote))}
            </PitchTag>
          )}
          <FieldHint>Theremin · halten &amp; gleiten</FieldHint>
        </ThereminField>

        <CenterStage ref={stageRef} onPointerMove={trackPointer}>
          <VoiceCanvas ref={voiceCanvasRef} />

          <HandOverlay
            videoRef={videoRef}
            stageRef={stageRef}
            enabled={handsOn}
            swapped={handsSwapped}
            zoneIdAt={handZoneIdAt}
            onDrumStrike={onHandDrumStrike}
            onTheremin={onHandTheremin}
            onStatus={onHandStatus}
          />

          <RingWrap>
            <svg width="190" height="190" viewBox="0 0 120 120" role="img">
              <title>Loop-Fortschritt</title>
              <circle
                cx="60"
                cy="60"
                r={R}
                fill="none"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth="5"
              />
              <circle
                cx="60"
                cy="60"
                r={R}
                fill="none"
                stroke={isRecordingVoice ? "#ff4d3d" : "#f5a524"}
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={CIRC}
                strokeDashoffset={CIRC * (1 - progress)}
                transform="rotate(-90 60 60)"
                style={{ transition: "stroke-dashoffset 60ms linear" }}
              />
            </svg>
            <RingCenter>
              <div className="bar">
                {bar}.{beat}
              </div>
              <div className="sub">{takes.length} LAYER</div>
            </RingCenter>
          </RingWrap>

          {zones.map((z) => (
            <Zone
              key={z.id}
              color={z.color}
              hit={!!flash[z.id]}
              style={{
                left: `${z.xPct}%`,
                top: `${z.yPct}%`,
                transform: "translate(-50%, -50%)",
              }}
              onPointerDown={(e) => {
                e.stopPropagation()
                trackPointer(e)
                hitZone(z)
              }}
            >
              <ZoneGrip
                onPointerDown={(e) => {
                  e.stopPropagation()
                  setDragZone(z.id)
                }}
              />
              <ZoneLabel color={z.color}>{z.label}</ZoneLabel>
            </Zone>
          ))}

          <LayersShelf>
            {takes.slice(-6).map((t) => (
              <LayerPill key={t.id} color={ROLE_COLOR[t.role] ?? "#9db1c4"}>
                <LayerDot color={ROLE_COLOR[t.role] ?? "#9db1c4"} />
                <span style={{ fontWeight: 700, letterSpacing: "0.08em" }}>
                  {SOURCE_LABEL[t.source] ?? t.source}
                </span>
                <span style={{ color: "#7d93a8" }}>
                  {t.notes.length > 0
                    ? `${t.notes.length} Noten`
                    : `${t.drumHits.length} Hits`}
                </span>
                {t.generatedBy === "muse" && <MuseBadge>MUSE</MuseBadge>}
              </LayerPill>
            ))}
          </LayersShelf>
        </CenterStage>
      </MainArea>

      {takes.length === 0 && (
        <Hint>
          Arm eine Spur und leg los – MUSE steigt nach deinem ersten Loop mit
          ein.
        </Hint>
      )}

      <BottomBar>
        <RecButton
          recording={isRecordingVoice}
          onClick={
            isRecordingVoice
              ? stopVoiceRecording
              : () => void startVoiceRecording()
          }
        >
          {isRecordingVoice ? "STOP" : "REC\nVOX"}
        </RecButton>
        <ArmButton color="#ff8f3f" armed={drumsArmed} onClick={toggleDrums}>
          Drums
        </ArmButton>
        <ArmButton
          color="#ff2e88"
          armed={thereminArmed}
          onClick={() => setThereminArmed((a) => !a)}
        >
          Theremin
        </ArmButton>
        <SmallBtn onClick={addZone}>+ Zone</SmallBtn>
        <ArmButton
          color="#2dd4a7"
          armed={handsOn}
          onClick={() => {
            const next = !handsOn
            setHandsOn(next)
            if (!next) {
              setHandsStatus("off")
              setHandsMsg(null)
            }
          }}
        >
          Hände
        </ArmButton>
        {handsOn && (
          <SmallBtn onClick={() => setHandsSwapped((s) => !s)}>
            {handsSwapped ? "Hände: getauscht" : "Hände: normal"}
          </SmallBtn>
        )}
        <GhostButton onClick={onUndo} disabled={takes.length === 0}>
          Undo
        </GhostButton>
        <GhostButton onClick={onClear} disabled={takes.length === 0}>
          Clear
        </GhostButton>
        <ExportButton onClick={openInPianoRoll}>
          Piano Roll öffnen →
        </ExportButton>
      </BottomBar>
    </Stage>
  )
}
