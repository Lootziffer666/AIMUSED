import styled from "@emotion/styled"
import { getTempo } from "@signal-app/core"
import { useToast } from "dialog-hooks"
import ChevronLeft from "mdi-react/ChevronLeftIcon"
import DotsHorizontal from "mdi-react/DotsHorizontalIcon"
import Pause from "mdi-react/PauseIcon"
import Play from "mdi-react/PlayIcon"
import Record from "mdi-react/RecordIcon"
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
import { noteNameWithOctString } from "../../helpers/noteNumberString"
import { useStores } from "../../hooks/useStores"
import { Localized, useLocalization } from "../../localize/useLocalization"
import { getJamAudioEngine } from "../../services/jamRoom/audio/JamAudioEngine"
import {
  codesByNote,
  labelForCode,
  noteForCode,
  readKeyboardLayout,
} from "../../services/pattern/keyboardPiano"
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
  ensureLayerVisible,
  hasOverhang,
  type InstrumentSelection,
  removeLayer,
  removeNote,
  resizeNote,
  resizeNoteStart,
  selectOrCreateInstrumentLayer,
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
import { PatternRecording } from "../../services/pattern/patternRecorder"
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
import { PaperKeys } from "./PaperKeys"
import { type CanvasGesture, PatternCanvas } from "./PatternCanvas"
import { PianoKeyboard } from "./PianoKeyboard"
import { SongMakerGrid } from "./SongMakerGrid"
import { SongMakerLayerBar } from "./SongMakerLayerBar"

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

  @media (max-width: 700px) {
    min-width: 5rem;
    flex: 1;
  }
`

/**
 * Everything that is not needed to place a note.
 *
 * On a phone the toolbar was taller than the grid it belongs to, so the
 * second rank of controls hides behind one button and the grid gets the
 * screen back.
 */
const Secondary = styled.div`
  display: contents;

  @media (max-width: 700px) {
    display: none;

    &[data-open="true"] {
      display: flex;
      flex-basis: 100%;
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
    }
  }
`

const MoreButton = styled(ToolbarButton)`
  display: none;

  @media (max-width: 700px) {
    display: flex;
  }
`

/** Armed recording has to be unmistakable, so it is the one red control. */
const RecordButton = styled(ToolbarButton)`
  &[data-selected="true"] {
    color: var(--color-red);
  }
`

const PianoBar = styled.div`
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-shrink: 0;
  padding: 0.3rem 0.5rem;
  /* on a phone the row is wider than the screen: it scrolls, it does not wrap
     into three lines that eat the grid above it */
  overflow-x: auto;
  border-top: 1px solid var(--color-divider);
  background: var(--color-background);
  color: var(--color-text-secondary);
  font-size: 0.7rem;
  white-space: nowrap;

  > * {
    flex-shrink: 0;
  }
