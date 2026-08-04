import styled from "@emotion/styled"
import { LOW_CONFIDENCE } from "@signal-app/tonemap-core"
import { type FC, useCallback, useState } from "react"
import { useMobxGetter } from "../../hooks/useMobxSelector"
import { useStores } from "../../hooks/useStores"
import { Localized, useLocalization } from "../../localize/useLocalization"
import { assetWarnings } from "../../services/tonemap/pipeline"
import { Alert } from "../ui/Alert"
import { Button } from "../ui/Button"
import {
  ConfidenceBadge,
  EmptyState,
  Meta,
  NumberField,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  Spacer,
} from "../ui/Panel"

/**
 * Paired source inspector: what was loaded, what it is allowed to be used
 * for, and how well MIDI and audio line up. The alignment section is
 * deliberately blunt – a weak match is shown as a weak match.
 */

const Columns = styled.div`
  display: grid;
  flex: 1;
  gap: 0.75rem;
  padding: 0.75rem;
  overflow-y: auto;
  grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
  align-content: start;
`

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
`

const Key = styled.span`
  color: var(--color-text-secondary);
  min-width: 8rem;
`

const Value = styled.span`
  color: var(--color-text);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const AnchorRow = styled(Row)`
  border-top: 1px solid var(--color-divider);
  padding-top: 0.4rem;
`

export function confidenceLevel(value: number): "high" | "medium" | "low" {
  if (value < LOW_CONFIDENCE) return "low"
  return value >= 0.75 ? "high" : "medium"
}

export const Confidence: FC<{ value: number }> = ({ value }) => (
  <ConfidenceBadge data-level={confidenceLevel(value)}>
    {(value * 100).toFixed(0)} %
  </ConfidenceBadge>
)

export interface PairedSourceInspectorProps {
  onAnalyze: () => void
  hasAudio: boolean
}

