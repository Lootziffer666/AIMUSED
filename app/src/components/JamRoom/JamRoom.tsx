import styled from "@emotion/styled"
import { getTempo, type TrackId } from "@signal-app/core"
import {
  approveHummingDraft,
  importHumming,
  type MuseMicrophoneRecording,
} from "@signal-app/orchestration-core"
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
} from "../../entities/performance/MusePerformanceTake"
import { useRouter } from "../../hooks/useRouter"
import { useStores } from "../../hooks/useStores"
import {
  applyHummingResultToSong,
  buildHummingTrackNotes,
} from "../../services/humming/hummingSongAdapter"
import { applyJamRoomTakeToSong } from "../../services/jamRoom/jamRoomSongAdapter"
import {
  calculateVelocityFromSpeed,
  handleCameraError,
  handleMicrophoneError,
  millisecondsToLoopTick,
  snapToScale,
} from "../../services/jamRoom/jamRoomUtils"
import { Button, PrimaryButton } from "../ui/Button"

const Container = styled.div`
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  color: white;
  background:
    radial-gradient(circle at 20% 40%, rgba(255, 0, 128, 0.2), transparent 35%),
    radial-gradient(circle at 75% 65%, rgba(0, 170, 255, 0.18), transparent 35%),
    #08090d;
`

const Camera = styled.video`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.28;
  transform: scaleX(-1);
`

const Shade = styled.div`
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.68),
    transparent 24%,
    transparent 72%,
    rgba(0, 0, 0, 0.78)
  );
`

const Interface = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-rows: auto 1fr auto;
  width: 100%;
  min-height: 0;
`

const TopBar = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem clamp(1rem, 4vw, 2rem);
`

const Title = styled.div`
  h1 {
    margin: 0;
    font-size: clamp(1rem, 3vw, 1.5rem);
    letter-spacing: 0.08em;
  }

  p {
    margin: 0.25rem 0 0;
    color: rgba(255, 255, 255, 0.65);
    font-size: 0.78rem;
  }
`

const Stage = styled.main`
  display: grid;
  grid-template-columns: minmax(8rem, 0.8fr) minmax(14rem, 2fr);
  min-height: 0;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(8rem, 0.6fr) minmax(15rem, 1.4fr);
  }
`

const Theremin = styled.div<{ active: boolean }>`
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1rem;
  padding: 1rem;
  overflow: hidden;
  touch-action: none;
  border-right: 1px solid rgba(255, 255, 255, 0.16);
  background: linear-gradient(90deg, rgba(255, 0, 128, 0.14), transparent);
  cursor: crosshair;

  &::after {
    position: absolute;
    inset: 0;
    content: "";
    opacity: ${({ active }) => (active ? 1 : 0)};
    background: radial-gradient(circle at center, rgba(255, 0, 128, 0.22), transparent 55%);
    transition: opacity 80ms linear;
  }
`

const String = styled.div<{ active: boolean }>`
  z-index: 1;
  height: 3px;
  border-radius: 99px;
  background: ${({ active }) =>
    active ? "#ff4ca0" : "rgba(255, 255, 255, 0.25)"};
  box-shadow: ${({ active }) =>
    active ? "0 0 18px rgba(255, 76, 160, 0.9)" : "none"};
  transform: ${({ active }) => (active ? "scaleX(1.04)" : "scaleX(1)")};
  transition: 80ms linear;
`

const ThereminLabel = styled.div`
  z-index: 1;
  font-size: 0.78rem;
  color: rgba(255, 255, 255, 0.72);
`

const DrumStage = styled.div`
  position: relative;
  min-height: 0;
  touch-action: manipulation;
`

const Drum = styled.button<{ accent: string; hit: boolean }>`
  position: absolute;
  width: clamp(5.5rem, 18vw, 9rem);
  aspect-ratio: 1;
  border: 3px dashed ${({ accent }) => accent};
  border-radius: 50%;
  color: white;
  background: ${({ accent, hit }) =>
    hit ? `${accent}55` : "rgba(0, 0, 0, 0.24)"};
  box-shadow: ${({ accent, hit }) =>
    hit ? `0 0 30px ${accent}` : "0 8px 30px rgba(0, 0, 0, 0.3)"};
  transform: translate(-50%, -50%) ${({ hit }) => (hit ? "scale(1.08)" : "")};
  transition: 80ms linear;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
`