`

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
  /**
   * In the grid all melodic layers share one raster, so a tap needs a target
   * even while a drum layer is the active one: the melodic layer you last
   * worked on.
   */
  const [preferredMelodicId, setPreferredMelodicId] = useState<string>(
    () => stored?.trackLayers.find((l) => l.kind === "melodic")?.id ?? "",
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
  /**
   * Two views of the same pattern: the Song-Maker grid, which works with a
   * finger and is what most people recognise, and the canvas, which shows
   * exact timing. A phone starts on the grid.
   */
  const [view, setView] = useState<"grid" | "canvas">(() =>
    typeof window !== "undefined" && window.innerWidth < 900
      ? "grid"
      : "canvas",
  )
  const [moreOpen, setMoreOpen] = useState(false)
  /**
   * The grid is scale bound, like the original: every cell is a note that
   * belongs, so there is no wrong one to hit. Editor state, not pattern data –
   * the notes themselves stay plain MIDI numbers.
   */
  const [gridKey, setGridKey] = useState(0)
  const [gridMode, setGridMode] = useState<"major" | "minor">("major")

  /**
   * The piano. It sits under the grid rather than on a page of its own, so a
   * note that came out wrong can be fixed by tapping the grid instead of
   * playing the whole take again.
   */
  const [pianoOpen, setPianoOpen] = useState(true)
  /** Screen keys, or a keyboard on paper read through the camera. */
  const [pianoSource, setPianoSource] = useState<"screen" | "paper">("screen")
  const [pianoBase, setPianoBase] = useState(48)
  const [activeNotes, setActiveNotes] = useState<ReadonlySet<number>>(
    () => new Set(),
  )
  const [isRecording, setIsRecording] = useState(false)
  const [quantizeRecording, setQuantizeRecording] = useState(true)
  const [keyboardLayout, setKeyboardLayout] = useState<ReadonlyMap<
    string,
    string
  > | null>(null)
  /** A phone gets two octaves of finger-sized keys instead of seven thin ones. */
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 900,
  )

  const playerRef = useRef<PatternPlayer | null>(null)
  const patternRef = useRef(pattern)
  patternRef.current = pattern
  const recording = useRef(new PatternRecording())
  const isRecordingRef = useRef(isRecording)
  isRecordingRef.current = isRecording
  const quantizeRef = useRef(quantizeRecording)
  quantizeRef.current = quantizeRecording

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

  const selectLayer = useCallback((layerId: string) => {
    setActiveLayerId(layerId)
    setSelected(null)
    const layer = patternRef.current.trackLayers.find((l) => l.id === layerId)
    if (layer?.kind === "melodic") setPreferredMelodicId(layerId)
  }, [])

  const melodicLayerId = useMemo(() => {
    const preferred = pattern.trackLayers.find(
      (l) => l.id === preferredMelodicId && l.kind === "melodic",
    )
    return (
      preferred?.id ??
      pattern.trackLayers.find((l) => l.kind === "melodic")?.id ??
      ""
    )
  }, [pattern.trackLayers, preferredMelodicId])

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

  // ---- piano, recording and MIDI ----
  useEffect(() => {
    // not every environment the component renders in has matchMedia; the
    // initial width check already gave a usable answer
    if (typeof window.matchMedia !== "function") return
    const query = window.matchMedia("(max-width: 899px)")
    const onChange = () => setIsNarrow(query.matches)
    onChange()
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  useEffect(() => {
    let cancelled = false
    readKeyboardLayout().then((layout) => {
      if (!cancelled) setKeyboardLayout(layout)
    })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * The physical key printed on each note. Only the full keyboard shows them –
   * on two finger-sized octaves they would be in the way.
   */
  const codeLabels = useMemo(() => {
    const map = new Map<number, string>()
    for (const [note, code] of codesByNote(pianoBase)) {
      map.set(note, labelForCode(code, keyboardLayout))
    }
    return map
  }, [keyboardLayout, pianoBase])

  /**
   * Recording writes note by note while the loop keeps running, so two releases
   * can land between two renders. Applying the change to the history's own
   * present instead of to the captured `pattern` is what keeps the second one
   * from overwriting the first.
   */
  const applyCommit = useCallback((fn: (p: MusePattern) => MusePattern) => {
    setHistory((h) => pushHistory(h, fn(h.present)))
  }, [])

  const currentTick = useCallback(
    () => Math.round(playerRef.current?.currentTick() ?? 0),
    [],
  )

  const recordOptions = useCallback(
    () => ({
      lengthTicks: patternRef.current.lengthTicks,
      step: gridTicks(patternRef.current),
      quantize: quantizeRef.current,
    }),
    [],
  )

  const startNote = useCallback(
    (noteNumber: number, velocity: number) => {
      const layerId = melodicLayerId
      const layer = patternRef.current.trackLayers.find((l) => l.id === layerId)
      engine.ensureContext()
      const instance = ensurePlayer()
      const channel = instance.channelForLayer(layerId)
      if (synth.isLoaded) {
        synthGroup.activate()
        player.sendEvent({
          type: "channel",
          subtype: "programChange",
          channel,
          value: layer?.program ?? 0,
        })
        player.sendEvent({
          type: "channel",
          subtype: "noteOn",
          channel,
          noteNumber,
          velocity,
        })
      } else {
        // the fallback voices have no note-off, so they get a fixed length
        engine.playSynthNoteAt(engine.now(), noteNumber, velocity, 0.6, "lead")
      }
      setActiveNotes((notes) => new Set(notes).add(noteNumber))
      if (isRecordingRef.current) {
        recording.current.start(noteNumber, currentTick(), velocity)
      }
    },
    [
      currentTick,
      engine,
      ensurePlayer,
      melodicLayerId,
      player,
      synth,
      synthGroup,
    ],
  )

  const stopNote = useCallback(
    (noteNumber: number) => {
      const layerId = melodicLayerId
      if (synth.isLoaded && playerRef.current) {
        player.sendEvent({
          type: "channel",
          subtype: "noteOff",
          channel: playerRef.current.channelForLayer(layerId),
          noteNumber,
          velocity: 0,
        })
      }
      setActiveNotes((notes) => {
        const next = new Set(notes)
        next.delete(noteNumber)
        return next
      })
      const recorded = recording.current.finish(
        noteNumber,
        currentTick(),
        recordOptions(),
      )
      if (recorded) {
        applyCommit(
          (p) =>
            addNote(ensureLayerVisible(p, layerId), layerId, recorded).pattern,
        )
      }
    },
    [applyCommit, currentTick, melodicLayerId, player, recordOptions, synth],
  )

  const startNoteRef = useRef(startNote)
  startNoteRef.current = startNote
  const stopNoteRef = useRef(stopNote)
  stopNoteRef.current = stopNote

  /**
   * A MIDI keyboard plays the layer being edited, not the selected song track,
   * so the app-wide monitor steps aside while this view is open – otherwise
   * every note sounds twice on two instruments.
   */
  useEffect(() => {
    if (!pianoOpen) return
    const monitor = rootStore.midiMonitor
    const wasEnabled = monitor.enabled
    monitor.enabled = false
    const unsubscribe = rootStore.midiInput.on("midiMessage", (e) => {
      const status = e.data[0] & 0xf0
      const noteNumber = e.data[1]
      const velocity = e.data[2]
      if (status === 0x90 && velocity > 0) {
        startNoteRef.current(noteNumber, velocity)
      } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
        stopNoteRef.current(noteNumber)
      }
    })
    return () => {
      unsubscribe()
      monitor.enabled = wasEnabled
    }
  }, [pianoOpen, rootStore])

  /** The computer keyboard is the third way into the same two callbacks. */
  useEffect(() => {
    if (!pianoOpen) return
    const held = new Set<string>()
    const isTyping = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      return (
        element !== null &&
        (element.tagName === "INPUT" ||
          element.tagName === "SELECT" ||
          element.isContentEditable)
      )
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e.target)) return
      const note = noteForCode(e.code, pianoBase)
      if (note === undefined || held.has(e.code)) return
      held.add(e.code)
      e.preventDefault()
      startNoteRef.current(note, 96)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (!held.delete(e.code)) return
      const note = noteForCode(e.code, pianoBase)
      if (note !== undefined) stopNoteRef.current(note)
    }
    // a key held while the window loses focus would sound for ever
    const onBlur = () => {
      for (const code of held) {
        const note = noteForCode(code, pianoBase)
        if (note !== undefined) stopNoteRef.current(note)
      }
      held.clear()
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", onBlur)
      onBlur()
    }
  }, [pianoBase, pianoOpen])

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

  // ---- layers ----
  /**
   * Reaching for another instrument opens a layer; it never rewrites the one
   * you are standing on. Coming back to an instrument you already have returns
   * to its layer, so switching back and forth leaves no empty layers behind.
   */
  const handlePickInstrument = useCallback(
    (selection: InstrumentSelection) => {
      const result = selectOrCreateInstrumentLayer(
        patternRef.current,
        selection,
      )
      if (result.pattern !== patternRef.current) commit(result.pattern)
      setActiveLayerId(result.layerId)
      setSelected(null)
      if (selection.kind === "melodic") setPreferredMelodicId(result.layerId)
    },
    [commit],
  )

  const handleToggleVisible = useCallback(
    (layerId: string) => {
      commit(toggleLayerFlag(patternRef.current, layerId, "visible"))
    },
    [commit],
  )

  // ---- toolbar actions ----
  /** Keys still down when the music stops still become notes. */
  const closeOpenNotes = useCallback(() => {
    const notes = recording.current.finishAll(currentTick(), recordOptions())
    if (notes.length === 0) return
    const layerId = melodicLayerId
    applyCommit((p) =>
      notes.reduce(
        (acc, note) =>
          addNote(ensureLayerVisible(acc, layerId), layerId, note).pattern,
        p,
      ),
    )
  }, [applyCommit, currentTick, melodicLayerId, recordOptions])

  const togglePlay = useCallback(() => {
    const instance = ensurePlayer()
    if (instance.isPlaying) {
      closeOpenNotes()
      setIsRecording(false)
      instance.stop()
      setIsPlaying(false)
      setPlayheadTick(null)
    } else {
      instance.start()
      setIsPlaying(true)
    }
  }, [closeOpenNotes, ensurePlayer])

  const toggleRecording = useCallback(() => {
    if (isRecordingRef.current) {
      closeOpenNotes()
      setIsRecording(false)
      return
    }
    // recording into a stopped loop records nothing, so arming starts it
    const instance = ensurePlayer()
    if (!instance.isPlaying) {
      instance.start()
      setIsPlaying(true)
    }
    setIsRecording(true)
    setPianoOpen(true)
  }, [closeOpenNotes, ensurePlayer])

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
        <RecordButton
          data-testid="pattern-record"
          onMouseDown={toggleRecording}
          selected={isRecording}
          aria-label={localized["pattern-record"]}
        >
          <Record size="1rem" />
        </RecordButton>
        <ToolbarButton onMouseDown={() => setLoop((l) => !l)} selected={loop}>
          <Localized name="pattern-loop" />
        </ToolbarButton>
        <ToolbarButton
          onMouseDown={() => setPianoOpen((open) => !open)}
          selected={pianoOpen}
        >
          <Localized name="pattern-piano" />
        </ToolbarButton>

        <Secondary data-open={moreOpen}>
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

          {view === "grid" && (
            <FieldGroup>
              <Localized name="jam-key" />
              <InlineSelect
                value={gridKey}
                onChange={(e) => setGridKey(Number(e.target.value))}
                aria-label={localized["jam-key"]}
              >
                {NOTE_NAMES.map((name, index) => (
                  <option key={name} value={index}>
                    {name}
                  </option>
                ))}
              </InlineSelect>
              <InlineSelect
                value={gridMode}
                onChange={(e) =>
                  setGridMode(e.target.value as "major" | "minor")
                }
                aria-label={localized["jam-mode"]}
              >
                <option value="major">{localized["scale-major"]}</option>
                <option value="minor">{localized["scale-minor"]}</option>
              </InlineSelect>
            </FieldGroup>
          )}

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
          <ToolbarButtonGroup>
            <ToolbarButtonGroupItem
              onMouseDown={() => setView("grid")}
              selected={view === "grid"}
            >
              <Localized name="pattern-view-grid" />
            </ToolbarButtonGroupItem>
            <ToolbarButtonGroupItem
              onMouseDown={() => setView("canvas")}
              selected={view === "canvas"}
            >
              <Localized name="pattern-view-canvas" />
            </ToolbarButtonGroupItem>
          </ToolbarButtonGroup>
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
        </Secondary>

        <Spacer />
        <MoreButton
          onMouseDown={() => setMoreOpen((open) => !open)}
          selected={moreOpen}
          aria-label={localized["pattern-more"]}
        >
          <DotsHorizontal size="1rem" />
        </MoreButton>
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
          onSelect={selectLayer}
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
            const added = next.trackLayers[next.trackLayers.length - 1]
            commit(next)
            setActiveLayerId(added.id)
            if (added.kind === "melodic") setPreferredMelodicId(added.id)
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
          {view === "grid" ? (
            <>
              <SongMakerLayerBar
                pattern={pattern}
                activeLayerId={activeLayerId}
                onSelectLayer={selectLayer}
                onToggleVisible={handleToggleVisible}
                onPickInstrument={handlePickInstrument}
              />
              <SongMakerGrid
                pattern={pattern}
                activeLayerId={activeLayerId}
                melodicLayerId={melodicLayerId}
                selectedNoteId={selected?.noteId ?? null}
                basePitch={basePitch}
                rowCount={14}
                cellWidth={Math.max(28, Math.round(stepWidth * 0.9))}
                playheadTick={playheadTick}
                keyRoot={gridKey}
                mode={gridMode}
                onToggle={(layerId, startTick, noteNumber) => {
                  const layer = pattern.trackLayers.find(
                    (l) => l.id === layerId,
                  )
                  const existing = layer?.notes.find(
                    (note) =>
                      note.startTick === startTick &&
                      note.noteNumber === noteNumber,
                  )
                  if (existing) {
                    handleDeleteNote(layerId, existing.id)
                    return
                  }
                  gestureApplyRef.current = null
                  // a note has to be visible where it was placed, so writing to
                  // a hidden layer brings that layer back
                  const result = addNote(
                    ensureLayerVisible(pattern, layerId),
                    layerId,
                    {
                      startTick,
                      noteNumber,
                      durationTicks: step,
                    },
                  )
                  if (!result.noteId) {
                    toast.info(localized["pattern-layer-locked"])
                    return
                  }
                  commit(result.pattern)
                  previewNote(layerId, noteNumber)
                }}
                onExtendNote={(layerId, noteId, durationTicks) =>
                  commit(resizeNote(pattern, layerId, noteId, durationTicks))
                }
                onSelectNote={(layerId, noteId) => {
                  setSelected({ layerId, noteId })
                  setDrawerOpen(true)
                }}
                onSelectLayer={selectLayer}
              />
            </>
          ) : (
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
              onSelectLayer={selectLayer}
            />
          )}

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

          {pianoOpen && (
            <>
              <PianoBar>
                <ToolbarButtonGroup>
                  <ToolbarButtonGroupItem
                    onMouseDown={() => setPianoSource("screen")}
                    selected={pianoSource === "screen"}
                  >
                    <Localized name="pattern-piano" />
                  </ToolbarButtonGroupItem>
                  <ToolbarButtonGroupItem
                    onMouseDown={() => setPianoSource("paper")}
                    selected={pianoSource === "paper"}
                  >
                    <Localized name="jam-scan-keys" />
                  </ToolbarButtonGroupItem>
                </ToolbarButtonGroup>

                {pianoSource === "screen" && (
                  <>
                    <ToolbarButtonGroup>
                      <ToolbarButtonGroupItem
                        onMouseDown={() =>
                          setPianoBase((p) => Math.max(0, p - 12))
                        }
                        aria-label={localized["one-octave-down"]}
                      >
                        −
                      </ToolbarButtonGroupItem>
                      <ToolbarButtonGroupItem
                        onMouseDown={() =>
                          setPianoBase((p) => Math.min(108, p + 12))
                        }
                        aria-label={localized["one-octave-up"]}
                      >
                        +
                      </ToolbarButtonGroupItem>
                    </ToolbarButtonGroup>
                    <span>
                      {noteNameWithOctString(pianoBase)} –{" "}
                      {noteNameWithOctString(
                        Math.min(127, pianoBase + (isNarrow ? 2 : 7) * 12 - 1),
                      )}
                    </span>
                  </>
                )}

                <ToolbarButton
                  onMouseDown={() => setQuantizeRecording((q) => !q)}
                  selected={quantizeRecording}
                >
                  <Localized name="pattern-quantize-recording" />
                </ToolbarButton>
                <Spacer />
                <span>{activeLayer?.name}</span>
              </PianoBar>
              {pianoSource === "screen" ? (
                <PianoKeyboard
                  baseNote={pianoBase}
                  octaves={isNarrow ? 2 : 7}
                  compact={isNarrow}
                  activeNotes={activeNotes}
                  codeLabels={isNarrow ? null : codeLabels}
                  onNoteOn={startNote}
                  onNoteOff={stopNote}
                />
              ) : (
                <PaperKeys onNoteOn={startNote} onNoteOff={stopNote} />
              )}
            </>
          )}
        </CanvasArea>
      </Body>
    </Workspace>
  )
}
