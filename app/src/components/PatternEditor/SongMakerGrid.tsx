import styled from "@emotion/styled"
import {
  type FC,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useMemo,
  useRef,
} from "react"
import {
  gridTicks,
  type MusePattern,
  type MusePatternNote,
  type MusePatternTrackLayer,
  stepCount,
} from "../../entities/pattern/MusePattern"
import { useLocalization } from "../../localize/useLocalization"
import { buildScaleNotes } from "../../services/jamRoom/inputMapping"

/**
 * The Song Maker grid.
 *
 * The layout everybody already knows: time to the right, pitch upwards, one
 * cell per step, tap to place a note and tap again to take it away. Melodic
 * layers sit on a scale so no wrong note exists, percussion gets its own
 * compact rows underneath.
 *
 * This is a second *view* of `MusePattern`, not a second model. Everything the
 * canvas can express is still in the data – held notes, curves, free length –
 * and a cell simply shows the note that starts there. Holding a note across
 * several steps is done by dragging, exactly as on the canvas.
 *
 * It exists because this is the surface that works with a finger, and because
 * it is the one children recognise.
 */

const CELL_MIN = 34

const Scroller = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  /* the grid scrolls, the page does not */
  touch-action: pan-x pan-y;
  background: var(--color-editor-background);
`

const Sheet = styled.div`
  display: inline-block;
  min-width: 100%;
  padding: 0.5rem 0.5rem 1rem;
  box-sizing: border-box;
`

const Rows = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const Row = styled.div`
  display: flex;
  gap: 2px;
`

const Cell = styled.button`
  flex-shrink: 0;
  border: 1px solid var(--color-editor-grid);
  border-radius: 0.25rem;
  background: var(--color-piano-lane-white);
  padding: 0;
  cursor: pointer;
  outline: none;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;

  &[data-beat="true"] {
    border-color: var(--color-divider);
  }

  &[data-beyond="true"] {
    opacity: 0.35;
  }

  &[data-filled="true"] {
    border-color: transparent;
  }

  &[data-held="true"] {
    border-radius: 0;
  }

  &[data-held-start="true"] {
    border-radius: 0.25rem 0 0 0.25rem;
  }

  &[data-held-end="true"] {
    border-radius: 0 0.25rem 0.25rem 0;
  }

  &[data-selected="true"] {
    box-shadow: inset 0 0 0 2px var(--color-text);
  }
`

const LaneLabel = styled.div`
  position: sticky;
  left: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  width: 4.5rem;
  padding-right: 0.4rem;
  box-sizing: border-box;
  background: var(--color-editor-background);
  color: var(--color-text-secondary);
  font-size: 0.7rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const Playhead = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--color-theme);
  pointer-events: none;
`

const Section = styled.div`
  margin-top: 0.5rem;