const LoopCore = styled.div<{ recording: boolean }>`
  position: absolute;
  top: 34%;
  left: 50%;
  display: grid;
  width: clamp(7rem, 20vw, 11rem);
  aspect-ratio: 1;
  place-items: center;
  border: 3px solid
    ${({ recording }) =>
      recording ? "rgba(255, 70, 90, 0.9)" : "rgba(255, 255, 255, 0.23)"};
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.48);
  box-shadow: ${({ recording }) =>
    recording ? "0 0 40px rgba(255, 45, 70, 0.55)" : "none"};
  transform: translate(-50%, -50%);
  text-align: center;

  strong {
    display: block;
    font-size: 1.4rem;
  }

  span {
    color: rgba(255, 255, 255, 0.66);
    font-size: 0.72rem;
  }
`

const Footer = styled.footer`
  display: grid;
  gap: 0.8rem;
  padding: 0.8rem clamp(1rem, 4vw, 2rem) 1rem;
`

const Layers = styled.div`
  display: flex;
  min-height: 2rem;
  gap: 0.5rem;
  overflow-x: auto;
`

const LayerPill = styled.div`
  flex: 0 0 auto;
  padding: 0.35rem 0.7rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 99px;
  background: rgba(0, 0, 0, 0.42);
  font-size: 0.72rem;
`

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.6rem;
`

const Notice = styled.div`
  position: absolute;
  z-index: 2;
  top: 4.5rem;
  right: 1rem;
  max-width: 22rem;
  padding: 0.65rem 0.8rem;
  border: 1px solid rgba(255, 180, 70, 0.45);
  border-radius: 0.35rem;
  color: #ffd08a;
  background: rgba(20, 12, 2, 0.84);
  font-size: 0.75rem;
