import styled from "@emotion/styled"
import {
  type FC,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
} from "react"
import type {
  MuseBezierEnvelope,
  MusePatternNote,
  MusePatternTrackLayer,
} from "../../entities/pattern/MusePattern"
import {
  createEnvelope,
  ENVELOPE_PRESETS,
  moveEnvelopePoint,
  PRESET_LABELS,
  sampleEnvelopeCurve,
  setEnvelopeCurve,
} from "../../services/pattern/envelope"
import { pitchName } from "./PatternCanvas"

/**
 * Event details – volume and expression curve of the selected event.
 * Closed by default; it is the second half of the progressive disclosure
 * (opening it collapses the layer rail, see PatternEditor).
 */

const Drawer = styled.section`
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 18px;
  padding: 12px 16px 14px;
  border-top: 1px solid rgba(167, 139, 250, 0.2);
  background: rgba(16, 12, 30, 0.9);
`

const Column = styled.div`
  display: flex;
  min-width: 210px;
  flex-direction: column;
  gap: 8px;
`

const Head = styled.div`
  display: flex;
  gap: 10px;
  align-items: center;
  color: #c4b5fd;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
`

const Curve = styled.svg`
  width: 100%;
  height: 92px;
  border: 1px solid rgba(167, 139, 250, 0.24);
  border-radius: 12px;
  background: rgba(10, 8, 20, 0.75);
  touch-action: none;
`

const Presets = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`

const PresetButton = styled.button<{ on: boolean }>`
  padding: 4px 9px;
  border: 1px solid
    ${({ on }) => (on ? "#a78bfa" : "rgba(255,255,255,0.14)")};
  border-radius: 999px;
  color: ${({ on }) => (on ? "#ede9fe" : "rgba(255,255,255,0.55)")};
  background: ${({ on }) => (on ? "rgba(167,139,250,0.24)" : "transparent")};
  font-size: 10px;
  cursor: pointer;
`

const Field = styled.label`
  display: flex;
  gap: 8px;
  align-items: center;
  color: rgba(255, 255, 255, 0.62);
  font-size: 11px;

  input[type="range"] {
    flex: 1;
    accent-color: #a78bfa;
  }
`

const Value = styled.span`
  min-width: 34px;
  color: #ede9fe;
  font-family: ui-monospace, Menlo, monospace;
  font-size: 11px;
  text-align: right;
`

const DeleteButton = styled.button`
  padding: 7px 12px;
  border: 1px solid rgba(251, 113, 133, 0.5);
  border-radius: 9px;
  color: #fda4af;
  background: rgba(251, 113, 133, 0.12);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
