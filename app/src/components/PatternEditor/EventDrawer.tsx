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
import { Localized, useLocalization } from "../../localize/useLocalization"
import {
  createEnvelope,
  ENVELOPE_PRESETS,
  moveEnvelopePoint,
  PRESET_LABEL_KEYS,
  sampleEnvelopeCurve,
  setEnvelopeCurve,
} from "../../services/pattern/envelope"
import { Button } from "../ui/Button"
import { Chip, EmptyState } from "../ui/Panel"
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
  gap: 1.25rem;
  padding: 0.75rem 1rem;
  border-top: 1px solid var(--color-divider);
  background: var(--color-background);
`

const Column = styled.div`
  display: flex;
  min-width: 13rem;
  flex-direction: column;
  gap: 0.4rem;
`

const Head = styled.div`
  display: flex;
  gap: 0.5rem;
  align-items: center;
  color: var(--color-text-secondary);
  font-size: 0.7rem;
  font-weight: 600;
`

const Curve = styled.svg`
  width: 100%;
  height: 5rem;
  border: 1px solid var(--color-divider);
  border-radius: 0.3rem;
  background: var(--color-editor-background);
  touch-action: none;
`

const Presets = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
`

const Field = styled.label`
  display: flex;
  gap: 0.5rem;
  align-items: center;
  color: var(--color-text-secondary);
  font-size: 0.7rem;

  input[type="range"] {
    flex: 1;
    accent-color: var(--color-theme);
  }
`

const Value = styled.span`
  min-width: 2.2rem;
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  text-align: right;
`

const DeleteButton = styled(Button)`
  height: 1.5rem;
  padding: 0 0.5rem;
  font-size: 0.7rem;
  color: var(--color-text-secondary);

  &:hover {
    color: var(--color-red);
  }
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
          <Chip onClick={() => onChange(undefined)}>
            <Localized name="pattern-envelope-reset" />
          </Chip>
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
            fill="var(--color-background)"
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
          <Chip
            key={preset}
            data-selected={envelope?.preset === preset}
            onClick={() => onChange(createEnvelope(preset))}
          >
            <Localized name={PRESET_LABEL_KEYS[preset]} />
          </Chip>
        ))}
      </Presets>
      <Field>
        <Localized name="pattern-envelope-bend" />
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
  const localized = useLocalization()

  if (!layer || !note) {
    return (
      <Drawer>
        <EmptyState>
          <Localized name="pattern-no-event" />
        </EmptyState>
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
          <DeleteButton onClick={onDelete}>
            <Localized name="delete" />
          </DeleteButton>
        </Head>
        <Field>
          <Localized name="pattern-velocity" />
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
          <Localized name="pattern-length" />
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
        title={localized["pattern-volume-curve"]}
        color="var(--color-theme)"
        envelope={note.volumeEnvelope}
        onChange={(envelope) => onSetEnvelope("volumeEnvelope", envelope)}
      />
      <EnvelopeEditor
        title={localized["pattern-expression-curve"]}
        color="var(--color-yellow)"
        envelope={note.expressionEnvelope}
        onChange={(envelope) => onSetEnvelope("expressionEnvelope", envelope)}
      />
    </Drawer>
  )
}
