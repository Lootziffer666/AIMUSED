import styled from "@emotion/styled"
import type {
  OrchestrationPlan,
  PatchCandidate,
  PlanPart,
} from "@signal-app/tonemap-core"
import {
  assignInstrument,
  createPlanFromGraph,
  createProvenance,
  createTrainingRecord,
  doublePart,
  encodeFeatures,
  exportTrainingRecordsAsJsonl,
  HeuristicPatchRanker,
  type JUDGEMENT_TAGS,
  transposePart,
  undoLastOperation,
} from "@signal-app/tonemap-core"
import { useToast } from "dialog-hooks"
import { type FC, useCallback, useMemo } from "react"
import { useMobxGetter } from "../../hooks/useMobxSelector"
import { useStores } from "../../hooks/useStores"
import { Localized, useLocalization } from "../../localize/useLocalization"
import { applyPlanToSong } from "../../services/tonemap/planSongAdapter"
import { Alert } from "../ui/Alert"
import { Button, PrimaryButton } from "../ui/Button"
import {
  Chip,
  EmptyState,
  Meta,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  Spacer,
} from "../ui/Panel"
import { Confidence } from "./PairedSourceInspector"

/**
 * Orchestration compare: source part on the left, proposal on the right.
 *
 * The plan never touches the imported MIDI. Every operation carries a reason
 * and an undo snapshot, and every accepted or rejected suggestion can become
 * a training record – including the case where the "wrong" candidate was the
 * better one.
 */

const Layout = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
`

const Parts = styled.div`
  display: flex;
  width: 18rem;
  flex-shrink: 0;
  flex-direction: column;
  overflow-y: auto;
  border-right: 1px solid var(--color-divider);
`

const PartItem = styled.div`
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
  flex-wrap: wrap;
  font-size: 0.75rem;
`

const CandidateRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--color-divider);

  &:last-child {
    border-bottom: none;
  }
`

const ranker = new HeuristicPatchRanker()

