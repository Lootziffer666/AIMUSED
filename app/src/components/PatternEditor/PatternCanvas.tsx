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

/**
 * The pattern canvas: horizontal = time, vertical = pitch.
 *
 * Melodic layers draw note blocks on a pitch grid, percussion and sample
 * layers get one compact lane each below it – both share the same time axis,
 * the same end marker and the same playhead.
 */

const ROW_HEIGHT = 24
const LANE_HEIGHT = 30
const EDGE_GRAB_PX = 12

const Scroller = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  touch-action: pan-x pan-y;
`

const Sheet = styled.div`
  position: relative;
  padding: 8px 120px 16px 8px;
  min-width: min-content;
`

const Grid = styled.div`
  position: relative;
  border: 1px solid rgba(167, 139, 250, 0.16);
  border-radius: 12px;
  background: rgba(12, 10, 24, 0.72);
  overflow: hidden;
`

const RowStripe = styled.div<{ accent: boolean }>`
  position: absolute;
  right: 0;
  left: 0;
  height: ${ROW_HEIGHT}px;
  background: ${({ accent }) =>
    accent ? "rgba(167, 139, 250, 0.08)" : "transparent"};
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  pointer-events: none;
`

const StepLine = styled.div<{ strong: boolean; beat: boolean }>`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: ${({ strong, beat }) =>
    strong
      ? "rgba(167, 139, 250, 0.45)"
      : beat
        ? "rgba(255, 255, 255, 0.14)"
        : "rgba(255, 255, 255, 0.05)"};
  pointer-events: none;
`

const Inactive = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  background: repeating-linear-gradient(
    -45deg,
    rgba(255, 255, 255, 0.05),
    rgba(255, 255, 255, 0.05) 6px,
    transparent 6px,
    transparent 12px
  );
  pointer-events: none;
`

const NoteBlock = styled.div<{
  color: string
  active: boolean
  selected: boolean
  dimmed: boolean
}>`
  position: absolute;
  height: ${ROW_HEIGHT - 5}px;
  border: 1px solid
    ${({ selected, color }) => (selected ? "#ffffff" : color)};
  border-radius: 7px;
  background: ${({ color, active }) => (active ? color : `${color}59`)};
  box-shadow: ${({ selected, color }) =>
    selected ? `0 0 0 2px rgba(255,255,255,0.55), 0 0 16px ${color}` : "none"};
  opacity: ${({ dimmed }) => (dimmed ? 0.32 : 1)};
  cursor: ${({ active }) => (active ? "grab" : "default")};
  touch-action: none;
  transition: box-shadow 0.1s ease;
`

const NoteShape = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
`

const LaneRow = styled.div<{ active: boolean }>`
  position: relative;
  height: ${LANE_HEIGHT}px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: ${({ active }) =>
    active ? "rgba(167, 139, 250, 0.1)" : "transparent"};
`

const LaneLabel = styled.div<{ color: string }>`
  position: absolute;
  top: 50%;
  left: -8px;
  z-index: 3;
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  color: ${({ color }) => color};
  background: rgba(12, 10, 24, 0.9);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  white-space: nowrap;
  pointer-events: none;
  transform: translateY(-50%);
`

const Hit = styled.div<{ color: string; active: boolean; dimmed: boolean }>`
  position: absolute;
  top: 5px;
  height: ${LANE_HEIGHT - 10}px;
  border: 1px solid ${({ color }) => color};
  border-radius: 6px;
  background: ${({ color, active }) => (active ? color : `${color}55`)};
  opacity: ${({ dimmed }) => (dimmed ? 0.32 : 1)};
  cursor: pointer;
  touch-action: none;
`

const Playhead = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #f0abfc;
  box-shadow: 0 0 12px #f0abfc;
  pointer-events: none;
`

const EndMarker = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 4;
  width: 14px;
  margin-left: -6px;
  cursor: ew-resize;
  touch-action: none;

  &::before {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 6px;
    width: 2px;
    background: #a78bfa;
    box-shadow: 0 0 10px rgba(167, 139, 250, 0.8);
    content: "";
  }
`

const EndFlag = styled.div`
  position: absolute;
  top: 2px;
  left: 10px;
  padding: 2px 7px;
  border-radius: 6px;
  color: #1b1230;
  background: #a78bfa;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.1em;
  white-space: nowrap;
`

const PitchLabels = styled.div`
  position: absolute;
  top: 0;
  left: 6px;
  z-index: 2;
  pointer-events: none;
