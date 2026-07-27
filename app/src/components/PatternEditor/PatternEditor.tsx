import styled from "@emotion/styled"
import { getTempo } from "@signal-app/core"
import { useToast } from "dialog-hooks"
import ChevronLeft from "mdi-react/ChevronLeftIcon"
import Pause from "mdi-react/PauseIcon"
import Play from "mdi-react/PlayIcon"
import Redo from "mdi-react/RedoIcon"
import Undo from "mdi-react/UndoIcon"
import { toJS } from "mobx"
import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { DEFAULT_TEMPO } from "../../Constants"
import {
  gridTicks,
  type MuseBezierEnvelope,
  type MusePattern,
  type MusePatternLayerKind,
  stepCount,
} from "../../entities/pattern/MusePattern"
import { useStores } from "../../hooks/useStores"
import { Localized, useLocalization } from "../../localize/useLocalization"
import { getJamAudioEngine } from "../../services/jamRoom/audio/JamAudioEngine"
import { PatternPlayer } from "../../services/pattern/PatternPlayer"
import {
  canRedo,
  canUndo,
  createHistory,
  type PatternHistory,
  pushHistory,
  redo,
  replaceHistory,
  undo,
} from "../../services/pattern/patternHistory"
import {
  addLayer,
  addNote,
  hasOverhang,
  removeLayer,
  removeNote,
  resizeNote,
  resizeNoteStart,
  setGridDivision,
  setNoteEnvelope,
  setNotePosition,
  setNoteVelocity,
  setPatternLength,
  setPatternName,
  setPatternSteps,
  toggleLayerFlag,
  trimOverhang,
  updateLayer,
} from "../../services/pattern/patternOps"
import { applyPatternToSong } from "../../services/pattern/patternSongAdapter"
import { ToolbarButton } from "../Toolbar/ToolbarButton"
import {
  ToolbarButtonGroup,
  ToolbarButtonGroupItem,
} from "../Toolbar/ToolbarButtonGroup"
import { Button, PrimaryButton } from "../ui/Button"
import {
  FieldGroup,
  InlineInput,
  InlineSelect,
  NumberField,
  Spacer,
  Workspace,
  WorkspaceHeader,
} from "../ui/Panel"
import { EventDrawer } from "./EventDrawer"
import { DRUM_ZONES, LayerRail, MELODIC_INSTRUMENTS } from "./LayerRail"
import { type CanvasGesture, PatternCanvas } from "./PatternCanvas"

const Body = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
`

const CanvasArea = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
`

const Notice = styled.div`
  display: flex;
  gap: 0.75rem;
  align-items: center;
  padding: 0.4rem 1rem;
  border-bottom: 1px solid var(--color-divider);
  background: var(--color-background-secondary);
  color: var(--color-text-secondary);
  font-size: 0.75rem;
`

const NameField = styled(InlineInput)`
  min-width: 8rem;
  max-width: 16rem;
`

const GRID_OPTIONS = [
  { value: 4, label: "1/4" },
  { value: 8, label: "1/8" },
  { value: 16, label: "1/16" },
  { value: 32, label: "1/32" },
]

export interface PatternEditorProps {
  patternId: string
  onClose: () => void
}

