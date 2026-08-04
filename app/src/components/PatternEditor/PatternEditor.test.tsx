import { emptySong } from "@signal-app/core"
import { screen } from "@testing-library/dom"
import { fireEvent, render } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ToastContext } from "dialog-hooks"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { StoreContext } from "../../hooks/useStores"
import {
  addLayer,
  addNote,
  createPattern,
} from "../../services/pattern/patternOps"
import { PatternStore } from "../../stores/PatternStore"
import type RootStore from "../../stores/RootStore"
import { PatternEditor } from "./PatternEditor"

/**
 * Integration test for the vertical slice: a real PatternStore, a real Song
 * and the real pattern operations behind the editor UI. Audio is stubbed at
 * the Web Audio / player boundary.
 */

const audioParam = () => ({
  value: 0,
  setValueAtTime: vi.fn(),
  linearRampToValueAtTime: vi.fn(),
  exponentialRampToValueAtTime: vi.fn(),
  setTargetAtTime: vi.fn(),
})

const node = () => ({
  connect: vi.fn(function connect(this: unknown, target: unknown) {
    return target
  }),
  disconnect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  gain: audioParam(),
  frequency: audioParam(),
  detune: audioParam(),
  Q: audioParam(),
  type: "sine",
  buffer: null,
})

function fakeAudioContext() {
  return {
    currentTime: 0,
    sampleRate: 44100,
    state: "running",
    destination: node(),
    resume: vi.fn(),
    createGain: vi.fn(node),
    createOscillator: vi.fn(node),
    createBiquadFilter: vi.fn(node),
    createBufferSource: vi.fn(node),
    createDynamicsCompressor: vi.fn(node),
    createBuffer: vi.fn(() => ({
      getChannelData: () => new Float32Array(8),
    })),
  } as unknown as AudioContext
}

function makeStores(patternStore: PatternStore) {
  const song = emptySong()
  const sent: unknown[] = []
  const stores = {
    songStore: { song },
    patternStore,
    audioContext: fakeAudioContext(),
    player: {
      sendEvent: (event: unknown) => sent.push(event),
      allSoundsOffChannel: vi.fn(),
    },
    synth: { isLoaded: false },
    synthGroup: { activate: vi.fn() },
    midiMonitor: { enabled: true },
    midiInput: { on: () => () => {} },
  } as unknown as RootStore
  return { stores, song, sent }
}

function renderEditor(patternStore: PatternStore, patternId: string) {
  const { stores, song } = makeStores(patternStore)
  const view = render(
    <StoreContext.Provider value={stores}>
      <ToastContext.Provider value={{ addMessage: vi.fn() }}>
        <PatternEditor patternId={patternId} onClose={vi.fn()} />
      </ToastContext.Provider>
    </StoreContext.Provider>,
  )
  return { ...view, song, stores }
}

function seedPattern(store: PatternStore) {
  let pattern = createPattern({ name: "Test", timebase: 480, steps: 16 })
  pattern = addLayer(pattern, {
    name: "Kick",
    kind: "percussion",
    drumZoneId: "kick",
  })
  store.save(pattern)
  return pattern
}

