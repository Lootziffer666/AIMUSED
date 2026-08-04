import styled from "@emotion/styled"
import type {
  MusicalFunction,
  ToneMapObservation,
} from "@signal-app/tonemap-core"
import {
  createProvenance,
  MUSICAL_FUNCTIONS,
  PROMINENCE_STATES,
  TIMBRE_AXES,
} from "@signal-app/tonemap-core"
import { type FC, useCallback } from "react"
import { useMobxGetter } from "../../hooks/useMobxSelector"
import { useStores } from "../../hooks/useStores"
import { Localized, useLocalization } from "../../localize/useLocalization"
import {
  EmptyState,
  InlineSelect,
  Meta,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  Spacer,
} from "../ui/Panel"
import { Confidence } from "./PairedSourceInspector"

/**
 * Tone map inspector: one row per observed voice.
 *
 * Every derived claim carries its confidence and the evidence it came from.
 * Correcting a claim replaces it with a manually confirmed one – automation
 * never overwrites a human decision afterwards.
 */

const Layout = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
`

const List = styled.div`
  display: flex;
  width: 22rem;
  flex-shrink: 0;
  flex-direction: column;
  overflow-y: auto;
  border-right: 1px solid var(--color-divider);
`

const Item = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--color-divider);
  cursor: pointer;
  outline: none;

  &:hover {
    background: var(--color-highlight);
  }

  &[data-selected="true"] {
    background: var(--color-highlight);
  }
`

const ItemTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8rem;
  font-weight: 600;
`

const Detail = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  overflow-y: auto;
`

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
`

const Key = styled.span`
  color: var(--color-text-secondary);
  min-width: 9rem;
`

const Value = styled.span`
  color: var(--color-text);
  font-family: var(--font-mono);
`

const Axes = styled.div`
  display: grid;
  gap: 0.25rem 0.75rem;
  grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
`

const Axis = styled.div`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.7rem;
  color: var(--color-text-secondary);
`

const Bar = styled.div`
  position: relative;
  flex: 1;
  height: 0.35rem;
  border-radius: 999px;
  background: var(--color-background-secondary);
  overflow: hidden;

  span {
    position: absolute;
    inset: 0 auto 0 0;
    background: var(--color-theme);
  }
