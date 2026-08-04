import styled from "@emotion/styled"
import { type FC, useCallback, useRef } from "react"
import { useMobxGetter } from "../../hooks/useMobxSelector"
import { useStores } from "../../hooks/useStores"
import { Localized, useLocalization } from "../../localize/useLocalization"
import {
  analyze,
  loadAudioFile,
  loadMidiFile,
  manifestFor,
} from "../../services/tonemap/pipeline"
import type { ToneMapTab } from "../../stores/ToneMapStore"
import { ToolbarButton } from "../Toolbar/ToolbarButton"
import { Alert } from "../ui/Alert"
import { Button, PrimaryButton } from "../ui/Button"
import {
  Spacer,
  Workspace,
  WorkspaceHeader,
  WorkspaceSubtitle,
  WorkspaceTitle,
} from "../ui/Panel"
import { DramaturgyLane } from "./DramaturgyLane"
import { OrchestrationCompare } from "./OrchestrationCompare"
import { PairedSourceInspector } from "./PairedSourceInspector"
import { ToneMapInspector } from "./ToneMapInspector"

/**
 * Tone map workspace.
 *
 * Four working states over one document: what was loaded, what was
 * understood, what it should mean dramatically, and how it would be played.
 * Everything runs locally – files are read, never uploaded, never written back.
 */

const Body = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
`

const Tabs = styled.div`
  display: flex;
  gap: 0.25rem;
`

const Status = styled.div`
  padding: 0.5rem 1rem;
`

const TABS: { id: ToneMapTab; key: string }[] = [
  { id: "source", key: "tonemap-tab-source" },
  { id: "map", key: "tonemap-tab-map" },
  { id: "dramaturgy", key: "tonemap-tab-dramaturgy" },
  { id: "orchestration", key: "tonemap-tab-orchestration" },
]

export const ToneMapWorkspace: FC = () => {
  const rootStore = useStores()
  const { toneMapStore } = rootStore
  const localized = useLocalization()
  const midiInputRef = useRef<HTMLInputElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)

  const tab = useMobxGetter(toneMapStore, "tab")
  const midi = useMobxGetter(toneMapStore, "midi")
  const audio = useMobxGetter(toneMapStore, "audio")
  const project = useMobxGetter(toneMapStore, "project")
  const busy = useMobxGetter(toneMapStore, "busy")
  const error = useMobxGetter(toneMapStore, "error")

  const runAnalysis = useCallback(() => {
    const current = toneMapStore.midi
    if (!current) return
    const manifest =
      toneMapStore.manifest ??
      manifestFor(current, toneMapStore.audio, {
        id: current.fileName.replace(/\.[^.]+$/, ""),
        title: current.fileName,
      })
    toneMapStore.setBusy(localized["tonemap-analyzing"])
    try {
      const result = analyze({
        midi: current,
        audio: toneMapStore.audio,
        manifest,
        manualAnchors: toneMapStore.manualAnchors,
        projectName: current.fileName,
      })
      toneMapStore.setSource({
        midi: current,
        audio: toneMapStore.audio,
        manifest,
      })
      toneMapStore.setAnalysis(result)
      toneMapStore.setBusy(null)
      toneMapStore.setTab("map")
    } catch (e) {
      toneMapStore.setError(e instanceof Error ? e.message : String(e))
    }
  }, [localized, toneMapStore])

  const onPickMidi = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      toneMapStore.setBusy(localized["tonemap-reading"])
      try {
        const loaded = await loadMidiFile(file)
        toneMapStore.setSource({
          midi: loaded,
          audio: toneMapStore.audio,
          manifest: manifestFor(loaded, toneMapStore.audio, {
            id: file.name.replace(/\.[^.]+$/, ""),
            title: file.name,
          }),
        })
        toneMapStore.setBusy(null)
      } catch (e) {
        toneMapStore.setError(e instanceof Error ? e.message : String(e))
      }
    },
    [localized, toneMapStore],
  )

  const onPickAudio = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      toneMapStore.setBusy(localized["tonemap-decoding"])
      try {
        const loaded = await loadAudioFile(file, {
          getContext: () => rootStore.audioContext,
        })
        const current = toneMapStore.midi
        toneMapStore.setSource({
          midi: current,
          audio: loaded,
          manifest: current
            ? manifestFor(current, loaded, {
                id: current.fileName.replace(/\.[^.]+$/, ""),
                title: current.fileName,
              })
            : toneMapStore.manifest,
        })
        toneMapStore.setBusy(null)
      } catch (e) {
        toneMapStore.setError(e instanceof Error ? e.message : String(e))
      }
    },
    [localized, rootStore, toneMapStore],
  )

  return (
    <Workspace>
      <WorkspaceHeader>
        <div>
          <WorkspaceTitle>
            <Localized name="tonemap-title" />
          </WorkspaceTitle>
          <WorkspaceSubtitle>
            <Localized name="tonemap-subtitle" />
          </WorkspaceSubtitle>
        </div>

        <Tabs>
          {TABS.map((entry) => (
            <ToolbarButton
              key={entry.id}
              selected={tab === entry.id}
              disabled={entry.id !== "source" && project === null}
              onMouseDown={() => toneMapStore.setTab(entry.id)}
            >
              <Localized name={entry.key as "tonemap-tab-source"} />
            </ToolbarButton>
          ))}
        </Tabs>

        <Spacer />

        <input
          ref={midiInputRef}
          type="file"
          accept=".mid,.midi,audio/midi"
          style={{ display: "none" }}
          onChange={(e) => void onPickMidi(e.target.files?.[0])}
        />
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*,.flac,.opus"
          style={{ display: "none" }}
          onChange={(e) => void onPickAudio(e.target.files?.[0])}
        />
        <Button onClick={() => midiInputRef.current?.click()}>
          <Localized name="tonemap-load-midi" />
        </Button>
        <Button onClick={() => audioInputRef.current?.click()}>
          <Localized name="tonemap-load-audio" />
        </Button>
        <PrimaryButton onClick={runAnalysis} disabled={midi === null}>
          <Localized name="tonemap-analyze" />
        </PrimaryButton>
      </WorkspaceHeader>

      {busy !== null && (
        <Status>
          <Alert severity="info">{busy}</Alert>
        </Status>
      )}
      {error !== null && (
        <Status>
          <Alert severity="warning">{error}</Alert>
        </Status>
      )}

      <Body>
        {tab === "source" && (
          <PairedSourceInspector onAnalyze={runAnalysis} hasAudio={!!audio} />
        )}
        {tab === "map" && <ToneMapInspector />}
        {tab === "dramaturgy" && <DramaturgyLane />}
        {tab === "orchestration" && <OrchestrationCompare />}
      </Body>
    </Workspace>
  )
}
