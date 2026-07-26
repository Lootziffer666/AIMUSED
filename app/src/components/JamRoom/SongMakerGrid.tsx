import styled from "@emotion/styled"
import { getTempo, type TrackId } from "@signal-app/core"
import { useToast } from "dialog-hooks"
import {
  type FC,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { DEFAULT_TEMPO } from "../../Constants"
import type { MusePerformanceTake } from "../../entities/performance/MusePerformanceTake"
import { useRouter } from "../../hooks/useRouter"
import { useStores } from "../../hooks/useStores"
import { applyJamRoomTakeToSong } from "../../services/jamRoom/jamRoomSongAdapter"
import {
  buildSongMakerEvents,
  createEmptySongMakerPattern,
  hasSongMakerContent,
  SONG_MAKER_STEPS,
  songMakerStepEvents,
  toggleSongMakerCell,
  type SongMakerPattern,
} from "../../services/jamRoom/songMaker"
import { Button, PrimaryButton } from "../ui/Button"

const Container = styled.div`
  display: grid;
  flex: 1;
  min-height: 0;
  grid-template-rows: auto 1fr auto;
  overflow: hidden;
  color: white;
  background:
    radial-gradient(circle at 20% 20%, rgba(255, 0, 128, 0.16), transparent 36%),
    radial-gradient(circle at 80% 75%, rgba(0, 170, 255, 0.15), transparent 38%),
    #08090d;
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
    color: rgba(255, 255, 255, 0.66);
    font-size: 0.78rem;
  }
`

const Workspace = styled.div`
  min-height: 0;
  padding: 0 clamp(0.65rem, 3vw, 2rem);
  overflow: auto;
`

const Panel = styled.div`
  width: min(72rem, 100%);
  min-width: 46rem;
  margin: 0 auto;
  padding: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 0.8rem;
  background: rgba(0, 0, 0, 0.56);
  box-shadow: 0 20px 70px rgba(0, 0, 0, 0.45);
`

const Steps = styled.div`
  display: grid;
  grid-template-columns: 5rem repeat(16, minmax(1.8rem, 1fr));
  gap: 0.2rem;
  margin-bottom: 0.35rem;
`

const Step = styled.div<{ active: boolean }>`
  height: 0.28rem;
  border-radius: 99px;
  background: ${({ active }) =>
    active ? "rgba(82, 255, 188, 0.95)" : "rgba(255, 255, 255, 0.1)"};
  box-shadow: ${({ active }) =>
    active ? "0 0 12px rgba(82, 255, 188, 0.65)" : "none"};
`

const SectionTitle = styled.h2`
  margin: 0.8rem 0 0.45rem;
  color: rgba(255, 255, 255, 0.75);
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`

const GridRow = styled.div`
  display: grid;
  grid-template-columns: 5rem repeat(16, minmax(1.8rem, 1fr));
  gap: 0.2rem;
  margin-bottom: 0.2rem;
`

const RowLabel = styled.div`
  display: flex;
  align-items: center;
  padding-right: 0.5rem;
  color: rgba(255, 255, 255, 0.62);
  font-size: 0.68rem;
`

const Cell = styled.button<{
  active: boolean
  playing: boolean
  accent: string
}>`
  min-height: 1.65rem;
  border: 1px solid
    ${({ playing }) =>
      playing ? "rgba(255, 255, 255, 0.95)" : "rgba(255, 255, 255, 0.09)"};
  border-radius: 0.22rem;
  background: ${({ active, accent }) =>
    active ? accent : "rgba(255, 255, 255, 0.045)"};
  box-shadow: ${({ playing }) =>
    playing ? "0 0 12px rgba(255, 255, 255, 0.35)" : "none"};
  cursor: pointer;
  transition: 70ms linear;
  -webkit-tap-highlight-color: transparent;

  &:hover {
    filter: brightness(1.25);
  }
`

const Footer = styled.footer`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.65rem;
  padding: 1rem clamp(1rem, 4vw, 2rem);
`

const Status = styled.div`
  padding: 0.45rem 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.68);
  background: rgba(0, 0, 0, 0.42);
  font-size: 0.72rem;
`

const MELODY_ACCENTS = [
  "#ff4c9d",
  "#ff527f",
  "#ff5d66",
  "#ff704f",
  "#ff873c",
  "#f89d32",
  "#eeb32f",
  "#d5c932",
  "#b6db3c",
  "#91e653",
  "#66e878",
  "#44df9f",
  "#35ccbd",
  "#3ab4d2",
]

const DRUM_LABELS = ["Kick", "Snare", "Hi-Hat", "Clap", "Tom"]
const DRUM_MIDI_NOTES: Record<string, number> = {
  kick: 36,
  snare: 38,
  hihat: 42,
  clap: 39,
  tom: 45,
}

export const SongMakerGrid: FC = () => {
  const { songStore, player, synthGroup } = useStores()
  const { setPath } = useRouter()
  const toast = useToast()
  const [pattern, setPattern] = useState<SongMakerPattern>(
    createEmptySongMakerPattern,
  )
  const patternRef = useRef(pattern)
  const [isPlaying, setIsPlaying] = useState(false)
  const isPlayingRef = useRef(false)
  const [currentStep, setCurrentStep] = useState(-1)
  const stepRef = useRef(0)
  const timerRef = useRef<number | null>(null)
  const [exportedTrackIds, setExportedTrackIds] = useState<TrackId[]>([])

  const song = songStore.song

  const currentBpm = useCallback(() => {
    const conductor = song.conductorTrack
    return conductor ? (getTempo(conductor.events, 0) ?? DEFAULT_TEMPO) : DEFAULT_TEMPO
  }, [song])

  const updatePattern = useCallback(
    (lane: "melody" | "drums", row: number, step: number) => {
      setPattern((previous) => {
        const next = toggleSongMakerCell(previous, lane, row, step)
        patternRef.current = next
        return next
      })
    },
    [],
  )

  const sendNote = useCallback(
    (channel: number, noteNumber: number, velocity: number, duration: number) => {
      synthGroup.activate()
      player.sendEvent({
        type: "channel",
        subtype: "noteOn",
        channel,
        noteNumber,
        velocity,
      })
      player.sendEvent(
        {
          type: "channel",
          subtype: "noteOff",
          channel,
          noteNumber,
          velocity: 0,
        },
        duration,
      )
    },
    [player, synthGroup],
  )

  const previewStep = useCallback(
    (step: number) => {
      const events = buildSongMakerEvents(patternRef.current, song.timebase)
      const current = songMakerStepEvents(events, step, song.timebase)
      const noteDurationSeconds = Math.max(0.05, (60 / currentBpm() / 4) * 0.82)

      for (const note of current.melodyNotes) {
        sendNote(0, note.noteNumber, note.velocity, noteDurationSeconds)
      }
      for (const hit of current.drumHits) {
        sendNote(
          9,
          DRUM_MIDI_NOTES[hit.zoneId] ?? 38,
          hit.velocity,
          Math.min(0.12, noteDurationSeconds),
        )
      }
    },
    [currentBpm, sendNote, song.timebase],
  )

  const stopPlayback = useCallback(() => {
    isPlayingRef.current = false
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    player.allSoundsOffChannel(0)
    player.allSoundsOffChannel(9)
    setIsPlaying(false)
    setCurrentStep(-1)
    stepRef.current = 0
  }, [player])

  const startPlayback = useCallback(() => {
    if (isPlayingRef.current) {
      stopPlayback()
      return
    }
    if (!hasSongMakerContent(patternRef.current)) {
      toast.error("Setze zuerst einige Töne oder Drum-Hits.")
      return
    }

    isPlayingRef.current = true
    setIsPlaying(true)
    stepRef.current = 0

    const runStep = () => {
      if (!isPlayingRef.current) return
      const step = stepRef.current
      setCurrentStep(step)
      previewStep(step)
      stepRef.current = (step + 1) % SONG_MAKER_STEPS
      timerRef.current = window.setTimeout(
        runStep,
        Math.max(30, 60_000 / currentBpm() / 4),
      )
    }

    runStep()
  }, [currentBpm, previewStep, stopPlayback, toast])

  const removeExportedTracks = useCallback(() => {
    for (const trackId of exportedTrackIds) {
      song.removeTrack(trackId)
    }
    setExportedTrackIds([])
  }, [exportedTrackIds, song])

  const exportToSong = useCallback(() => {
    const events = buildSongMakerEvents(patternRef.current, song.timebase)
    if (events.melodyNotes.length === 0 && events.drumHits.length === 0) {
      toast.error("Das Grid ist leer.")
      return
    }

    for (const trackId of exportedTrackIds) {
      song.removeTrack(trackId)
    }

    const nextTrackIds: TrackId[] = []
    if (events.melodyNotes.length > 0) {
      const melodyTake: MusePerformanceTake = {
        id: crypto.randomUUID(),
        source: "gesture-instrument",
        notes: events.melodyNotes,
        drumHits: [],
        controls: [],
        confidence: 1,
        role: "melody",
        loopStartTick: 0,
        loopLengthTicks: events.loopLengthTicks,
        createdAt: new Date().toISOString(),
      }
      nextTrackIds.push(applyJamRoomTakeToSong(song, melodyTake).id)
    }

    if (events.drumHits.length > 0) {
      const drumTake: MusePerformanceTake = {
        id: crypto.randomUUID(),
        source: "painted-drums",
        notes: [],
        drumHits: events.drumHits,
        controls: [],
        confidence: 1,
        role: "percussion",
        loopStartTick: 0,
        loopLengthTicks: events.loopLengthTicks,
        createdAt: new Date().toISOString(),
      }
      nextTrackIds.push(applyJamRoomTakeToSong(song, drumTake).id)
    }

    setExportedTrackIds(nextTrackIds)
    toast.success(
      `${events.melodyNotes.length} Töne und ${events.drumHits.length} Drum-Hits in MUSE übernommen.`,
    )
  }, [exportedTrackIds, song, toast])

  const clearGrid = useCallback(() => {
    stopPlayback()
    const empty = createEmptySongMakerPattern()
    patternRef.current = empty
    setPattern(empty)
  }, [stopPlayback])

  useEffect(() => {
    setExportedTrackIds([])
    stopPlayback()
  }, [song, stopPlayback])

  useEffect(
    () => () => {
      stopPlayback()
    },
    [stopPlayback],
  )

  return (
    <Container>
      <Header>
        <div>
          <h1>MUSE SONG MAKER</h1>
          <p>
            Male eine Melodie und einen Rhythmus. Preview bleibt flüchtig; erst
            Add to Song schreibt editierbare MUSE-Tracks.
          </p>
        </div>
        <Status>
          {Math.round(currentBpm())} BPM · {exportedTrackIds.length} Song-Tracks
        </Status>
      </Header>

      <Workspace>
        <Panel>
          <Steps>
            <div />
            {Array.from({ length: SONG_MAKER_STEPS }, (_, step) => (
              <Step key={step} active={currentStep === step} />
            ))}
          </Steps>

          <SectionTitle>Melody</SectionTitle>
          {pattern.melody.map((row, rowIndex) => (
            <GridRow key={`melody-${rowIndex}`}>
              <RowLabel>{73 - rowIndex}</RowLabel>
              {row.map((active, step) => (
                <Cell
                  key={`melody-${rowIndex}-${step}`}
                  type="button"
                  active={active}
                  playing={currentStep === step}
                  accent={MELODY_ACCENTS[rowIndex] ?? "#ff4c9d"}
                  aria-label={`Melody row ${rowIndex + 1}, step ${step + 1}`}
                  aria-pressed={active}
                  onClick={() => updatePattern("melody", rowIndex, step)}
                />
              ))}
            </GridRow>
          ))}

          <SectionTitle>Drums</SectionTitle>
          {pattern.drums.map((row, rowIndex) => (
            <GridRow key={`drums-${rowIndex}`}>
              <RowLabel>{DRUM_LABELS[rowIndex]}</RowLabel>
              {row.map((active, step) => (
                <Cell
                  key={`drums-${rowIndex}-${step}`}
                  type="button"
                  active={active}
                  playing={currentStep === step}
                  accent="#21a8ff"
                  aria-label={`${DRUM_LABELS[rowIndex]} step ${step + 1}`}
                  aria-pressed={active}
                  onClick={() => updatePattern("drums", rowIndex, step)}
                />
              ))}
            </GridRow>
          ))}
        </Panel>
      </Workspace>

      <Footer>
        <PrimaryButton onClick={startPlayback}>
          {isPlaying ? "Stop Preview" : "Play Preview"}
        </PrimaryButton>
        <Button onClick={clearGrid}>Clear Grid</Button>
        <Button onClick={exportToSong}>
          {exportedTrackIds.length > 0 ? "Update Song" : "Add to Song"}
        </Button>
        <Button
          onClick={removeExportedTracks}
          disabled={exportedTrackIds.length === 0}
        >
          Remove from Song
        </Button>
        <Button onClick={() => setPath("/jam")}>Back to Jam Room</Button>
        <Button onClick={() => setPath("/track")}>Edit in Piano Roll</Button>
      </Footer>
    </Container>
  )
}