`

export interface SongMakerGridProps {
  pattern: MusePattern
  activeLayerId: string
  selectedNoteId: string | null
  /** Lowest note of the melodic grid */
  basePitch: number
  /** How many scale steps the melodic grid shows */
  rowCount: number
  cellWidth: number
  playheadTick: number | null
  keyRoot: number
  mode: "major" | "minor"
  onToggle: (layerId: string, startTick: number, noteNumber: number) => void
  onSelectNote: (layerId: string, noteId: string) => void
  onExtendNote: (layerId: string, noteId: string, durationTicks: number) => void
  onSelectLayer: (layerId: string) => void
}

/** Scale notes from low to high; the grid draws them high to low. */
export function scaleRows(
  keyRoot: number,
  mode: "major" | "minor",
  basePitch: number,
  rowCount: number,
): number[] {
  const octave = Math.max(0, Math.floor(basePitch / 12) - 1)
  return buildScaleNotes(keyRoot, mode, rowCount, octave)
}

export const SongMakerGrid: FC<SongMakerGridProps> = ({
  pattern,
  activeLayerId,
  selectedNoteId,
  basePitch,
  rowCount,
  cellWidth,
  playheadTick,
  keyRoot,
  mode,
  onToggle,
  onSelectNote,
  onExtendNote,
  onSelectLayer,
}) => {
  const localized = useLocalization()
  const step = gridTicks(pattern)
  const steps = stepCount(pattern)
  const width = Math.max(CELL_MIN, cellWidth)

  const rows = useMemo(
    () => scaleRows(keyRoot, mode, basePitch, rowCount).slice().reverse(),
    [basePitch, keyRoot, mode, rowCount],
  )

  const melodic = pattern.trackLayers.filter(
    (layer) =>
      layer.kind === "melodic" && (layer.visible || layer.id === activeLayerId),
  )
  const lanes = pattern.trackLayers.filter(
    (layer) =>
      layer.kind !== "melodic" && (layer.visible || layer.id === activeLayerId),
  )

  /**
   * Notes are indexed by the step they start on, so a cell can answer "is
   * something starting here" in constant time while dragging.
   */
  const index = useMemo(() => {
    const map = new Map<string, MusePatternNote>()
    for (const layer of pattern.trackLayers) {
      for (const note of layer.notes) {
        map.set(
          `${layer.id}:${Math.round(note.startTick / step)}:${note.noteNumber}`,
          note,
        )
      }
    }
    return map
  }, [pattern, step])

  const noteAt = useCallback(
    (layerId: string, stepIndex: number, noteNumber: number) =>
      index.get(`${layerId}:${stepIndex}:${noteNumber}`),
    [index],
  )

  /** Covering note for a cell that is not a start – used to draw held notes. */
  const coveringNote = useCallback(
    (layer: MusePatternTrackLayer, stepIndex: number, noteNumber: number) => {
      const tick = stepIndex * step
      return layer.notes.find(
        (note) =>
          note.noteNumber === noteNumber &&
          note.startTick <= tick &&
          note.startTick + note.durationTicks > tick,
      )
    },
    [step],
  )

  const drag = useRef<{
    layerId: string
    noteId: string
    startStep: number
  } | null>(null)

  const handleDown = useCallback(
    (
      e: ReactPointerEvent<HTMLButtonElement>,
      layer: MusePatternTrackLayer,
      stepIndex: number,
      noteNumber: number,
    ) => {
      if (layer.id !== activeLayerId) {
        onSelectLayer(layer.id)
        return
      }
      if (layer.locked) return
      e.currentTarget.setPointerCapture(e.pointerId)

      const existing = noteAt(layer.id, stepIndex, noteNumber)
      if (existing) {
        // a second tap on the same cell removes it again
        onToggle(layer.id, stepIndex * step, noteNumber)
        return
      }
      onToggle(layer.id, stepIndex * step, noteNumber)
      drag.current = { layerId: layer.id, noteId: "", startStep: stepIndex }
    },
    [activeLayerId, noteAt, onSelectLayer, onToggle, step],
  )

  /** Dragging sideways from a fresh cell lengthens the note it just created. */
  const handleEnter = useCallback(
    (stepIndex: number, layer: MusePatternTrackLayer, noteNumber: number) => {
      const current = drag.current
      if (!current || current.layerId !== layer.id) return
      const length = stepIndex - current.startStep + 1
      if (length < 1) return
      const note = noteAt(layer.id, current.startStep, noteNumber)
      if (note) onExtendNote(layer.id, note.id, length * step)
    },
    [noteAt, onExtendNote, step],
  )

  const endDrag = useCallback(() => {
    drag.current = null
  }, [])

  const renderRow = (
    layer: MusePatternTrackLayer,
    noteNumber: number,
    label: string | null,
  ) => (
    <Row key={`${layer.id}-${noteNumber}`}>
      {label !== null && <LaneLabel>{label}</LaneLabel>}
      {Array.from({ length: steps }, (_, stepIndex) => {
        const start = noteAt(layer.id, stepIndex, noteNumber)
        const covering = start ?? coveringNote(layer, stepIndex, noteNumber)
        const filled = covering !== undefined
        const held = covering !== undefined && covering.durationTicks > step
        const isStart = start !== undefined
        const endStep = covering
          ? Math.round((covering.startTick + covering.durationTicks) / step) - 1
          : -1
        return (
          <Cell
            key={stepIndex}
            type="button"
            style={{
              width: width,
              height: width,
              background: filled ? layer.color : undefined,
              opacity: layer.id === activeLayerId ? 1 : 0.55,
            }}
            data-filled={filled}
            data-held={held && !isStart && stepIndex !== endStep}
            data-held-start={held && isStart}
            data-held-end={held && stepIndex === endStep}
            data-beat={stepIndex % 4 === 0}
            data-beyond={stepIndex >= steps}
            data-selected={covering?.id === selectedNoteId}
            aria-label={`${layer.name} ${stepIndex + 1}`}
            onPointerDown={(e) => handleDown(e, layer, stepIndex, noteNumber)}
            onPointerEnter={() => handleEnter(stepIndex, layer, noteNumber)}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => {
              if (covering) onSelectNote(layer.id, covering.id)
            }}
          />
        )
      })}
    </Row>
  )

  return (
    <Scroller onPointerUp={endDrag} onPointerLeave={endDrag}>
      <Sheet aria-label={localized["pattern-grid"]}>
        {melodic.map((layer) => (
          <Section key={layer.id}>
            <Rows>
              {rows.map((noteNumber, rowIndex) =>
                renderRow(layer, noteNumber, rowIndex === 0 ? layer.name : ""),
              )}
            </Rows>
          </Section>
        ))}

        {lanes.length > 0 && (
          <Section>
            <Rows>
              {lanes.map((layer) =>
                // percussion has no pitch: one row per layer, middle C as the
                // carrier so the data model stays the same as on the canvas
                renderRow(layer, 60, layer.name),
              )}
            </Rows>
          </Section>
        )}

        {playheadTick !== null && (
          <Playhead
            style={{
              left: 4.5 * 16 + 8 + (playheadTick / step) * (width + 2),
            }}
          />
        )}
      </Sheet>
    </Scroller>
  )
}