export const PatternEditor: FC<PatternEditorProps> = ({
  patternId,
  onClose,
}) => {
  const rootStore = useStores()
  const { songStore, patternStore, player, synth, synthGroup } = rootStore
  const toast = useToast()
  const localized = useLocalization()
  const engine = getJamAudioEngine()

  const stored = patternStore.get(patternId)
  const [history, setHistory] = useState<PatternHistory>(() =>
    createHistory(toJS(stored) ?? ({} as MusePattern)),
  )
  const pattern = history.present

  const [activeLayerId, setActiveLayerId] = useState<string>(
    () => stored?.trackLayers[0]?.id ?? "",
  )
  const [selected, setSelected] = useState<{
    layerId: string
    noteId: string
  } | null>(null)
  const [railOpen, setRailOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [stepWidth, setStepWidth] = useState(38)
  const [basePitch, setBasePitch] = useState(48)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playheadTick, setPlayheadTick] = useState<number | null>(null)
  const [loop, setLoop] = useState(true)

  const playerRef = useRef<PatternPlayer | null>(null)
  const patternRef = useRef(pattern)
  patternRef.current = pattern

  const bpm = useMemo(() => {
    const conductor = songStore.song.conductorTrack
    return conductor
      ? (getTempo(conductor.events, 0) ?? DEFAULT_TEMPO)
      : DEFAULT_TEMPO
  }, [songStore.song])

  const visibleRows = 18
  const step = gridTicks(pattern)
  const activeLayer = pattern.trackLayers.find((l) => l.id === activeLayerId)
  const selectedNote = selected
    ? pattern.trackLayers
        .find((l) => l.id === selected.layerId)
        ?.notes.find((n) => n.id === selected.noteId)
    : undefined

  // ---- audio ----
  const playerDeps = useMemo(
    () => ({
      engine,
      sendEvent: (
        event: Parameters<typeof player.sendEvent>[0],
        delay: number,
      ) => player.sendEvent(event, delay),
      allSoundsOff: (channel: number) => player.allSoundsOffChannel(channel),
      isSoundFontReady: () => synth.isLoaded,
      activate: () => synthGroup.activate(),
    }),
    [engine, player, synth, synthGroup],
  )

  useEffect(() => {
    engine.adoptContext(rootStore.audioContext)
  }, [engine, rootStore])

  useEffect(() => {
    return () => {
      playerRef.current?.stop()
      playerRef.current = null
    }
  }, [])

  const ensurePlayer = useCallback((): PatternPlayer => {
    if (!playerRef.current) {
      const instance = new PatternPlayer(playerDeps, patternRef.current, bpm)
      instance.onPosition = (tick) => setPlayheadTick(tick)
      instance.onStop = () => {
        setIsPlaying(false)
        setPlayheadTick(null)
      }
      playerRef.current = instance
    }
    const instance = playerRef.current
    instance.pattern = patternRef.current
    instance.setBpm(bpm)
    instance.loop = loop
    return instance
  }, [bpm, loop, playerDeps])

  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.pattern = pattern
      playerRef.current.loop = loop
    }
  }, [pattern, loop])

  /** Short audible feedback while editing – never touches the song. */
  const previewNote = useCallback(
    (layerId: string, noteNumber: number, velocity = 90) => {
      const layer = patternRef.current.trackLayers.find((l) => l.id === layerId)
      if (!layer) return
      engine.ensureContext()
      if (layer.kind !== "melodic") {
        engine.playDrumAt(engine.now(), layer.drumZoneId ?? "snare", velocity)
        return
      }
      const instance = ensurePlayer()
      const channel = instance.channelForLayer(layerId)
      if (synth.isLoaded) {
        synthGroup.activate()
        player.sendEvent({
          type: "channel",
          subtype: "programChange",
          channel,
          value: layer.program ?? 0,
        })
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
          0.35,
        )
      } else {
        engine.playSynthNoteAt(engine.now(), noteNumber, velocity, 0.3, "lead")
      }
    },
    [engine, ensurePlayer, player, synth, synthGroup],
  )

  // ---- history helpers ----
  // A gesture (drag, resize, end-marker move) produces many intermediate
  // states but exactly one undo step: `live` replaces the present, and the
  // snapshot taken at gesture start becomes the entry in the past.
  // `gestureBase` is the state undo returns to; `gestureApply` is the state
  // the gesture is applied to. They differ while drag-creating a note: the
  // resize must build on the pattern that already contains the new note.
  const gestureBaseRef = useRef<MusePattern | null>(null)
  const gestureApplyRef = useRef<MusePattern | null>(null)

  const commit = useCallback((next: MusePattern) => {
    setHistory((h) => pushHistory(h, next))
  }, [])

  const live = useCallback((next: MusePattern) => {
    setHistory((h) => replaceHistory(h, next))
  }, [])

  const beginGesture = useCallback(() => {
    gestureBaseRef.current = patternRef.current
    gestureApplyRef.current = patternRef.current
  }, [])

  const handleCommit = useCallback(() => {
    const base = gestureBaseRef.current
    gestureBaseRef.current = null
    gestureApplyRef.current = null
    setHistory((h) => {
      if (base === null || base === h.present) return h
      return {
        past: [...h.past, base].slice(-100),
        present: h.present,
        future: [],
      }
    })
  }, [])

  // Autosave keeps a reopened pattern complete without an explicit click
  useEffect(() => {
    if (!pattern.id) return
    patternStore.save(toJS(pattern))
  }, [pattern, patternStore])

  // ---- canvas callbacks ----
  const handleCreateNote = useCallback(
    (layerId: string, startTick: number, noteNumber: number) => {
      const result = addNote(
        gestureApplyRef.current ?? patternRef.current,
        layerId,
        {
          startTick,
          noteNumber,
          durationTicks: gridTicks(patternRef.current),
        },
      )
      if (!result.noteId) {
        toast.info(localized["pattern-layer-locked"])
        return null
      }
      // Subsequent drag events of this gesture extend the note that was just
      // created, so they have to build on the pattern that contains it.
      gestureApplyRef.current = result.pattern
      live(result.pattern)
      previewNote(layerId, noteNumber)
      return result.noteId
    },
    [live, localized, previewNote, toast],
  )

  const handleDragNote = useCallback(
    (layerId: string, noteId: string, gesture: CanvasGesture) => {
      // Gestures are absolute, so they always apply to the pattern the drag
      // started from – dragging back and forth cannot drift.
      const base = gestureApplyRef.current ?? patternRef.current
      switch (gesture.type) {
        case "move":
          live(
            setNotePosition(
              base,
              layerId,
              noteId,
              gesture.startTick,
              gesture.noteNumber,
            ),
          )
          break
        case "resize-end":
          live(resizeNote(base, layerId, noteId, gesture.durationTicks))
          break
        case "resize-start":
          live(resizeNoteStart(base, layerId, noteId, gesture.startTick))
          break
      }
    },
    [live],
  )

  const handleDeleteNote = useCallback(
    (layerId: string, noteId: string) => {
      gestureBaseRef.current = null
      gestureApplyRef.current = null
      commit(removeNote(patternRef.current, layerId, noteId))
      setSelected((s) => (s?.noteId === noteId ? null : s))
    },
    [commit],
  )

  // ---- toolbar actions ----
  const togglePlay = useCallback(() => {
    const instance = ensurePlayer()
    if (instance.isPlaying) {
      instance.stop()
      setIsPlaying(false)
      setPlayheadTick(null)
    } else {
      instance.start()
      setIsPlaying(true)
    }
  }, [ensurePlayer])

  const handleExport = useCallback(() => {
    const binding = applyPatternToSong(
      songStore.song,
      pattern,
      patternStore.getBinding(pattern.id),
    )
    patternStore.setBinding(pattern.id, binding)
    patternStore.save(toJS(pattern))
    toast.success(
      `${localized["pattern-exported"]}: ${pattern.name} (${Object.keys(binding).length})`,
    )
  }, [localized, pattern, patternStore, songStore.song, toast])

  const handleSave = useCallback(() => {
    patternStore.save(toJS(pattern))
    toast.success(localized["pattern-saved"])
  }, [localized, pattern, patternStore, toast])

  const handleClose = useCallback(() => {
    playerRef.current?.stop()
    playerRef.current = null
    patternStore.save(toJS(pattern))
    onClose()
  }, [onClose, pattern, patternStore])

  const openRail = useCallback(() => {
    setRailOpen((open) => {
      if (!open) setDrawerOpen(false)
      return !open
    })
  }, [])

  const openDrawer = useCallback(() => {
    setDrawerOpen((open) => {
      if (!open) setRailOpen(false)
      return !open
    })
  }, [])

  // ---- keyboard ----
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return
      }
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault()
        setHistory((h) => (e.shiftKey ? redo(h) : undo(h)))
        return
      }
      if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault()
        setHistory((h) => redo(h))
        return
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selected) return
        e.preventDefault()
        handleDeleteNote(selected.layerId, selected.noteId)
        return
      }
      if (e.code === "Space") {
        e.preventDefault()
        togglePlay()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [handleDeleteNote, selected, togglePlay])

  if (!stored || !pattern.id) {
    return (
      <Workspace>
        <WorkspaceHeader>
          <Button onClick={onClose}>
            <ChevronLeft size="1rem" />
            <Localized name="patterns" />
          </Button>
          <span>
            <Localized name="pattern-not-found" />
          </span>
        </WorkspaceHeader>
      </Workspace>
    )
  }

  const steps = stepCount(pattern)

  return (
    <Workspace>
      <WorkspaceHeader>
        <Button onClick={handleClose}>
          <ChevronLeft size="1rem" />
          <Localized name="patterns" />
        </Button>
        <NameField
          value={pattern.name}
          onChange={(e) => commit(setPatternName(pattern, e.target.value))}
          aria-label={localized["pattern-name"]}
        />
        <ToolbarButton
          data-testid="pattern-transport"
          onMouseDown={togglePlay}
          selected={isPlaying}
          aria-label={localized["play-pause"]}
        >
          {isPlaying ? <Pause size="1rem" /> : <Play size="1rem" />}
        </ToolbarButton>
        <ToolbarButton onMouseDown={() => setLoop((l) => !l)} selected={loop}>
          <Localized name="pattern-loop" />
        </ToolbarButton>

        <FieldGroup>
          <Localized name="pattern-steps" />
          <NumberField
            type="number"
            min={1}
            max={512}
            value={steps}
            onChange={(e) =>
              commit(setPatternSteps(pattern, Number(e.target.value) || 1))
            }
            aria-label={localized["pattern-steps"]}
          />
        </FieldGroup>

        <FieldGroup>
          <Localized name="snap-to-grid" />
          <InlineSelect
            value={pattern.gridDivision}
            onChange={(e) =>
              commit(setGridDivision(pattern, Number(e.target.value)))
            }
            aria-label={localized["snap-to-grid"]}
          >
            {GRID_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </InlineSelect>
        </FieldGroup>

        <FieldGroup as="div">
          <Localized name="pattern-zoom" />
          <ToolbarButtonGroup>
            <ToolbarButtonGroupItem
              onMouseDown={() => setStepWidth((w) => Math.max(16, w - 8))}
              aria-label={localized["pattern-zoom-out"]}
            >
              −
            </ToolbarButtonGroupItem>
            <ToolbarButtonGroupItem
              onMouseDown={() => setStepWidth((w) => Math.min(96, w + 8))}
              aria-label={localized["pattern-zoom-in"]}
            >
              +
            </ToolbarButtonGroupItem>
          </ToolbarButtonGroup>
        </FieldGroup>

        <FieldGroup as="div">
          <Localized name="pattern-octave" />
          <ToolbarButtonGroup>
            <ToolbarButtonGroupItem
              onMouseDown={() => setBasePitch((p) => Math.max(0, p - 12))}
              aria-label={localized["one-octave-down"]}
            >
              −
            </ToolbarButtonGroupItem>
            <ToolbarButtonGroupItem
              onMouseDown={() => setBasePitch((p) => Math.min(96, p + 12))}
              aria-label={localized["one-octave-up"]}
            >
              +
            </ToolbarButtonGroupItem>
          </ToolbarButtonGroup>
        </FieldGroup>

        <Spacer />

        <ToolbarButton
          onMouseDown={() => setHistory(undo)}
          disabled={!canUndo(history)}
          aria-label={localized["orchestration-undo"]}
        >
          <Undo size="1rem" />
        </ToolbarButton>
        <ToolbarButton
          onMouseDown={() => setHistory(redo)}
          disabled={!canRedo(history)}
          aria-label={localized["orchestration-redo"]}
        >
          <Redo size="1rem" />
        </ToolbarButton>
        <ToolbarButton onMouseDown={openRail} selected={railOpen}>
          <Localized name="pattern-layers" />
        </ToolbarButton>
        <ToolbarButton onMouseDown={openDrawer} selected={drawerOpen}>
          <Localized name="pattern-event" />
        </ToolbarButton>
        <Button onClick={handleSave}>
          <Localized name="pattern-save" />
        </Button>
        <PrimaryButton onClick={handleExport}>
          <Localized name="pattern-to-song" />
        </PrimaryButton>
      </WorkspaceHeader>

      {hasOverhang(pattern) && (
        <Notice>
          <Localized name="pattern-overhang" />
          <Button onClick={() => commit(trimOverhang(pattern))}>
            <Localized name="pattern-trim" />
          </Button>
        </Notice>
      )}

      <Body>
        <LayerRail
          pattern={pattern}
          open={railOpen}
          activeLayerId={activeLayerId}
          onToggleOpen={openRail}
          onSelect={(layerId) => {
            setActiveLayerId(layerId)
            setSelected(null)
          }}
          onToggleFlag={(layerId, flag) =>
            commit(toggleLayerFlag(pattern, layerId, flag))
          }
          onRename={(layerId, name) =>
            live(updateLayer(pattern, layerId, { name }))
          }
          onSetInstrument={(layerId, program) => {
            const name = MELODIC_INSTRUMENTS.find(
              (i) => i.program === program,
            )?.name
            commit(
              updateLayer(pattern, layerId, {
                program,
                ...(name ? { name } : {}),
              }),
            )
          }}
          onSetDrumZone={(layerId, zoneId) => {
            const name = DRUM_ZONES.find((z) => z.zoneId === zoneId)?.name
            commit(
              updateLayer(pattern, layerId, {
                drumZoneId: zoneId,
                ...(name ? { name } : {}),
              }),
            )
          }}
          onAddLayer={(kind: MusePatternLayerKind) => {
            const next = addLayer(pattern, {
              kind,
              name: kind === "melodic" ? "Piano" : "Kick",
              program: kind === "melodic" ? 0 : undefined,
              drumZoneId: kind === "melodic" ? undefined : "kick",
            })
            commit(next)
            setActiveLayerId(next.trackLayers[next.trackLayers.length - 1].id)
            setRailOpen(true)
          }}
          onRemoveLayer={(layerId) => {
            if (pattern.trackLayers.length <= 1) {
              toast.info(localized["pattern-last-layer"])
              return
            }
            commit(removeLayer(pattern, layerId))
            if (activeLayerId === layerId) {
              setActiveLayerId(
                pattern.trackLayers.find((l) => l.id !== layerId)?.id ?? "",
              )
            }
          }}
        />

        <CanvasArea>
          <PatternCanvas
            pattern={pattern}
            activeLayerId={activeLayerId}
            selectedNoteId={selected?.noteId ?? null}
            basePitch={basePitch}
            visibleRows={visibleRows}
            stepWidth={stepWidth}
            playheadTick={playheadTick}
            onSelectNote={(layerId, noteId) => {
              setSelected(noteId ? { layerId, noteId } : null)
              if (noteId) setDrawerOpen(true)
            }}
            onCreateNote={handleCreateNote}
            onDragNote={handleDragNote}
            onBeginGesture={beginGesture}
            onCommit={handleCommit}
            onDeleteNote={handleDeleteNote}
            onSetLength={(lengthTicks) =>
              live(
                setPatternLength(
                  gestureApplyRef.current ?? patternRef.current,
                  lengthTicks,
                ),
              )
            }
            onSelectLayer={(layerId) => setActiveLayerId(layerId)}
          />

          {drawerOpen && (
            <EventDrawer
              layer={
                selected
                  ? pattern.trackLayers.find((l) => l.id === selected.layerId)
                  : activeLayer
              }
              note={selectedNote}
              gridStepTicks={step}
              onSetVelocity={(velocity) => {
                if (!selected) return
                commit(
                  setNoteVelocity(
                    pattern,
                    selected.layerId,
                    selected.noteId,
                    velocity,
                  ),
                )
              }}
              onSetDuration={(durationTicks) => {
                if (!selected) return
                commit(
                  resizeNote(
                    pattern,
                    selected.layerId,
                    selected.noteId,
                    durationTicks,
                  ),
                )
              }}
              onSetEnvelope={(
                which: "volumeEnvelope" | "expressionEnvelope",
                envelope: MuseBezierEnvelope | undefined,
              ) => {
                if (!selected) return
                commit(
                  setNoteEnvelope(
                    pattern,
                    selected.layerId,
                    selected.noteId,
                    which,
                    envelope,
                  ),
                )
              }}
              onDelete={() => {
                if (!selected) return
                handleDeleteNote(selected.layerId, selected.noteId)
              }}
            />
          )}
        </CanvasArea>
      </Body>
    </Workspace>
  )
}