`

const PitchLabel = styled.div<{ accent: boolean }>`
  height: ${ROW_HEIGHT}px;
  color: ${({ accent }) => (accent ? "#c4b5fd" : "rgba(255,255,255,0.28)")};
  font-size: 9px;
  font-family: ui-monospace, Menlo, monospace;
  line-height: ${ROW_HEIGHT}px;
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

export function pitchName(midi: number): string {
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

/** Drag gestures carry absolute targets, computed from the drag origin. */
export type CanvasGesture =
  | { type: "move"; startTick: number; noteNumber: number }
  | { type: "resize-end"; durationTicks: number }
  | { type: "resize-start"; startTick: number }

export interface PatternCanvasProps {
  pattern: MusePattern
  activeLayerId: string
  selectedNoteId: string | null
  basePitch: number
  visibleRows: number
  stepWidth: number
  playheadTick: number | null
  onSelectNote: (layerId: string, noteId: string | null) => void
  onCreateNote: (
    layerId: string,
    startTick: number,
    noteNumber: number,
  ) => string | null
  onDragNote: (layerId: string, noteId: string, gesture: CanvasGesture) => void
  /** Called before the first mutation of a gesture so undo captures it */
  onBeginGesture: () => void
  onCommit: () => void
  onDeleteNote: (layerId: string, noteId: string) => void
  onSetLength: (lengthTicks: number) => void
  onSelectLayer: (layerId: string) => void
}

interface DragState {
  layerId: string
  noteId: string
  mode: "move" | "resize-end" | "resize-start" | "create"
  originX: number
  originY: number
  startTick: number
  startPitch: number
  startDuration: number
  moved: boolean
}

export const PatternCanvas: FC<PatternCanvasProps> = ({
  pattern,
  activeLayerId,
  selectedNoteId,
  basePitch,
  visibleRows,
  stepWidth,
  playheadTick,
  onSelectNote,
  onCreateNote,
  onDragNote,
  onBeginGesture,
  onCommit,
  onDeleteNote,
  onSetLength,
  onSelectLayer,
}) => {
  const step = gridTicks(pattern)
  const steps = stepCount(pattern)
  const overhangSteps = useMemo(() => {
    const maxTick = pattern.trackLayers.reduce(
      (max, layer) =>
        layer.notes.reduce(
          (m, n) => Math.max(m, n.startTick + n.durationTicks),
          max,
        ),
      0,
    )
    return Math.max(4, Math.ceil(maxTick / step) - steps + 2)
  }, [pattern, step, steps])
  const totalSteps = steps + overhangSteps
  const width = totalSteps * stepWidth
  const gridHeight = visibleRows * ROW_HEIGHT

  const melodicLayers = pattern.trackLayers.filter((l) => l.kind === "melodic")
  const laneLayers = pattern.trackLayers.filter((l) => l.kind !== "melodic")
  const activeLayer = pattern.trackLayers.find((l) => l.id === activeLayerId)

  const gridRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const endDragRef = useRef<boolean>(false)

  const tickFromX = useCallback(
    (x: number) => Math.max(0, (x / stepWidth) * step),
    [step, stepWidth],
  )
  const snap = useCallback(
    (tick: number) => Math.max(0, Math.round(tick / step) * step),
    [step],
  )
  const pitchFromY = useCallback(
    (y: number) => basePitch + visibleRows - 1 - Math.floor(y / ROW_HEIGHT),
    [basePitch, visibleRows],
  )
  const yForPitch = useCallback(
    (pitch: number) => (basePitch + visibleRows - 1 - pitch) * ROW_HEIGHT,
    [basePitch, visibleRows],
  )

  const finishDrag = useCallback(() => {
    const drag = dragRef.current
    dragRef.current = null
    endDragRef.current = false
    if (drag?.moved || drag?.mode === "create") onCommit()
  }, [onCommit])

  const handleGridPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!activeLayer || activeLayer.kind !== "melodic" || activeLayer.locked)
        return
      const rect = gridRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      const startTick = snap(tickFromX(x))
      const noteNumber = pitchFromY(y)
      onBeginGesture()
      const noteId = onCreateNote(activeLayer.id, startTick, noteNumber)
      if (!noteId) return
      onSelectNote(activeLayer.id, noteId)
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = {
        layerId: activeLayer.id,
        noteId,
        mode: "create",
        originX: e.clientX,
        originY: e.clientY,
        startTick,
        startPitch: noteNumber,
        startDuration: step,
        moved: false,
      }
    },
    [
      activeLayer,
      onBeginGesture,
      onCreateNote,
      onSelectNote,
      pitchFromY,
      snap,
      step,
      tickFromX,
    ],
  )

  const handleNotePointerDown = useCallback(
    (
      e: ReactPointerEvent<HTMLDivElement>,
      layer: MusePatternTrackLayer,
      note: MusePatternNote,
    ) => {
      e.stopPropagation()
      if (layer.id !== activeLayerId) {
        onSelectLayer(layer.id)
        return
      }
      onSelectNote(layer.id, note.id)
      if (layer.locked) return
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const offsetX = e.clientX - rect.left
      const mode: DragState["mode"] =
        offsetX > rect.width - EDGE_GRAB_PX
          ? "resize-end"
          : offsetX < EDGE_GRAB_PX && rect.width > EDGE_GRAB_PX * 2
            ? "resize-start"
            : "move"
      e.currentTarget.setPointerCapture(e.pointerId)
      onBeginGesture()
      dragRef.current = {
        layerId: layer.id,
        noteId: note.id,
        mode,
        originX: e.clientX,
        originY: e.clientY,
        startTick: note.startTick,
        startPitch: note.noteNumber,
        startDuration: note.durationTicks,
        moved: false,
      }
    },
    [activeLayerId, onBeginGesture, onSelectLayer, onSelectNote],
  )

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = e.clientX - drag.originX
      const dy = e.clientY - drag.originY
      if (!drag.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
      drag.moved = true

      // Everything is derived from the drag origin, so repeated move events
      // never accumulate on top of each other.
      const targetTick = snap(drag.startTick + tickFromX(dx))

      if (drag.mode === "move") {
        onDragNote(drag.layerId, drag.noteId, {
          type: "move",
          startTick: targetTick,
          noteNumber: drag.startPitch + Math.round(-dy / ROW_HEIGHT),
        })
      } else if (drag.mode === "resize-start") {
        onDragNote(drag.layerId, drag.noteId, {
          type: "resize-start",
          startTick: Math.max(0, targetTick),
        })
      } else {
        onDragNote(drag.layerId, drag.noteId, {
          type: "resize-end",
          durationTicks: Math.max(
            step,
            snap(drag.startDuration + tickFromX(dx)),
          ),
        })
      }
    },
    [onDragNote, snap, step, tickFromX],
  )

  const handleEndMarkerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      onBeginGesture()
      endDragRef.current = true
    },
    [onBeginGesture],
  )

  const handleEndMarkerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!endDragRef.current) return
      const rect = gridRef.current?.getBoundingClientRect()
      if (!rect) return
      const tick = snap(tickFromX(e.clientX - rect.left))
      onSetLength(Math.max(step, tick))
    },
    [onSetLength, snap, step, tickFromX],
  )

  const handleLanePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, layer: MusePatternTrackLayer) => {
      if (layer.id !== activeLayerId) {
        onSelectLayer(layer.id)
        return
      }
      if (layer.locked) return
      const rect = e.currentTarget.getBoundingClientRect()
      const tick = snap(tickFromX(e.clientX - rect.left))
      onBeginGesture()
      const existing = layer.notes.find(
        (n) => Math.abs(n.startTick - tick) < step / 2,
      )
      if (existing) {
        onDeleteNote(layer.id, existing.id)
      } else {
        const id = onCreateNote(layer.id, tick, 60)
        if (id) onSelectNote(layer.id, id)
      }
      onCommit()
    },
    [
      activeLayerId,
      onBeginGesture,
      onCommit,
      onCreateNote,
      onDeleteNote,
      onSelectLayer,
      onSelectNote,
      snap,
      step,
      tickFromX,
    ],
  )

  const renderNote = (layer: MusePatternTrackLayer, note: MusePatternNote) => {
    const isActive = layer.id === activeLayerId
    const left = (note.startTick / step) * stepWidth
    const noteWidth = Math.max(14, (note.durationTicks / step) * stepWidth - 2)
    const top = yForPitch(note.noteNumber) + 2
    if (top < -ROW_HEIGHT || top > gridHeight) return null
    const curve = note.volumeEnvelope
    return (
      <NoteBlock
        key={note.id}
        color={layer.color}
        active={isActive}
        selected={isActive && note.id === selectedNoteId}
        dimmed={note.startTick >= pattern.lengthTicks}
        style={{ left, top, width: noteWidth }}
        onPointerDown={(e) => handleNotePointerDown(e, layer, note)}
        onDoubleClick={(e) => {
          e.stopPropagation()
          if (isActive && !layer.locked) {
            onDeleteNote(layer.id, note.id)
          }
        }}
        title={`${pitchName(note.noteNumber)} · ${layer.name}`}
      >
        {curve && (
          <NoteShape viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline
              points={curvePoints(note)}
              fill="none"
              stroke="rgba(255,255,255,0.75)"
              strokeWidth="4"
              vectorEffect="non-scaling-stroke"
            />
          </NoteShape>
        )}
      </NoteBlock>
    )
  }

  return (
    <Scroller>
      <Sheet>
        <Grid
          ref={gridRef}
          aria-label="Pattern-Canvas"
          style={{ width, height: gridHeight }}
          onPointerDown={handleGridPointerDown}
          onPointerMove={(e) => {
            handlePointerMove(e)
            handleEndMarkerMove(e)
          }}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          {Array.from({ length: visibleRows }, (_, i) => {
            const pitch = basePitch + visibleRows - 1 - i
            return (
              <RowStripe
                key={pitch}
                accent={((pitch % 12) + 12) % 12 === 0}
                style={{ top: i * ROW_HEIGHT }}
              />
            )
          })}

          {Array.from({ length: totalSteps + 1 }, (_, i) => (
            <StepLine
              key={i}
              strong={i % (pattern.gridDivision / 4 || 4) === 0 && i % 4 === 0}
              beat={i % 4 === 0}
              style={{ left: i * stepWidth }}
            />
          ))}

          <Inactive
            style={{
              left: steps * stepWidth,
              width: Math.max(0, width - steps * stepWidth),
            }}
          />

          {melodicLayers
            .filter((layer) => layer.visible || layer.id === activeLayerId)
            .sort((a, b) =>
              a.id === activeLayerId ? 1 : b.id === activeLayerId ? -1 : 0,
            )
            .flatMap((layer) =>
              layer.notes.map((note) => renderNote(layer, note)),
            )}

          {playheadTick !== null && (
            <Playhead style={{ left: (playheadTick / step) * stepWidth }} />
          )}

          <EndMarker
            style={{ left: steps * stepWidth }}
            onPointerDown={handleEndMarkerDown}
            onPointerMove={handleEndMarkerMove}
            onPointerUp={() => {
              endDragRef.current = false
              onCommit()
            }}
            onPointerCancel={() => {
              endDragRef.current = false
            }}
            title="Pattern-Ende verschieben"
          >
            <EndFlag>ENDE · {steps}</EndFlag>
          </EndMarker>

          <PitchLabels>
            {Array.from({ length: visibleRows }, (_, i) => {
              const pitch = basePitch + visibleRows - 1 - i
              const isC = ((pitch % 12) + 12) % 12 === 0
              return (
                <PitchLabel key={pitch} accent={isC}>
                  {isC ? pitchName(pitch) : ""}
                </PitchLabel>
              )
            })}
          </PitchLabels>
        </Grid>

        {laneLayers.length > 0 && (
          <Grid style={{ width, marginTop: 10 }}>
            {laneLayers
              .filter((layer) => layer.visible || layer.id === activeLayerId)
              .map((layer) => (
                <LaneRow
                  key={layer.id}
                  active={layer.id === activeLayerId}
                  onPointerDown={(e) => handleLanePointerDown(e, layer)}
                >
                  <LaneLabel color={layer.color}>{layer.name}</LaneLabel>
                  {layer.notes.map((note) => (
                    <Hit
                      key={note.id}
                      color={layer.color}
                      active={layer.id === activeLayerId}
                      dimmed={note.startTick >= pattern.lengthTicks}
                      style={{
                        left: (note.startTick / step) * stepWidth + 1,
                        width: Math.max(10, stepWidth - 4),
                      }}
                      title={layer.name}
                    />
                  ))}
                </LaneRow>
              ))}
            <Inactive
              style={{
                left: steps * stepWidth,
                width: Math.max(0, width - steps * stepWidth),
              }}
            />
            {playheadTick !== null && (
              <Playhead style={{ left: (playheadTick / step) * stepWidth }} />
            )}
          </Grid>
        )}
      </Sheet>
    </Scroller>
  )
}

function curvePoints(note: MusePatternNote): string {
  const envelope = note.volumeEnvelope
  if (!envelope) return ""
  const points = envelope.points
  return points.map((p) => `${p.t * 100},${100 - p.v * 100}`).join(" ")
}
