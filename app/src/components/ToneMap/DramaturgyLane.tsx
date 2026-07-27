import styled from "@emotion/styled"
import type { EmotionAxis, MotifDirection } from "@signal-app/tonemap-core"
import { createProvenance, EMOTION_AXES } from "@signal-app/tonemap-core"
import { type FC, useCallback, useState } from "react"
import { useMobxGetter } from "../../hooks/useMobxSelector"
import { useStores } from "../../hooks/useStores"
import { Localized, useLocalization } from "../../localize/useLocalization"
import { Button, PrimaryButton } from "../ui/Button"
import {
  Chip,
  EmptyState,
  InlineInput,
  InlineSelect,
  Meta,
  NumberField,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  Spacer,
} from "../ui/Panel"

/**
 * Dramaturgy lane: what a motif is supposed to *mean* at a point in time.
 *
 * This is the bridge to Adaptive Pathos. The free text field is kept
 * verbatim – there is no intent interpreter yet and none is assumed, so
 * nothing a user writes here gets normalized away.
 */

const Layout = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  overflow-y: auto;
`

const Lane = styled.div`
  position: relative;
  height: 4rem;
  border: 1px solid var(--color-divider);
  border-radius: 0.3rem;
  background: var(--color-editor-background);
  overflow: hidden;
`

const Marker = styled.button`
  position: absolute;
  top: 0.4rem;
  bottom: 0.4rem;
  width: 0.4rem;
  margin-left: -0.2rem;
  padding: 0;
  border: none;
  border-radius: 0.2rem;
  background: var(--color-theme);
  cursor: pointer;
  outline: none;

  &[data-selected="true"] {
    background: var(--color-record);
  }
`

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
`

const Axes = styled.div`
  display: grid;
  gap: 0.25rem 0.75rem;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
`

const AxisRow = styled.label`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.7rem;
  color: var(--color-text-secondary);

  input[type="range"] {
    flex: 1;
    accent-color: var(--color-theme);
  }
`

const DirectionCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--color-divider);
`

export const DramaturgyLane: FC = () => {
  const { toneMapStore } = useStores()
  const localized = useLocalization()
  const project = useMobxGetter(toneMapStore, "project")
  const motifGraph = useMobxGetter(toneMapStore, "motifGraph")

  const [motifId, setMotifId] = useState("")
  const [startTick, setStartTick] = useState(0)
  const [freeText, setFreeText] = useState("")
  const [axes, setAxes] = useState<Partial<Record<EmotionAxis, number>>>({})
  const [preserveIdentity, setPreserveIdentity] = useState(true)
  const [preserveRhythm, setPreserveRhythm] = useState(true)
  const [preserveContour, setPreserveContour] = useState(true)

  const add = useCallback(() => {
    const motif = motifId || motifGraph?.motifs[0]?.id
    if (!motif) return
    const direction: MotifDirection = {
      id: `dir-${motif}-${startTick}`,
      motifId: motif,
      trigger: { type: "tick", startTick },
      preserve: {
        identity: preserveIdentity,
        rhythm: preserveRhythm,
        contour: preserveContour,
      },
      emotionalIntent:
        Object.keys(axes).length > 0 || freeText.length > 0
          ? { axes, tags: freeText.length > 0 ? [freeText] : [] }
          : undefined,
      freeTextIntent: freeText.length > 0 ? freeText : undefined,
      provenance: createProvenance({
        source: "user",
        status: "manually-confirmed",
        confidence: 1,
        extractionMethod: "motif-direction",
      }),
    }
    toneMapStore.addDirection(direction)
  }, [
    axes,
    freeText,
    motifId,
    motifGraph,
    preserveContour,
    preserveIdentity,
    preserveRhythm,
    startTick,
    toneMapStore,
  ])

  if (!project || !motifGraph) {
    return (
      <EmptyState>
        <Localized name="tonemap-empty" />
      </EmptyState>
    )
  }

  if (motifGraph.motifs.length === 0) {
    return (
      <EmptyState>
        <Localized name="tonemap-no-motifs" />
      </EmptyState>
    )
  }

  const totalTicks = Math.max(
    1,
    ...project.nodes.map((node) => node.range?.endTick ?? 0),
  )

  return (
    <Layout>
      <Panel>
        <PanelHeader>
          <PanelTitle>
            <Localized name="tonemap-motifs" />
          </PanelTitle>
          <Spacer />
          <Meta>{motifGraph.motifs.length}</Meta>
        </PanelHeader>
        <PanelBody>
          <Lane>
            {project.directions.map((direction) => (
              <Marker
                key={direction.id}
                type="button"
                title={direction.freeTextIntent ?? direction.motifId}
                style={{
                  left: `${
                    ((direction.trigger.type === "tick"
                      ? direction.trigger.startTick
                      : 0) /
                      totalTicks) *
                    100
                  }%`,
                }}
                onClick={() => toneMapStore.removeDirection(direction.id)}
              />
            ))}
          </Lane>
          <Meta>
            <Localized name="tonemap-lane-hint" />
          </Meta>
          {motifGraph.motifs.map((motif) => (
            <Row key={motif.id}>
              <Chip
                data-selected={motifId === motif.id}
                onClick={() => setMotifId(motif.id)}
              >
                {motif.id}
              </Chip>
              <Meta>
                {motif.occurrences.length}× ·{" "}
                {motif.intervals.map((i) => (i > 0 ? `+${i}` : i)).join(" ")}
              </Meta>
            </Row>
          ))}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>
            <Localized name="tonemap-new-direction" />
          </PanelTitle>
        </PanelHeader>
        <PanelBody>
          <Row>
            <Localized name="tonemap-motif" />
            <InlineSelect
              value={motifId}
              onChange={(e) => setMotifId(e.target.value)}
              aria-label={localized["tonemap-motif"]}
            >
              <option value="">–</option>
              {motifGraph.motifs.map((motif) => (
                <option key={motif.id} value={motif.id}>
                  {motif.id}
                </option>
              ))}
            </InlineSelect>
            <Localized name="tick" />
            <NumberField
              type="number"
              value={startTick}
              onChange={(e) => setStartTick(Number(e.target.value) || 0)}
              aria-label={localized["tick"]}
            />
          </Row>

          <Row>
            <Localized name="tonemap-preserve" />
            <Chip
              data-selected={preserveIdentity}
              onClick={() => setPreserveIdentity((v) => !v)}
            >
              <Localized name="tonemap-preserve-identity" />
            </Chip>
            <Chip
              data-selected={preserveRhythm}
              onClick={() => setPreserveRhythm((v) => !v)}
            >
              <Localized name="tonemap-preserve-rhythm" />
            </Chip>
            <Chip
              data-selected={preserveContour}
              onClick={() => setPreserveContour((v) => !v)}
            >
              <Localized name="tonemap-preserve-contour" />
            </Chip>
          </Row>

          <Axes>
            {EMOTION_AXES.map((axis) => (
              <AxisRow key={axis}>
                <span style={{ minWidth: "6rem" }}>{axis}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round((axes[axis] ?? 0) * 100)}
                  onChange={(e) =>
                    setAxes((current) => ({
                      ...current,
                      [axis]: Number(e.target.value) / 100,
                    }))
                  }
                />
              </AxisRow>
            ))}
          </Axes>

          <Row>
            <Localized name="tonemap-free-intent" />
            <InlineInput
              style={{ flex: 1, minWidth: "12rem" }}
              value={freeText}
              placeholder={localized["tonemap-free-intent-placeholder"]}
              onChange={(e) => setFreeText(e.target.value)}
              aria-label={localized["tonemap-free-intent"]}
            />
            <PrimaryButton onClick={add}>
              <Localized name="add" />
            </PrimaryButton>
          </Row>
          <Meta>
            <Localized name="tonemap-free-intent-note" />
          </Meta>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>
            <Localized name="tonemap-directions" />
          </PanelTitle>
          <Spacer />
          <Meta>{project.directions.length}</Meta>
        </PanelHeader>
        <PanelBody>
          {project.directions.length === 0 && (
            <Meta>
              <Localized name="tonemap-no-directions" />
            </Meta>
          )}
          {project.directions.map((direction) => (
            <DirectionCard key={direction.id}>
              <Row>
                <strong>{direction.motifId}</strong>
                <Meta>
                  {direction.trigger.type === "tick"
                    ? `tick ${direction.trigger.startTick}`
                    : direction.trigger.type}
                </Meta>
                <Spacer />
                <Button
                  onClick={() => toneMapStore.removeDirection(direction.id)}
                >
                  <Localized name="delete" />
                </Button>
              </Row>
              {direction.freeTextIntent && (
                <Meta>„{direction.freeTextIntent}“</Meta>
              )}
              <Meta>
                {Object.entries(direction.emotionalIntent?.axes ?? {})
                  .filter(([, value]) => (value ?? 0) > 0)
                  .map(([axis, value]) => `${axis} ${(value ?? 0).toFixed(2)}`)
                  .join(" · ") || "–"}
              </Meta>
            </DirectionCard>
          ))}
        </PanelBody>
      </Panel>
    </Layout>
  )
}