`

const Empty = styled.div`
  padding: 6px 2px;
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
`

interface EnvelopeEditorProps {
  title: string
  envelope: MuseBezierEnvelope | undefined
  color: string
  onChange: (envelope: MuseBezierEnvelope | undefined) => void
}

const EnvelopeEditor: FC<EnvelopeEditorProps> = ({
  title,
  envelope,
  color,
  onChange,
}) => {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragIndex = useRef<number | null>(null)
  const current = envelope ?? createEnvelope("direct")

  const positionFromEvent = useCallback(
    (e: ReactPointerEvent<SVGSVGElement | SVGCircleElement>) => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return null
      return {
        t: (e.clientX - rect.left) / rect.width,
        v: 1 - (e.clientY - rect.top) / rect.height,
      }
    },
    [],
  )

  const handleMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (dragIndex.current === null) return
      const pos = positionFromEvent(e)
      if (!pos) return
      onChange(moveEnvelopePoint(current, dragIndex.current, pos.t, pos.v))
    },
    [current, onChange, positionFromEvent],
  )

  const samples = sampleEnvelopeCurve(current, 48)
  const path = samples.map((p) => `${p.t * 100},${100 - p.v * 100}`).join(" ")

  return (
    <Column>
      <Head>
        <span>{title}</span>
        {envelope && (
          <PresetButton on={false} onClick={() => onChange(undefined)}>
            zurücksetzen
          </PresetButton>
        )}
      </Head>
      <Curve
        ref={svgRef}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onPointerMove={handleMove}
        onPointerUp={() => {
          dragIndex.current = null
        }}
        onPointerLeave={() => {
          dragIndex.current = null
        }}
        role="img"
      >
        <title>{title}</title>
        <polyline
          points={path}
          fill="none"
          stroke={color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {current.points.map((point, index) => (
          <circle
            key={`${point.t}-${index}`}
            cx={point.t * 100}
            cy={100 - point.v * 100}
            r="3.2"
            fill="#ffffff"
            stroke={color}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            style={{ cursor: "grab" }}
            onPointerDown={(e) => {
              e.stopPropagation()
              dragIndex.current = index
              if (!envelope) onChange(current)
            }}
          />
        ))}
      </Curve>
      <Presets>
        {ENVELOPE_PRESETS.map((preset) => (
          <PresetButton
            key={preset}
            on={envelope?.preset === preset}
            onClick={() => onChange(createEnvelope(preset))}
          >
            {PRESET_LABELS[preset]}
          </PresetButton>
        ))}
      </Presets>
      <Field>
        Bogen
        <input
          type="range"
          min={-100}
          max={100}
          value={Math.round(current.curve * 100)}
          onChange={(e) =>
            onChange(setEnvelopeCurve(current, Number(e.target.value) / 100))
          }
        />
        <Value>{current.curve.toFixed(2)}</Value>
      </Field>
    </Column>
  )
}

export interface EventDrawerProps {
  layer: MusePatternTrackLayer | undefined
  note: MusePatternNote | undefined
  gridStepTicks: number
  onSetVelocity: (velocity: number) => void
  onSetDuration: (durationTicks: number) => void
  onSetEnvelope: (
    which: "volumeEnvelope" | "expressionEnvelope",
    envelope: MuseBezierEnvelope | undefined,
  ) => void
  onDelete: () => void
}

export const EventDrawer: FC<EventDrawerProps> = ({
  layer,
  note,
  gridStepTicks,
  onSetVelocity,
  onSetDuration,
  onSetEnvelope,
  onDelete,
}) => {
  if (!layer || !note) {
    return (
      <Drawer>
        <Empty>
          Wähle ein Ereignis auf dem Canvas, um Lautstärke und Ausdruck zu
          gestalten.
        </Empty>
      </Drawer>
    )
  }

  const steps = Math.max(1, Math.round(note.durationTicks / gridStepTicks))

  return (
    <Drawer>
      <Column>
        <Head>
          <span>
            {layer.kind === "melodic" ? pitchName(note.noteNumber) : layer.name}
          </span>
          <DeleteButton onClick={onDelete}>Löschen</DeleteButton>
        </Head>
        <Field>
          Anschlag
          <input
            type="range"
            min={1}
            max={127}
            value={note.velocity}
            onChange={(e) => onSetVelocity(Number(e.target.value))}
          />
          <Value>{note.velocity}</Value>
        </Field>
        <Field>
          Länge
          <input
            type="range"
            min={1}
            max={32}
            value={steps}
            onChange={(e) =>
              onSetDuration(Number(e.target.value) * gridStepTicks)
            }
          />
          <Value>{steps}</Value>
        </Field>
      </Column>

      <EnvelopeEditor
        title="Lautstärke"
        color="#a78bfa"
        envelope={note.volumeEnvelope}
        onChange={(envelope) => onSetEnvelope("volumeEnvelope", envelope)}
      />
      <EnvelopeEditor
        title="Ausdruck"
        color="#f472b6"
        envelope={note.expressionEnvelope}
        onChange={(envelope) => onSetEnvelope("expressionEnvelope", envelope)}
      />
    </Drawer>
  )
}
