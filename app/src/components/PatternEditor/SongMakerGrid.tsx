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
import { noteNameWithOctString } from "../../helpers/noteNumberString"
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
 * Melodic layers share **one** grid and lie on top of each other, the way image
 * layers do: the layer you are on is opaque, the others show through. That is
 * the point of the stack – you play the second instrument against the first one
 * you can still see, instead of against a block of empty rows further down.
 * Every layer has its own eye, so the stack can be thinned out at any time.
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
const LABEL_REM = 4.5

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
  position: relative;
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

  &[data-root="true"] {
    background: var(--color-piano-lane-black);
  }
`

/**
 * One layer's note inside a cell. Several of these can sit in the same cell –
 * stacked, translucent, active layer on top.
 */
const Ink = styled.span`
  position: absolute;
  inset: 1px;
  border-radius: 0.2rem;
  pointer-events: none;

  &[data-held="true"] {
    border-radius: 0;
    inset: 1px -3px;
  }

  &[data-held-start="true"] {
    border-radius: 0.2rem 0 0 0.2rem;
    inset: 1px -3px 1px 1px;
  }

  &[data-held-end="true"] {
    border-radius: 0 0.2rem 0.2rem 0;
    inset: 1px 1px 1px -3px;
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
  width: ${LABEL_REM}rem;
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

/** How much of a layer you see when you are not standing on it. */
const INACTIVE_OPACITY = 0.4

export interface SongMakerGridProps {
  pattern: MusePattern
  activeLayerId: string
  /** Melodic layer that receives new notes – the melodic rows are shared */
  melodicLayerId: string
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

interface Ledger {
  layer: MusePatternTrackLayer
  note: MusePatternNote
  isStart: boolean
  isEnd: boolean
  held: boolean
}

export const SongMakerGrid: FC<SongMakerGridProps> = ({
  pattern,
  activeLayerId,
  melodicLayerId,
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
    (layer) => layer.kind === "melodic" && layer.visible,
  )
  const lanes = pattern.trackLayers.filter(
    (layer) => layer.kind !== "melodic" && layer.visible,
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

  /**
   * And a second index by pitch, because a stacked cell has to ask every layer
   * what it holds – scanning all notes per layer per cell does not scale with
   * the number of layers.
   */
  const byPitch = useMemo(() => {
    const map = new Map<string, MusePatternNote[]>()
    for (const layer of pattern.trackLayers) {
      for (const note of layer.notes) {
        const key = `${layer.id}:${note.noteNumber}`
        const bucket = map.get(key)
        if (bucket) bucket.push(note)
        else map.set(key, [note])
      }
    }
    return map
  }, [pattern])

  const noteAt = useCallback(
    (layerId: string, stepIndex: number, noteNumber: number) =>
      index.get(`${layerId}:${stepIndex}:${noteNumber}`),
    [index],
  )

  /**
   * Everything drawn in one cell: one entry per layer that has a note there,
   * whether it starts in this cell or is held through it.
   */
  const stackAt = useCallback(
    (
      layers: MusePatternTrackLayer[],
      stepIndex: number,
      noteNumber: number,
    ): Ledger[] => {
      const tick = stepIndex * step
      const entries: Ledger[] = []
      for (const layer of layers) {
        const note = byPitch
          .get(`${layer.id}:${noteNumber}`)
          ?.find(
            (candidate) =>
              candidate.startTick <= tick &&
              candidate.startTick + candidate.durationTicks > tick,
          )
        if (!note) continue
        const endStep =
          Math.round((note.startTick + note.durationTicks) / step) - 1
        entries.push({
          layer,
          note,
          isStart: Math.round(note.startTick / step) === stepIndex,
          isEnd: endStep === stepIndex,
          held: note.durationTicks > step,
        })
      }
      // the layer you are on is painted last, so it lies on top of the others
      return entries.sort((a, b) =>
        a.layer.id === activeLayerId
          ? 1
          : b.layer.id === activeLayerId
            ? -1
            : 0,
      )
    },
    [activeLayerId, byPitch, step],
  )

  const drag = useRef<{
    layerId: string
    startStep: number
  } | null>(null)

  const handleDown = useCallback(
    (
      e: ReactPointerEvent<HTMLButtonElement>,
      layerId: string,
      stepIndex: number,
      noteNumber: number,
    ) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      if (layerId !== activeLayerId) onSelectLayer(layerId)

      const existing = noteAt(layerId, stepIndex, noteNumber)
      // a second tap on the same cell removes it again
      onToggle(layerId, stepIndex * step, noteNumber)
      if (!existing) drag.current = { layerId, startStep: stepIndex }
    },
    [activeLayerId, noteAt, onSelectLayer, onToggle, step],
  )

  /** Dragging sideways from a fresh cell lengthens the note it just created. */
  const handleEnter = useCallback(
    (stepIndex: number, layerId: string, noteNumber: number) => {
      const current = drag.current
      if (!current || current.layerId !== layerId) return
      const length = stepIndex - current.startStep + 1
      if (length < 1) return
      const note = noteAt(layerId, current.startStep, noteNumber)
      if (note) onExtendNote(layerId, note.id, length * step)
    },
    [noteAt, onExtendNote, step],
  )

  const endDrag = useCallback(() => {
    drag.current = null
  }, [])

  /**
   * @param layers every layer drawn in this row
   * @param target the layer a tap writes to
   */
  const renderRow = (
    layers: MusePatternTrackLayer[],
    target: string,
    noteNumber: number,
    label: string,
    key: string,
  ) => (
    <Row key={key}>
      <LaneLabel>{label}</LaneLabel>
      {Array.from({ length: steps }, (_, stepIndex) => {
        const stack = stackAt(layers, stepIndex, noteNumber)
        const mine = stack.find((entry) => entry.layer.id === target)
        return (
          <Cell
            key={stepIndex}
            type="button"
            style={{ width: width, height: width }}
            data-beat={stepIndex % 4 === 0}
            data-root={noteNumber % 12 === keyRoot % 12}
            aria-label={`${label} ${stepIndex + 1}`}
            aria-pressed={mine !== undefined}
            onPointerDown={(e) => handleDown(e, target, stepIndex, noteNumber)}
            onPointerEnter={() => handleEnter(stepIndex, target, noteNumber)}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => {
              const top = mine ?? stack[stack.length - 1]
              if (top) onSelectNote(top.layer.id, top.note.id)
            }}
          >
            {stack.map((entry) => (
              <Ink
                key={entry.layer.id}
                style={{
                  background: entry.layer.color,
                  opacity:
                    entry.layer.id === activeLayerId ? 1 : INACTIVE_OPACITY,
                }}
                data-held={entry.held && !entry.isStart && !entry.isEnd}
                data-held-start={entry.held && entry.isStart}
                data-held-end={entry.held && entry.isEnd}
                data-selected={entry.note.id === selectedNoteId}
              />
            ))}
          </Cell>
        )
      })}
    </Row>
  )

  return (
    <Scroller onPointerUp={endDrag} onPointerLeave={endDrag}>
      <Sheet aria-label={localized["pattern-grid"]}>
        {melodic.length > 0 && (
          <Section>
            <Rows>
              {rows.map((noteNumber) =>
                renderRow(
                  melodic,
                  melodicLayerId,
                  noteNumber,
                  noteNameWithOctString(noteNumber),
                  `melodic-${noteNumber}`,
                ),
              )}
            </Rows>
          </Section>
        )}

        {lanes.length > 0 && (
          <Section>
            <Rows>
              {lanes.map((layer) =>
                // percussion has no pitch: one row per layer, middle C as the
                // carrier so the data model stays the same as on the canvas
                renderRow(
                  [layer],
                  layer.id,
                  60,
                  layer.name,
                  `lane-${layer.id}`,
                ),
              )}
            </Rows>
          </Section>
        )}

        {playheadTick !== null && (
          <Playhead
            style={{
              left: LABEL_REM * 16 + 8 + (playheadTick / step) * (width + 2),
            }}
          />
        )}
      </Sheet>
    </Scroller>
  )
}