`

export const ToneMapInspector: FC = () => {
  const { toneMapStore } = useStores()
  const localized = useLocalization()
  const project = useMobxGetter(toneMapStore, "project")
  const selectedNodeId = useMobxGetter(toneMapStore, "selectedNodeId")

  const correctFunction = useCallback(
    (observation: ToneMapObservation, value: MusicalFunction) => {
      toneMapStore.updateObservation(observation.id, (entry) => ({
        ...entry,
        musicalFunction: {
          value,
          provenance: createProvenance({
            source: "user",
            status: "manually-confirmed",
            confidence: 1,
            extractionMethod: "manual-correction",
            evidence: [
              {
                kind: "user-input",
                ref: entry.musicalFunction.value,
                detail: `corrected from ${entry.musicalFunction.value} (${(
                  entry.musicalFunction.provenance.confidence * 100
                ).toFixed(0)} %)`,
              },
            ],
          }),
        },
      }))
    },
    [toneMapStore],
  )

  const correctProminence = useCallback(
    (observation: ToneMapObservation, state: string) => {
      toneMapStore.updateObservation(observation.id, (entry) => ({
        ...entry,
        prominence: {
          value: {
            ...entry.prominence.value,
            state: state as (typeof PROMINENCE_STATES)[number],
          },
          provenance: createProvenance({
            source: "user",
            status: "manually-confirmed",
            confidence: 1,
            extractionMethod: "manual-correction",
          }),
        },
      }))
    },
    [toneMapStore],
  )

  if (!project) {
    return (
      <EmptyState>
        <Localized name="tonemap-empty" />
      </EmptyState>
    )
  }

  const nodeLabel = (id: string) =>
    project.nodes.find((node) => node.id === id)?.label ?? id

  const selected =
    project.observations.find((o) => o.sourceRef === selectedNodeId) ??
    project.observations[0]

  return (
    <Layout>
      <List>
        {project.observations.map((observation) => (
          <Item
            key={observation.id}
            tabIndex={0}
            data-selected={observation.id === selected?.id}
            onClick={() => toneMapStore.setSelectedNode(observation.sourceRef)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                toneMapStore.setSelectedNode(observation.sourceRef)
              }
            }}
          >
            <ItemTitle>
              {nodeLabel(observation.sourceRef)}
              <Spacer />
              <Confidence value={observation.confidence} />
            </ItemTitle>
            <Meta>
              {observation.musicalFunction.value} ·{" "}
              {observation.prominence.value.state} ·{" "}
              {observation.register.lowestMidi}–
              {observation.register.highestMidi}
            </Meta>
          </Item>
        ))}
      </List>

      {selected && (
        <Detail>
          <Panel>
            <PanelHeader>
              <PanelTitle>
                <Localized name="tonemap-function" />
              </PanelTitle>
              <Spacer />
              <Confidence
                value={selected.musicalFunction.provenance.confidence}
              />
            </PanelHeader>
            <PanelBody>
              <Row>
                <Key>
                  <Localized name="tonemap-function" />
                </Key>
                <InlineSelect
                  value={selected.musicalFunction.value}
                  onChange={(e) =>
                    correctFunction(selected, e.target.value as MusicalFunction)
                  }
                  aria-label={localized["tonemap-function"]}
                >
                  {MUSICAL_FUNCTIONS.map((fn) => (
                    <option key={fn} value={fn}>
                      {fn}
                    </option>
                  ))}
                </InlineSelect>
              </Row>
              <Row>
                <Key>
                  <Localized name="tonemap-prominence" />
                </Key>
                <InlineSelect
                  value={selected.prominence.value.state}
                  onChange={(e) => correctProminence(selected, e.target.value)}
                  aria-label={localized["tonemap-prominence"]}
                >
                  {PROMINENCE_STATES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </InlineSelect>
                <Value>{selected.prominence.value.level.toFixed(2)}</Value>
              </Row>
              <Row>
                <Key>
                  <Localized name="tonemap-method" />
                </Key>
                <Value>
                  {selected.musicalFunction.provenance.extractionMethod}
                </Value>
              </Row>
              <Meta>
                <Localized name="tonemap-evidence" />:{" "}
                {selected.musicalFunction.provenance.evidence
                  .map((e) => `${e.ref}${e.detail ? ` (${e.detail})` : ""}`)
                  .join(", ") || "–"}
              </Meta>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <PanelTitle>
                <Localized name="tonemap-register" />
              </PanelTitle>
            </PanelHeader>
            <PanelBody>
              <Row>
                <Key>
                  <Localized name="tonemap-range" />
                </Key>
                <Value>
                  {selected.register.lowestMidi}–{selected.register.highestMidi}{" "}
                  (centre {selected.register.centroidMidi.toFixed(1)})
                </Value>
              </Row>
              {selected.symbolicFeatures && (
                <>
                  <Row>
                    <Key>
                      <Localized name="tonemap-density" />
                    </Key>
                    <Value>
                      {selected.symbolicFeatures.noteDensityPerBeat.toFixed(2)}{" "}
                      / beat · {selected.symbolicFeatures.noteCount}{" "}
                      <Localized name="tonemap-notes" />
                    </Value>
                  </Row>
                  <Row>
                    <Key>
                      <Localized name="tonemap-polyphony" />
                    </Key>
                    <Value>
                      {selected.symbolicFeatures.polyphony.toFixed(2)}
                      {selected.symbolicFeatures.isMonophonic ? " (mono)" : ""}
                    </Value>
                  </Row>
                </>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <PanelTitle>
                <Localized name="tonemap-timbre" />
              </PanelTitle>
              <Spacer />
              <Meta>
                {selected.acousticFeatures ? (
                  <Localized name="tonemap-timbre-measured" />
                ) : (
                  <Localized name="tonemap-timbre-symbolic" />
                )}
              </Meta>
            </PanelHeader>
            <PanelBody>
              <Axes>
                {TIMBRE_AXES.filter(
                  (axis) => selected.timbreIntent[axis] !== undefined,
                ).map((axis) => (
                  <Axis key={axis}>
                    <span style={{ minWidth: "5.5rem" }}>{axis}</span>
                    <Bar>
                      <span
                        style={{
                          width: `${(selected.timbreIntent[axis] ?? 0) * 100}%`,
                        }}
                      />
                    </Bar>
                  </Axis>
                ))}
              </Axes>
            </PanelBody>
          </Panel>
        </Detail>
      )}
    </Layout>
  )
}