`

interface JamLayer {
  take: MusePerformanceTake
  trackId: TrackId
  label: string
}

interface GestureStart {
  startedAt: number
  noteNumber: number
  velocity: number
}

const DRUMS = [
  { id: "kick", label: "KICK", accent: "#ff285f", left: "20%", top: "72%" },
  { id: "snare", label: "SNARE", accent: "#18a8ff", left: "50%", top: "72%" },
  { id: "hihat", label: "HI-HAT", accent: "#ffb21c", left: "80%", top: "72%" },
] as const

const C_MAJOR = [0, 2, 4, 5, 7, 9, 11]

export const JamRoom: FC = () => {
  const { songStore } = useStores()
  const { setPath } = useRouter()
  const toast = useToast()
  const cameraRef = useRef<HTMLVideoElement>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const microphoneStreamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingStartedAtRef = useRef(0)
  const pendingDrumsRef = useRef<MusePerformanceDrumHit[]>([])
  const pendingGestureNotesRef = useRef<MusePerformanceNote[]>([])
  const gestureStartRef = useRef<GestureStart | null>(null)

  const [layers, setLayers] = useState<JamLayer[]>([])
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessingVoice, setIsProcessingVoice] = useState(false)
  const [cameraNotice, setCameraNotice] = useState<string | null>(null)
  const [activeTheremin, setActiveTheremin] = useState(false)
  const [hitZones, setHitZones] = useState<Record<string, boolean>>({})

  const song = songStore.song
  const loopLength = song.timebase * 16

  const currentBpm = useCallback(() => {
    const conductor = song.conductorTrack
    return conductor ? (getTempo(conductor.events, 0) ?? DEFAULT_TEMPO) : DEFAULT_TEMPO
  }, [song])

  useEffect(() => {
    setLayers([])
  }, [song])

  useEffect(() => {
    let cancelled = false
    const setupCamera = async () => {
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
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        cameraStreamRef.current = stream
        if (cameraRef.current) cameraRef.current.srcObject = stream
      } catch (error) {
        setCameraNotice(handleCameraError(error))
      }
    }
    void setupCamera()

    return () => {
      cancelled = true
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop())
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const addTake = useCallback(
    (take: MusePerformanceTake, label: string) => {
      const track = applyJamRoomTakeToSong(song, take)
      setLayers((previous) => [...previous, { take, trackId: track.id, label }])
      return track
    },
    [song],
  )

  const createBassAccompaniment = useCallback(
    (melodyNotes: MusePerformanceNote[]) => {
      if (layers.some((layer) => layer.take.source === "accompaniment")) return
      const firstPitch = melodyNotes[0]?.noteNumber ?? 60
      const bassPitch = 36 + (firstPitch % 12)
      const notes = Array.from({ length: 4 }, (_, bar) => ({
        tick: bar * song.timebase * 4,
        duration: song.timebase * 4,
        noteNumber: bassPitch,
        velocity: 58,
      }))
      addTake(
        {
          id: crypto.randomUUID(),
          source: "accompaniment",
          notes,
          drumHits: [],
          controls: [],
          confidence: 1,
          role: "bass",
          loopStartTick: 0,
          loopLengthTicks: loopLength,
          createdAt: new Date().toISOString(),
        },
        "MUSE bass",
      )
    },
    [addTake, layers, loopLength, song.timebase],
  )

  const processVoice = useCallback(
    async (blob: Blob) => {
      setIsProcessingVoice(true)
      const audioContext = new AudioContext()
      try {
        const buffer = await audioContext.decodeAudioData(await blob.arrayBuffer())
        const recording: MuseMicrophoneRecording = {
          id: crypto.randomUUID(),
          sampleRate: buffer.sampleRate,
          channelData: buffer.getChannelData(0),
          recordedAt: new Date().toISOString(),
        }
        const bpm = currentBpm()
        const imported = importHumming(
          recording,
          { strength: 0.35, gridSubdivision: 8 },
          bpm,
        )
        if (imported.detectedNotes.length === 0) {
          toast.error(
            "Keine belastbare Melodie erkannt. Drums und Gesten wurden trotzdem übernommen.",
          )
          return
        }
        const approved = approveHummingDraft(imported)
        const track = applyHummingResultToSong(song, approved, "melody", bpm)
        const notes = buildHummingTrackNotes(approved, bpm, song.timebase)
        const take: MusePerformanceTake = {
          id: crypto.randomUUID(),
          source: "voice",
          notes,
          drumHits: [],
          controls: [],
          confidence:
            approved.detectedNotes.reduce(
              (sum, note) => sum + note.confidence,
              0,
            ) / approved.detectedNotes.length,
          role: "melody",
          loopStartTick: 0,
          loopLengthTicks: loopLength,
          createdAt: new Date().toISOString(),
        }
        setLayers((previous) => [
          ...previous,
          { take, trackId: track.id, label: "Voice melody" },
        ])
        createBassAccompaniment(notes)
        toast.success("Stimme als Melodiespur übernommen.")
      } catch (error) {
        console.error(error)
        toast.error("Die Sprachaufnahme konnte nicht ausgewertet werden.")
      } finally {
        void audioContext.close()
        setIsProcessingVoice(false)
      }
    },
    [createBassAccompaniment, currentBpm, loopLength, song, toast],
  )

  const stopRecording = useCallback(() => {
    if (!isRecording) return
    setIsRecording(false)

    const gestureNotes = pendingGestureNotesRef.current
    const drumHits = pendingDrumsRef.current
    pendingGestureNotesRef.current = []
    pendingDrumsRef.current = []
    gestureStartRef.current = null
    setActiveTheremin(false)

    if (drumHits.length > 0) {
      addTake(
        {
          id: crypto.randomUUID(),
          source: "painted-drums",
          notes: [],
          drumHits,
          controls: [],
          confidence: 1,
          role: "percussion",
          loopStartTick: 0,
          loopLengthTicks: loopLength,
          createdAt: new Date().toISOString(),
        },
        "Painted drums",
      )
    }

    if (gestureNotes.length > 0) {
      addTake(
        {
          id: crypto.randomUUID(),
          source: "gesture-instrument",
          notes: gestureNotes,
          drumHits: [],
          controls: [],
          confidence: 0.85,
          role: "guitar",
          loopStartTick: 0,
          loopLengthTicks: loopLength,
          createdAt: new Date().toISOString(),
        },
        "Theremin guitar",
      )
    }

    const recorder = recorderRef.current
    if (recorder?.state === "recording") recorder.stop()
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop())
    microphoneStreamRef.current = null
  }, [addTake, isRecording, loopLength])

  const startRecording = useCallback(async () => {
    if (isRecording) {
      stopRecording()
      return
    }

    pendingDrumsRef.current = []
    pendingGestureNotesRef.current = []
    audioChunksRef.current = []
    recordingStartedAtRef.current = performance.now()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      })
      microphoneStreamRef.current = stream
      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        })
        if (blob.size > 0) void processVoice(blob)
      }
      recorderRef.current = recorder
      recorder.start()
    } catch (error) {
      toast.error(handleMicrophoneError(error))
      recorderRef.current = null
    }

    setIsRecording(true)
  }, [isRecording, processVoice, stopRecording, toast])

  const currentTick = useCallback(
    () =>
      millisecondsToLoopTick(
        performance.now() - recordingStartedAtRef.current,
        currentBpm(),
        song.timebase,
        loopLength,
      ),
    [currentBpm, loopLength, song.timebase],
  )

  const hitDrum = useCallback(
    (zoneId: string) => {
      if (!isRecording) {
        toast.error("Starte zuerst den Jam-Loop.")
        return
      }
      setHitZones((previous) => ({ ...previous, [zoneId]: true }))
      window.setTimeout(
        () => setHitZones((previous) => ({ ...previous, [zoneId]: false })),
        100,
      )
      pendingDrumsRef.current.push({
        tick: currentTick(),
        zoneId,
        velocity: 100,
        confidence: 1,
      })
    },
    [currentTick, isRecording, toast],
  )

  const pointerNote = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect()
      const vertical = 1 - (event.clientY - bounds.top) / bounds.height
      const horizontal = (event.clientX - bounds.left) / bounds.width
      const rawNote = 48 + vertical * 36
      return {
        noteNumber: snapToScale(rawNote, 0, C_MAJOR),
        velocity: calculateVelocityFromSpeed(4 + horizontal * 18),
      }
    },
    [],
  )

  const beginTheremin = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isRecording) {
        toast.error("Starte zuerst den Jam-Loop.")
        return
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      setActiveTheremin(true)
      const { noteNumber, velocity } = pointerNote(event)
      gestureStartRef.current = {
        startedAt: performance.now(),
        noteNumber,
        velocity,
      }
    },
    [isRecording, pointerNote, toast],
  )

  const endTheremin = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = gestureStartRef.current
      if (!start) return
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      const startTick = millisecondsToLoopTick(
        start.startedAt - recordingStartedAtRef.current,
        currentBpm(),
        song.timebase,
        loopLength,
      )
      const duration = Math.max(
        Math.round(song.timebase / 4),
        millisecondsToLoopTick(
          performance.now() - start.startedAt,
          currentBpm(),
          song.timebase,
          loopLength,
        ),
      )
      pendingGestureNotesRef.current.push({
        tick: startTick,
        duration,
        noteNumber: start.noteNumber,
        velocity: start.velocity,
      })
      gestureStartRef.current = null
      setActiveTheremin(false)
    },
    [currentBpm, loopLength, song.timebase],
  )

  const undo = useCallback(() => {
    setLayers((previous) => {
      const last = previous.at(-1)
      if (!last) return previous
      song.removeTrack(last.trackId)
      return previous.slice(0, -1)
    })
  }, [song])

  const clear = useCallback(() => {
    for (const layer of layers) song.removeTrack(layer.trackId)
    setLayers([])
  }, [layers, song])

  const layerSummary = useMemo(
    () => layers.map((layer) => layer.label),
    [layers],
  )

  return (
    <Container>
      <Camera ref={cameraRef} autoPlay muted playsInline />
      <Shade />
      {cameraNotice && <Notice>{cameraNotice}</Notice>}
      <Interface>
        <TopBar>
          <Title>
            <h1>MUSE JAM ROOM</h1>
            <p>Handy/Webcam · Stimme · Schlagflächen · Theremin</p>
          </Title>
          <div>{Math.round(currentBpm())} BPM</div>
        </TopBar>

        <Stage>
          <Theremin
            active={activeTheremin}
            onPointerDown={beginTheremin}
            onPointerUp={endTheremin}
            onPointerCancel={endTheremin}
          >
            <ThereminLabel>
              Ziehen und halten: tonartgebundene Theremin-Gitarre
            </ThereminLabel>
            {Array.from({ length: 7 }, (_, index) => (
              <String key={index} active={activeTheremin && index % 2 === 0} />
            ))}
          </Theremin>

          <DrumStage>
            <LoopCore recording={isRecording}>
              <div>
                <strong>{layers.length}</strong>
                <span>
                  {isRecording
                    ? "JAM LÄUFT"
                    : isProcessingVoice
                      ? "STIMME WIRD GEHÖRT"
                      : "LAYERS"}
                </span>
              </div>
            </LoopCore>
            {DRUMS.map((drum) => (
              <Drum
                key={drum.id}
                accent={drum.accent}
                hit={Boolean(hitZones[drum.id])}
                style={{ left: drum.left, top: drum.top }}
                onPointerDown={() => hitDrum(drum.id)}
              >
                {drum.label}
              </Drum>
            ))}
          </DrumStage>
        </Stage>

        <Footer>
          <Layers>
            {layerSummary.map((label, index) => (
              <LayerPill key={`${label}-${index}`}>{label}</LayerPill>
            ))}
          </Layers>
          <Actions>
            <PrimaryButton onClick={() => void startRecording()}>
              {isRecording ? "Stop & build loop" : "Record Jam"}
            </PrimaryButton>
            <Button onClick={undo} disabled={layers.length === 0}>
              Undo layer
            </Button>
            <Button onClick={clear} disabled={layers.length === 0}>
              Clear Jam
            </Button>
            <Button onClick={() => setPath("/track")}>Edit in Piano Roll</Button>
          </Actions>
        </Footer>
      </Interface>
    </Container>
  )
}