describe("PatternEditor", () => {
  beforeAll(() => {
    window.HTMLElement.prototype.setPointerCapture = vi.fn()
    window.HTMLElement.prototype.releasePointerCapture = vi.fn()
    window.HTMLElement.prototype.hasPointerCapture = vi.fn()
  })

  beforeEach(() => {
    window.localStorage.clear()
  })

  it("shows the pattern with its length and keeps state on the canvas", () => {
    const store = new PatternStore()
    const pattern = seedPattern(store)
    renderEditor(store, pattern.id)

    expect(screen.getByLabelText("Pattern name")).toHaveValue("Test")
    expect(screen.getByLabelText("Steps")).toHaveValue(16)
  })

  it("sets a free pattern length and keeps events beyond the end marker", () => {
    const store = new PatternStore()
    let pattern = seedPattern(store)
    const piano = pattern.trackLayers[0].id
    pattern = addNote(pattern, piano, {
      startTick: 120 * 14,
      noteNumber: 64,
    }).pattern
    store.save(pattern)

    renderEditor(store, pattern.id)

    const steps = screen.getByLabelText("Steps")
    fireEvent.change(steps, { target: { value: "13" } })

    const shortened = store.get(pattern.id)
    expect(shortened?.lengthTicks).toBe(13 * 120)
    // the note at step 14 survives outside the active length
    expect(shortened?.trackLayers[0].notes).toHaveLength(1)
    expect(screen.getByText(/kept but stay silent/)).toBeInTheDocument()

    fireEvent.change(steps, { target: { value: "16" } })
    expect(store.get(pattern.id)?.lengthTicks).toBe(16 * 120)
    expect(store.get(pattern.id)?.trackLayers[0].notes).toHaveLength(1)
  })

  it("drag-creates a note held over several steps", () => {
    const store = new PatternStore()
    const pattern = seedPattern(store)
    renderEditor(store, pattern.id)

    const grid = screen.getByLabelText("Pattern canvas")
    // default zoom is 38px per 1/16 step
    fireEvent.pointerDown(grid, { clientX: 0, clientY: 10, pointerId: 1 })
    // dragging onto the fourth step covers steps 0..3
    fireEvent.pointerMove(grid, { clientX: 114, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { pointerId: 1 })

    const notes = store.get(pattern.id)?.trackLayers[0].notes ?? []
    expect(notes).toHaveLength(1)
    expect(notes[0].startTick).toBe(0)
    expect(notes[0].durationTicks).toBe(4 * 120) // four 1/16 steps
  })

  it("drag-moving a note does not accumulate offsets", () => {
    const store = new PatternStore()
    let pattern = seedPattern(store)
    pattern = addNote(pattern, pattern.trackLayers[0].id, {
      startTick: 0,
      durationTicks: 120,
      noteNumber: 65,
    }).pattern
    store.save(pattern)
    renderEditor(store, pattern.id)

    const block = screen.getByTitle("F4 · Piano")
    // jsdom reports a zero-sized rect; give the block a real width so the
    // gesture is recognized as a move and not as an edge resize
    vi.spyOn(block, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 38,
      bottom: 19,
      width: 38,
      height: 19,
      toJSON: () => ({}),
    } as DOMRect)
    fireEvent.pointerDown(block, { clientX: 19, clientY: 10, pointerId: 1 })
    const grid = screen.getByLabelText("Pattern canvas")
    fireEvent.pointerMove(grid, { clientX: 95, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(grid, { clientX: 57, clientY: 10, pointerId: 1 })
    fireEvent.pointerUp(grid, { pointerId: 1 })

    // moved back to one step, not two steps further
    const note = store.get(pattern.id)?.trackLayers[0].notes[0]
    expect(note?.startTick).toBe(120)
  })

  it("adds an instrument layer from the rail and makes it the active one", async () => {
    const user = userEvent.setup()
    const store = new PatternStore()
    const pattern = seedPattern(store)
    renderEditor(store, pattern.id)

    await user.click(screen.getByRole("button", { name: "Layers" }))
    await user.click(screen.getByRole("button", { name: "+ Instrument" }))

    const saved = store.get(pattern.id)
    expect(saved?.trackLayers).toHaveLength(3)
    expect(saved?.trackLayers[2].kind).toBe("melodic")
  })

  it("keeps hidden layers in the data", async () => {
    const user = userEvent.setup()
    const store = new PatternStore()
    const pattern = seedPattern(store)
    let seeded = pattern
    seeded = addNote(seeded, seeded.trackLayers[0].id, {
      startTick: 0,
      noteNumber: 60,
    }).pattern
    store.save(seeded)

    renderEditor(store, seeded.id)
    await user.click(screen.getByRole("button", { name: "Layers" }))
    await user.click(screen.getAllByRole("button", { name: "visible" })[0])

    const saved = store.get(seeded.id)
    expect(saved?.trackLayers[0].visible).toBe(false)
    expect(saved?.trackLayers[0].notes).toHaveLength(1)
  })

  it("opens a layer when the instrument changes and leaves the old one alone", async () => {
    const user = userEvent.setup()
    const store = new PatternStore()
    let pattern = seedPattern(store)
    pattern = addNote(pattern, pattern.trackLayers[0].id, {
      startTick: 0,
      noteNumber: 60,
    }).pattern
    store.save(pattern)
    renderEditor(store, pattern.id)

    await user.click(screen.getByRole("button", { name: "Grid" }))
    fireEvent.change(screen.getByLabelText("Instrument"), {
      target: { value: "melodic:24" },
    })

    const withGuitar = store.get(pattern.id)
    expect(withGuitar?.trackLayers).toHaveLength(3)
    expect(withGuitar?.trackLayers[2].name).toBe("Guitar")
    // the note already played stays on the piano layer, unchanged
    expect(withGuitar?.trackLayers[0].program).toBe(0)
    expect(withGuitar?.trackLayers[0].notes).toHaveLength(1)

    // going back to the piano returns to its layer instead of stacking another
    fireEvent.change(screen.getByLabelText("Instrument"), {
      target: { value: "melodic:0" },
    })
    expect(store.get(pattern.id)?.trackLayers).toHaveLength(3)
  })

  it("stacks melodic layers in one grid and hides one without losing it", async () => {
    const user = userEvent.setup()
    const store = new PatternStore()
    let pattern = seedPattern(store)
    pattern = addNote(pattern, pattern.trackLayers[0].id, {
      startTick: 0,
      noteNumber: 60,
    }).pattern
    pattern = addLayer(pattern, {
      name: "Guitar",
      kind: "melodic",
      program: 24,
    })
    pattern = addNote(pattern, pattern.trackLayers[2].id, {
      startTick: 0,
      noteNumber: 60,
    }).pattern
    store.save(pattern)
    renderEditor(store, pattern.id)

    await user.click(screen.getByRole("button", { name: "Grid" }))

    // both layers share the same cell instead of getting a block of rows each
    expect(screen.getByLabelText("C4 1").childElementCount).toBe(2)

    await user.click(screen.getByLabelText("Show or hide layer: Guitar"))
    expect(screen.getByLabelText("C4 1").childElementCount).toBe(1)
    // hidden, not deleted
    expect(store.get(pattern.id)?.trackLayers[2].notes).toHaveLength(1)
    expect(store.get(pattern.id)?.trackLayers[2].visible).toBe(false)
  })

  it("plays the piano without writing anything while not recording", async () => {
    const store = new PatternStore()
    const pattern = seedPattern(store)
    renderEditor(store, pattern.id)

    const key = screen.getByLabelText("C3")
    fireEvent.pointerDown(key, { pointerId: 1, clientY: 0 })
    fireEvent.pointerUp(key, { pointerId: 1 })

    expect(store.get(pattern.id)?.trackLayers[0].notes).toHaveLength(0)
  })

  it("records a played key into the active layer", async () => {
    const user = userEvent.setup()
    const store = new PatternStore()
    const pattern = seedPattern(store)
    renderEditor(store, pattern.id)

    await user.click(screen.getByTestId("pattern-record"))
    const key = screen.getByLabelText("E3")
    fireEvent.pointerDown(key, { pointerId: 1, clientY: 0 })
    fireEvent.pointerUp(key, { pointerId: 1 })

    const notes = store.get(pattern.id)?.trackLayers[0].notes ?? []
    expect(notes).toHaveLength(1)
    expect(notes[0].noteNumber).toBe(52) // E3
    // quantizing is on by default, so a tap is a full grid step
    expect(notes[0].durationTicks).toBe(120)

    // and the take is editable straight away instead of having to be replayed
    await user.click(screen.getByTestId("pattern-record"))
    expect(store.get(pattern.id)?.trackLayers[0].notes).toHaveLength(1)
  })

  it("records from the computer keyboard as well", async () => {
    const user = userEvent.setup()
    const store = new PatternStore()
    const pattern = seedPattern(store)
    renderEditor(store, pattern.id)

    await user.click(screen.getByTestId("pattern-record"))
    // the physical key under the left little finger is the base C
    fireEvent.keyDown(window, { code: "KeyZ" })
    fireEvent.keyUp(window, { code: "KeyZ" })

    const notes = store.get(pattern.id)?.trackLayers[0].notes ?? []
    expect(notes).toHaveLength(1)
    expect(notes[0].noteNumber).toBe(48)
  })

  it("keeps a key that was still down when the transport stopped", async () => {
    const user = userEvent.setup()
    const store = new PatternStore()
    const pattern = seedPattern(store)
    renderEditor(store, pattern.id)

    await user.click(screen.getByTestId("pattern-record"))
    fireEvent.keyDown(window, { code: "KeyX" })
    // no key up – the transport stops with the key held
    await user.click(screen.getByTestId("pattern-transport"))

    const notes = store.get(pattern.id)?.trackLayers[0].notes ?? []
    expect(notes.map((n) => n.noteNumber)).toEqual([50])
  })

  it("exports to the song and does not duplicate tracks on repeated export", async () => {
    const user = userEvent.setup()
    const store = new PatternStore()
    let pattern = seedPattern(store)
    pattern = addNote(pattern, pattern.trackLayers[0].id, {
      startTick: 0,
      noteNumber: 60,
    }).pattern
    store.save(pattern)

    const { song } = renderEditor(store, pattern.id)
    const before = song.tracks.length

    const exportButton = screen.getByRole("button", { name: "Add to song" })
    await user.click(exportButton)
    const afterFirst = song.tracks.length
    expect(afterFirst).toBe(before + 1)

    await user.click(exportButton)
    expect(song.tracks.length).toBe(afterFirst)
    expect(Object.keys(store.getBinding(pattern.id))).toHaveLength(1)
  })

  it("preview playback creates no song tracks", async () => {
    const user = userEvent.setup()
    const store = new PatternStore()
    let pattern = seedPattern(store)
    pattern = addNote(pattern, pattern.trackLayers[0].id, {
      startTick: 0,
      noteNumber: 60,
    }).pattern
    store.save(pattern)

    const { song } = renderEditor(store, pattern.id)
    const before = song.tracks.length

    const transport = screen.getByTestId("pattern-transport")
    await user.click(transport)
    expect(transport).toHaveAttribute("data-selected", "true")
    await user.click(transport)
    expect(transport).toHaveAttribute("data-selected", "false")

    expect(song.tracks.length).toBe(before)
  })

  it("undo and redo cover an edit made in the editor", async () => {
    const user = userEvent.setup()
    const store = new PatternStore()
    const pattern = seedPattern(store)
    renderEditor(store, pattern.id)

    await user.click(screen.getByRole("button", { name: "Layers" }))
    await user.click(screen.getByRole("button", { name: "+ Drum" }))
    expect(store.get(pattern.id)?.trackLayers).toHaveLength(3)

    await user.click(screen.getByLabelText("Undo"))
    expect(store.get(pattern.id)?.trackLayers).toHaveLength(2)

    await user.click(screen.getByLabelText("Redo"))
    expect(store.get(pattern.id)?.trackLayers).toHaveLength(3)
  })

  it("stores a volume curve for the selected event", async () => {
    const user = userEvent.setup()
    const store = new PatternStore()
    let pattern = seedPattern(store)
    const piano = pattern.trackLayers[0].id
    const added = addNote(pattern, piano, {
      startTick: 0,
      durationTicks: 480,
      noteNumber: 60,
    })
    pattern = added.pattern
    store.save(pattern)

    renderEditor(store, pattern.id)

    // select the note block on the canvas (title = pitch · layer)
    await user.click(screen.getByTitle("C4 · Piano"))
    await user.click(screen.getAllByRole("button", { name: "fade in" })[0])

    const note = store.get(pattern.id)?.trackLayers.find((l) => l.id === piano)
      ?.notes[0]
    expect(note?.volumeEnvelope?.preset).toBe("fade-in")
    expect(note?.volumeEnvelope?.points[0].v).toBe(0)
  })

  it("closes back to the library without leaving editor UI behind", async () => {
    const user = userEvent.setup()
    const store = new PatternStore()
    const pattern = seedPattern(store)
    const onClose = vi.fn()
    const { stores } = makeStores(store)
    render(
      <StoreContext.Provider value={stores}>
        <ToastContext.Provider value={{ addMessage: vi.fn() }}>
          <PatternEditor patternId={pattern.id} onClose={onClose} />
        </ToastContext.Provider>
      </StoreContext.Provider>,
    )

    await user.click(screen.getByRole("button", { name: "Patterns" }))
    expect(onClose).toHaveBeenCalled()
    expect(store.get(pattern.id)).toBeDefined()
  })
})
