import { keyframes } from "@emotion/react"
import styled from "@emotion/styled"
import { getTempo } from "@signal-app/core"
import {
  approveHummingDraft,
  correctHummingDraft,
  importHumming,
  type MuseHummingCorrection,
  type MuseHummingImportResult,
  type MuseHummingTargetRole,
  type MuseMicrophoneRecording,
} from "@signal-app/orchestration-core"
import { useToast } from "dialog-hooks"
import { FC, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { DEFAULT_TEMPO } from "../../Constants"
import { useRootView } from "../../hooks/useRootView"
import { useStores } from "../../hooks/useStores"
import { noteNameWithOctString } from "../../helpers/noteNumberString"
import { Localized, useLocalization } from "../../localize/useLocalization"
import { applyHummingResultToSong } from "../../services/humming/hummingSongAdapter"
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "../Dialog/Dialog"
import { Button, PrimaryButton } from "../ui/Button"
import { Slider } from "../ui/Slider"
import { TextField } from "../ui/TextField"

/**
 * Microphone-to-song UI for `@signal-app/orchestration-core`'s humming
 * pipeline (pitch/onset detection, ported from MUSE — see
 * docs/MERGE_PLAN.md §8a). Follows `OrchestrationDialog.tsx`'s conventions
 * exactly: same Dialog primitives, same `useRootView` atom-gated open state,
 * same toast-based error reporting.
 *
 * The recording flow (`getUserMedia` -> `MediaRecorder` -> stop -> decode)
 * is a plain "record then process" flow, not a real-time pipeline, so no
 * AudioWorklet is used, matching the task's explicit instruction.
 */

const GRID_OPTIONS = [1, 2, 4, 8, 16, 32]
const DEFAULT_GRID_INDEX = 3 // GRID_OPTIONS[3] === 8 (eighth-note grid)
const DEFAULT_STRENGTH = 0.5

type Stage = "idle" | "recording" | "processing" | "review"

const Content = styled.div`
  min-width: 34rem;
  max-width: 42rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
`

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`

const SectionHeading = styled.h3`
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
`

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
`

const SliderRow = styled(Row)`
  justify-content: space-between;
`

const SliderLabel = styled.div`
  min-width: 6rem;
  font-size: 0.8rem;
`

const SliderValue = styled.div`
  min-width: 3rem;
  text-align: right;
  font-size: 0.8rem;
  color: var(--color-text-secondary);
`

const RoleGrid = styled.div`
  display: flex;
  gap: 0.5rem;
`

const RoleButton = styled.button<{ selected: boolean }>`
  border: 1px solid
    ${({ selected }) => (selected ? "var(--color-theme)" : "var(--color-divider)")};
  background: ${({ selected }) =>
    selected ? "var(--color-highlight)" : "var(--color-background-secondary)"};
  border-radius: 0.3rem;
  padding: 0.4rem 0.8rem;
  cursor: pointer;
  color: var(--color-text);
  font-size: 0.8rem;

  &:hover {
    background: var(--color-highlight);
  }
`

const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
`

const RecordingDot = styled.span`
  display: inline-block;
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  background: var(--color-red);
  animation: ${pulse} 1.1s ease-in-out infinite;
`

const List = styled.div`
  display: flex;
  flex-direction: column;
  max-height: 16rem;
  overflow-y: auto;
  background: var(--color-background-secondary);
  border-radius: 0.3rem;
`

const ListItem = styled.div<{ discarded: boolean }>`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  border-bottom: 1px solid var(--color-divider);
  font-size: 0.8rem;
  opacity: ${({ discarded }) => (discarded ? 0.4 : 1)};

  &:last-child {
    border-bottom: none;
  }
`

const NoteField = styled(TextField)`
  height: 1.8rem;
  padding: 0 0.4rem;
  font-size: 0.75rem;
  width: 4.5rem;
`

const NoteLabel = styled.div`
  min-width: 5rem;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
`

const Empty = styled.div`
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  padding: 0.5rem 0;
`

const ROLES: MuseHummingTargetRole[] = ["melody", "bass", "percussion"]

const roleLabelKey = (role: MuseHummingTargetRole) =>
  `humming-target-role-${role}` as const

export const HummingDialog: FC = () => {
  const { openHummingDialog: open, setOpenHummingDialog } = useRootView()
  const { songStore } = useStores()
  const localized = useLocalization()
  const toast = useToast()

  const [stage, setStage] = useState<Stage>("idle")
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [strength, setStrength] = useState(DEFAULT_STRENGTH)
  const [gridIndex, setGridIndex] = useState(DEFAULT_GRID_INDEX)
  const [targetRole, setTargetRole] = useState<MuseHummingTargetRole>("melody")
  const [result, setResult] = useState<MuseHummingImportResult | null>(null)
  const [corrections, setCorrections] = useState<
    Record<number, MuseHummingCorrection>
  >({})

  const mediaStreamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recordingStartRef = useRef<number>(0)
  const importBpmRef = useRef<number>(DEFAULT_TEMPO)

  const gridSubdivision = GRID_OPTIONS[gridIndex]

  const stopStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
  }, [])

  const reset = useCallback(() => {
    stopStream()
    mediaRecorderRef.current = null
    chunksRef.current = []
    setStage("idle")
    setElapsedSeconds(0)
    setResult(null)
    setCorrections({})
  }, [stopStream])

  const onClose = useCallback(() => {
    reset()
    setOpenHummingDialog(false)
  }, [reset, setOpenHummingDialog])

  // Release the microphone if the dialog is closed mid-recording.
  useEffect(() => {
    if (!open) {
      stopStream()
    }
  }, [open, stopStream])

  useEffect(() => {
    if (stage !== "recording") {
      return
    }
    const interval = setInterval(() => {
      setElapsedSeconds((Date.now() - recordingStartRef.current) / 1000)
    }, 250)
    return () => clearInterval(interval)
  }, [stage])

  const currentBpm = useCallback((): number => {
    const conductorTrack = songStore.song.tracks.find((t) => t.isConductorTrack)
    const tempo = conductorTrack
      ? getTempo(conductorTrack.events, 0)
      : undefined
    return tempo ?? DEFAULT_TEMPO
  }, [songStore])

  const processRecording = useCallback(
    async (blob: Blob) => {
      const bpm = currentBpm()
      const arrayBuffer = await blob.arrayBuffer()
      const audioContext = new AudioContext()
      try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
        const recording: MuseMicrophoneRecording = {
          id: crypto.randomUUID(),
          sampleRate: audioBuffer.sampleRate,
          channelData: audioBuffer.getChannelData(0),
          recordedAt: new Date().toISOString(),
        }
        importBpmRef.current = bpm
        const imported = importHumming(
          recording,
          { strength, gridSubdivision },
          bpm,
        )
        setResult(imported)
        setCorrections({})
        setStage("review")
      } catch (e) {
        toast.error(localized["humming-decode-error"])
        console.error(e)
        setStage("idle")
      } finally {
        void audioContext.close()
      }
    },
    [currentBpm, strength, gridSubdivision, toast, localized],
  )

  const onClickRecord = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })
      mediaStreamRef.current = stream
      chunksRef.current = []
      const recorder = new MediaRecorder(stream)
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        })
        stopStream()
        setStage("processing")
        void processRecording(blob)
      }
      mediaRecorderRef.current = recorder
      recordingStartRef.current = Date.now()
      recorder.start()
      setElapsedSeconds(0)
      setStage("recording")
    } catch (e) {
      toast.error(localized["humming-mic-error"])
      console.error(e)
    }
  }, [processRecording, stopStream, toast, localized])

  const onClickStop = useCallback(() => {
    mediaRecorderRef.current?.stop()
  }, [])

  const effectiveNote = useCallback(
    (index: number) => {
      const note = result?.detectedNotes[index]
      if (!note) return null
      const correction = corrections[index]
      return {
        pitch: correction?.pitch ?? note.pitch,
        startSeconds: correction?.startSeconds ?? note.startSeconds,
        durationSeconds: correction?.durationSeconds ?? note.durationSeconds,
        confidence: note.confidence,
        discarded: correction?.discard ?? false,
      }
    },
    [result, corrections],
  )

  const updateCorrection = useCallback(
    (index: number, patch: Partial<MuseHummingCorrection>) => {
      setCorrections((prev) => ({
        ...prev,
        [index]: { ...prev[index], noteIndex: index, ...patch },
      }))
    },
    [],
  )

  const onToggleDiscard = useCallback(
    (index: number) => {
      const discarded = effectiveNote(index)?.discarded ?? false
      updateCorrection(index, { discard: !discarded })
    },
    [effectiveNote, updateCorrection],
  )

  const onApprove = useCallback(() => {
    if (!result) return
    try {
      const correctionList = Object.values(corrections)
      const corrected = correctHummingDraft(result, correctionList)
      const approved = approveHummingDraft(corrected)
      applyHummingResultToSong(
        songStore.song,
        approved,
        targetRole,
        importBpmRef.current,
      )
      toast.success(localized["humming-approved"])
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }, [result, corrections, songStore, targetRole, toast, localized, onClose])

  const notes = useMemo(() => result?.detectedNotes ?? [], [result])

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogTitle>
        <Localized name="humming-title" />
      </DialogTitle>
      <DialogContent>
        <Content>
          {stage === "idle" && (
            <Section>
              <SectionHeading>
                <Localized name="humming-quantization-heading" />
              </SectionHeading>
              <SliderRow>
                <SliderLabel>
                  <Localized name="humming-quantization-strength" />
                </SliderLabel>
                <Slider
                  value={strength}
                  onChange={setStrength}
                  min={0}
                  max={1}
                  step={0.05}
                />
                <SliderValue>{strength.toFixed(2)}</SliderValue>
              </SliderRow>
              <SliderRow>
                <SliderLabel>
                  <Localized name="humming-quantization-grid" />
                </SliderLabel>
                <Slider
                  value={gridIndex}
                  onChange={setGridIndex}
                  min={0}
                  max={GRID_OPTIONS.length - 1}
                  step={1}
                />
                <SliderValue>1/{gridSubdivision}</SliderValue>
              </SliderRow>
            </Section>
          )}

          <Section>
            <Row>
              {stage !== "recording" && stage !== "processing" && (
                <PrimaryButton onClick={onClickRecord}>
                  <Localized name="humming-record-start" />
                </PrimaryButton>
              )}
              {stage === "recording" && (
                <>
                  <Button onClick={onClickStop}>
                    <Localized name="humming-record-stop" />
                  </Button>
                  <Row>
                    <RecordingDot />
                    <Localized name="humming-recording" />
                    {` (${elapsedSeconds.toFixed(0)}s)`}
                  </Row>
                </>
              )}
              {stage === "processing" && (
                <Row>
                  <Localized name="humming-processing" />
                </Row>
              )}
            </Row>
          </Section>

          {stage === "review" && (
            <>
              <Section>
                <SectionHeading>
                  <Localized name="humming-review-heading" />
                </SectionHeading>
                {notes.length === 0 ? (
                  <Empty>
                    <Localized name="humming-no-notes" />
                  </Empty>
                ) : (
                  <List>
                    {notes.map((_, index) => {
                      const note = effectiveNote(index)
                      if (!note) return null
                      return (
                        <ListItem key={index} discarded={note.discarded}>
                          <NoteLabel>
                            {noteNameWithOctString(Math.round(note.pitch))}
                          </NoteLabel>
                          <NoteField
                            type="number"
                            value={Math.round(note.pitch)}
                            onChange={(e) =>
                              updateCorrection(index, {
                                pitch: Number(e.target.value),
                              })
                            }
                          />
                          <NoteField
                            type="number"
                            step={0.01}
                            value={Number(note.startSeconds.toFixed(2))}
                            onChange={(e) =>
                              updateCorrection(index, {
                                startSeconds: Number(e.target.value),
                              })
                            }
                          />
                          <NoteField
                            type="number"
                            step={0.01}
                            value={Number(note.durationSeconds.toFixed(2))}
                            onChange={(e) =>
                              updateCorrection(index, {
                                durationSeconds: Number(e.target.value),
                              })
                            }
                          />
                          <NoteLabel>
                            {Math.round(note.confidence * 100)}%
                          </NoteLabel>
                          <Button onClick={() => onToggleDiscard(index)}>
                            <Localized
                              name={
                                note.discarded
                                  ? "humming-note-restore"
                                  : "humming-note-discard"
                              }
                            />
                          </Button>
                        </ListItem>
                      )
                    })}
                  </List>
                )}
              </Section>

              <Section>
                <SectionHeading>
                  <Localized name="humming-target-role-heading" />
                </SectionHeading>
                <RoleGrid>
                  {ROLES.map((role) => (
                    <RoleButton
                      key={role}
                      type="button"
                      selected={role === targetRole}
                      onClick={() => setTargetRole(role)}
                    >
                      <Localized name={roleLabelKey(role)} />
                    </RoleButton>
                  ))}
                </RoleGrid>
              </Section>
            </>
          )}
        </Content>
      </DialogContent>
      <DialogActions>
        <PrimaryButton onClick={onApprove} disabled={stage !== "review"}>
          <Localized name="humming-approve" />
        </PrimaryButton>
        <div style={{ flex: 1 }} />
        <Button onClick={onClose}>
          <Localized name="close" />
        </Button>
      </DialogActions>
    </Dialog>
  )
}