export const PairedSourceInspector: FC<PairedSourceInspectorProps> = ({
  onAnalyze,
  hasAudio,
}) => {
  const { toneMapStore } = useStores()
  const localized = useLocalization()
  const midi = useMobxGetter(toneMapStore, "midi")
  const audio = useMobxGetter(toneMapStore, "audio")
  const manifest = useMobxGetter(toneMapStore, "manifest")
  const alignment = useMobxGetter(toneMapStore, "alignment")
  const manualAnchors = useMobxGetter(toneMapStore, "manualAnchors")

  const [anchorTick, setAnchorTick] = useState(0)
  const [anchorSeconds, setAnchorSeconds] = useState(0)

  const addAnchor = useCallback(() => {
    if (!midi) return
    toneMapStore.addManualAnchor({
      midiTick: anchorTick,
      midiBeat: anchorTick / midi.graph.ticksPerQuarterNote,
      audioTimeSeconds: anchorSeconds,
      confidence: 1,
      method: "manual-anchor",
      manual: true,
    })
    onAnalyze()
  }, [anchorSeconds, anchorTick, midi, onAnalyze, toneMapStore])

  if (!midi) {
    return (
      <EmptyState>
        <Localized name="tonemap-empty" />
      </EmptyState>
    )
  }

  const warnings = manifest ? assetWarnings(manifest) : []

  return (
    <Columns>
      <Panel>
        <PanelHeader>
          <PanelTitle>
            <Localized name="tonemap-source-midi" />
          </PanelTitle>
        </PanelHeader>
        <PanelBody>
          <Row>
            <Key>
              <Localized name="tonemap-file" />
            </Key>
            <Value title={midi.fileName}>{midi.fileName}</Value>
          </Row>
          <Row>
            <Key>
              <Localized name="tonemap-format" />
            </Key>
            <Value>
              MIDI {midi.graph.format} · {midi.graph.tracks.length} ·{" "}
              {midi.graph.ticksPerQuarterNote} ppq
            </Value>
          </Row>
          <Row>
            <Key>
              <Localized name="tonemap-notes" />
            </Key>
            <Value>{midi.graph.notes.length}</Value>
          </Row>
          <Meta>
            <Localized name="tonemap-lossless-note" />
          </Meta>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>
            <Localized name="tonemap-source-audio" />
          </PanelTitle>
        </PanelHeader>
        <PanelBody>
          {audio ? (
            <>
              <Row>
                <Key>
                  <Localized name="tonemap-file" />
                </Key>
                <Value title={audio.fileName}>{audio.fileName}</Value>
              </Row>
              <Row>
                <Key>
                  <Localized name="tonemap-format" />
                </Key>
                <Value>
                  {audio.format} · {audio.pcm.sampleRate} Hz ·{" "}
                  {audio.pcm.channels.length} ch
                </Value>
              </Row>
              <Row>
                <Key>
                  <Localized name="tonemap-duration" />
                </Key>
                <Value>
                  {(audio.pcm.frameCount / audio.pcm.sampleRate).toFixed(1)} s
                </Value>
              </Row>
              <Row>
                <Key>
                  <Localized name="tonemap-extractor" />
                </Key>
                <Value>
                  {audio.features.frameSize}/{audio.features.hopSize} @{" "}
                  {audio.features.sampleRate} Hz
                </Value>
              </Row>
            </>
          ) : (
            <Meta>
              <Localized name="tonemap-no-audio" />
            </Meta>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>
            <Localized name="tonemap-rights" />
          </PanelTitle>
        </PanelHeader>
        <PanelBody>
          <Meta>
            <Localized name="tonemap-rights-note" />
          </Meta>
          {warnings.map((warning) => (
            <Alert key={warning} severity="warning">
              {warning}
            </Alert>
          ))}
          {warnings.length === 0 && (
            <Meta>
              <Localized name="tonemap-rights-ok" />
            </Meta>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitle>
            <Localized name="tonemap-alignment" />
          </PanelTitle>
          <Spacer />
          {alignment && <Confidence value={alignment.globalConfidence} />}
        </PanelHeader>
        <PanelBody>
          {!hasAudio && (
            <Meta>
              <Localized name="tonemap-alignment-needs-audio" />
            </Meta>
          )}
          {alignment && (
            <>
              <Row>
                <Key>
                  <Localized name="tonemap-method" />
                </Key>
                <Value>{alignment.method}</Value>
              </Row>
              <Row>
                <Key>
                  <Localized name="tonemap-anchors" />
                </Key>
                <Value>{alignment.points.length}</Value>
              </Row>
              {alignment.globalConfidence < LOW_CONFIDENCE && (
                <Alert severity="warning">
                  <Localized name="tonemap-low-confidence" />
                </Alert>
              )}
              {alignment.problematicRegions.map((region) => (
                <Meta key={`${region.startTick}-${region.endTick}`}>
                  {region.startTick}–{region.endTick}: {region.reason} (
                  {(region.confidence * 100).toFixed(0)} %)
                </Meta>
              ))}
            </>
          )}

          {manualAnchors.map((anchor, index) => (
            <AnchorRow key={`${anchor.midiTick}-${anchor.audioTimeSeconds}`}>
              <Value>
                {anchor.midiTick} → {anchor.audioTimeSeconds.toFixed(3)} s
              </Value>
              <Spacer />
              <Button onClick={() => toneMapStore.removeManualAnchor(index)}>
                <Localized name="delete" />
              </Button>
            </AnchorRow>
          ))}

          <AnchorRow>
            <Key>
              <Localized name="tonemap-add-anchor" />
            </Key>
            <NumberField
              type="number"
              value={anchorTick}
              onChange={(e) => setAnchorTick(Number(e.target.value) || 0)}
              aria-label={localized["tick"]}
            />
            <NumberField
              type="number"
              step="0.001"
              value={anchorSeconds}
              onChange={(e) => setAnchorSeconds(Number(e.target.value) || 0)}
              aria-label={localized["tonemap-seconds"]}
            />
            <Button onClick={addAnchor} disabled={!hasAudio}>
              <Localized name="add" />
            </Button>
          </AnchorRow>
          <Meta>
            <Localized name="tonemap-anchor-hint" />
          </Meta>
        </PanelBody>
      </Panel>
    </Columns>
  )
}