export const OrchestrationCompare: FC = () => {
  const { toneMapStore, songStore } = useStores()
  const toast = useToast()
  const localized = useLocalization()
  const project = useMobxGetter(toneMapStore, "project")
  const motifGraph = useMobxGetter(toneMapStore, "motifGraph")
  const midi = useMobxGetter(toneMapStore, "midi")
  const plan = useMobxGetter(toneMapStore, "plan")
  const libraries = useMobxGetter(toneMapStore, "libraries")
  const selectedPartId = useMobxGetter(toneMapStore, "selectedPartId")
  const trainingRecords = useMobxGetter(toneMapStore, "trainingRecords")

  const createPlan = useCallback(() => {
    if (!midi || !motifGraph || !project) return
    toneMapStore.setPlan(
      createPlanFromGraph(midi.graph, motifGraph, {
        toneMapProjectId: project.id,
      }),
    )
  }, [midi, motifGraph, project, toneMapStore])

  const selected: PlanPart | undefined = plan?.parts.find(
    (part) => part.id === selectedPartId,
  )

  const observation = useMemo(
    () =>
      project?.observations.find(
        (o) => o.sourceRef === selected?.sourceVoiceId,
      ),
    [project, selected],
  )

  const candidates: PatchCandidate[] = useMemo(() => {
    if (!observation) return []
    return ranker.rank(
      {
        musicalFunction: observation.musicalFunction.value,
        register: observation.register,
        desiredTimbre: observation.timbreIntent,
        articulation: selected?.articulation,
        limit: 5,
      },
      libraries,
    )
  }, [libraries, observation, selected])

  const apply = useCallback(
    (candidate: PatchCandidate, tag: (typeof JUDGEMENT_TAGS)[number]) => {
      if (!plan || !selected || !observation) return
      const next: OrchestrationPlan = assignInstrument(
        plan,
        selected.id,
        {
          family: candidate.family,
          instrument: candidate.instrument,
          articulation: candidate.articulation,
        },
        {
          reason: candidate.reasons[0] ?? "chosen in the orchestration compare",
        },
      )
      toneMapStore.setPlan(next)
      toneMapStore.addTrainingRecord(
        createTrainingRecord({
          id: `train-${observation.id}-${candidate.patchId}-${plan.operations.length}`,
          sourcePairId: toneMapStore.manifest?.id ?? plan.toneMapProjectId,
          segmentRef: observation.sourceRef,
          features: encodeFeatures({
            musicalFunction: observation.musicalFunction.value,
            register: observation.register,
            symbolic: observation.symbolicFeatures,
            acoustic: observation.acousticFeatures,
            timbre: observation.timbreIntent,
            emotion: observation.emotionalIntent,
            context: { prominence: observation.prominence.value.level },
          }),
          candidates,
          selectedCandidate: candidate.patchId,
          requestedIntent: observation.emotionalIntent,
          humanJudgement: {
            // "serendipitous-alternative" is accepted too: it did not match
            // the intent but it was the better choice.
            accepted: true,
            tags: [tag],
          },
          provenance: createProvenance({
            source: "user",
            status: "manually-confirmed",
            confidence: 1,
            extractionMethod: `judgement-on-${ranker.name}`,
          }),
        }),
      )
    },
    [candidates, observation, plan, selected, toneMapStore],
  )

  /**
   * The plan made audible without any external renderer: the same channel
   * and program decisions the render adapters make, written into the song.
   */
  const sendToSong = useCallback(() => {
    if (!plan) return
    const chosen: Record<string, PatchCandidate> = {}
    if (observation && selected && candidates[0]) {
      chosen[selected.id] = candidates[0]
    }
    const result = applyPlanToSong(songStore.song, plan, {
      patches: chosen,
      binding: toneMapStore.planBinding,
    })
    toneMapStore.setPlanBinding(result.binding)
    for (const warning of result.warnings) toast.info(warning)
    toast.success(
      `${localized["tonemap-sent-to-song"]}: ${Object.keys(result.binding).length}`,
    )
  }, [
    candidates,
    localized,
    observation,
    plan,
    selected,
    songStore.song,
    toast,
    toneMapStore,
  ])

  const exportTraining = useCallback(() => {
    const jsonl = exportTrainingRecordsAsJsonl(trainingRecords)
    const blob = new Blob([jsonl], { type: "application/x-ndjson" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "tonemap-training.jsonl"
    link.click()
    URL.revokeObjectURL(url)
    toast.success(
      `${localized["tonemap-training-exported"]}: ${trainingRecords.length}`,
    )
  }, [localized, toast, trainingRecords])

  if (!project || !motifGraph || !midi) {
    return (
      <EmptyState>
        <Localized name="tonemap-empty" />
      </EmptyState>
    )
  }

  if (!plan) {
    return (
      <EmptyState>
        <Localized name="tonemap-no-plan" />
        <div style={{ marginTop: "1rem" }}>
          <PrimaryButton onClick={createPlan}>
            <Localized name="tonemap-create-plan" />
          </PrimaryButton>
        </div>
      </EmptyState>
    )
  }

  return (
    <Layout>
      <Parts>
        {plan.parts.map((part) => (
          <PartItem
            key={part.id}
            tabIndex={0}
            data-selected={part.id === selectedPartId}
            onClick={() => toneMapStore.setSelectedPart(part.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                toneMapStore.setSelectedPart(part.id)
              }
            }}
          >
            <strong>{part.label}</strong>
            <Meta>
              {part.notes.length} ·{" "}
              {part.instrument ?? localized["tonemap-unassigned"]}
            </Meta>
          </PartItem>
        ))}
      </Parts>

      <Detail>
        <Row>
          <Button
            onClick={() => toneMapStore.setPlan(undoLastOperation(plan))}
            disabled={plan.operations.length === 0}
          >
            <Localized name="orchestration-undo" />
          </Button>
          <Button
            onClick={() =>
              selected &&
              toneMapStore.setPlan(
                doublePart(plan, selected.id, { semitones: 12 }),
              )
            }
            disabled={!selected}
          >
            <Localized name="tonemap-octave-double" />
          </Button>
          <Button
            onClick={() =>
              selected &&
              toneMapStore.setPlan(transposePart(plan, selected.id, -12))
            }
            disabled={!selected}
          >
            <Localized name="tonemap-transpose-down" />
          </Button>
          <Spacer />
          <PrimaryButton onClick={sendToSong}>
            <Localized name="tonemap-to-song" />
          </PrimaryButton>
          <Button
            onClick={exportTraining}
            disabled={trainingRecords.length === 0}
          >
            <Localized name="tonemap-export-training" /> (
            {trainingRecords.length})
          </Button>
        </Row>

        {plan.warnings.map((warning) => (
          <Alert
            key={`${warning.code}-${warning.partId}-${warning.message}`}
            severity={warning.severity === "warning" ? "warning" : "info"}
          >
            {warning.message}
          </Alert>
        ))}

        <Panel>
          <PanelHeader>
            <PanelTitle>
              <Localized name="tonemap-candidates" />
            </PanelTitle>
            <Spacer />
            <Meta>{ranker.name}</Meta>
          </PanelHeader>
          <PanelBody>
            {!observation && (
              <Meta>
                <Localized name="tonemap-no-observation" />
              </Meta>
            )}
            {candidates.map((candidate) => (
              <CandidateRow key={candidate.patchId}>
                <Row>
                  <strong>{candidate.displayName}</strong>
                  <Meta>
                    {candidate.family} · {candidate.articulation}
                  </Meta>
                  <Spacer />
                  <Confidence value={candidate.score} />
                </Row>
                <Meta>{candidate.reasons.join(" · ")}</Meta>
                <Row>
                  <Chip onClick={() => apply(candidate, "good-fit")}>
                    <Localized name="tonemap-choose" />
                  </Chip>
                  <Chip
                    onClick={() =>
                      apply(candidate, "serendipitous-alternative")
                    }
                    title={localized["tonemap-serendipity-hint"]}
                  >
                    <Localized name="tonemap-serendipity" />
                  </Chip>
                </Row>
              </CandidateRow>
            ))}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>
              <Localized name="tonemap-operations" />
            </PanelTitle>
            <Spacer />
            <Meta>{plan.operations.length}</Meta>
          </PanelHeader>
          <PanelBody>
            {plan.operations.length === 0 && (
              <Meta>
                <Localized name="tonemap-no-operations" />
              </Meta>
            )}
            {plan.operations.map((operation) => (
              <Row key={operation.id}>
                <strong>{operation.kind}</strong>
                <Meta>{operation.reason}</Meta>
                <Spacer />
                <Confidence value={operation.confidence} />
              </Row>
            ))}
          </PanelBody>
        </Panel>
      </Detail>
    </Layout>
  )
}
