import styled from "@emotion/styled"
import { FC } from "react"
import { useDisableBounceScroll } from "../../hooks/useDisableBounceScroll"
import { useDisableBrowserContextMenu } from "../../hooks/useDisableBrowserContextMenu"
import { useDisableZoom } from "../../hooks/useDisableZoom"
import { useGlobalKeyboardShortcut } from "../../hooks/useGlobalKeyboardShortcut"
import { useRouter } from "../../hooks/useRouter"
import { ArrangeEditor } from "../ArrangeView/ArrangeEditor"
import { BuildInfo } from "../BuildInfo"
import { ControlSettingDialog } from "../ControlSettingDialog/ControlSettingDialog"
import { ExportProgressDialog } from "../ExportDialog/ExportProgressDialog"
import { Head } from "../Head/Head"
import { HelpDialog } from "../Help/HelpDialog"
import { HummingDialog } from "../HummingDialog/HummingDialog"
import { JamRoom } from "../JamRoom/JamRoom"
import { ScanSequencer } from "../JamRoom/ScanSequencer"
import { Navigation } from "../Navigation/Navigation"
import { OnBeforeUnload } from "../OnBeforeUnload/OnBeforeUnload"
import { OnInit } from "../OnInit/OnInit"
import { OrchestrationDialog } from "../OrchestrationDialog/OrchestrationDialog"
import { OrchestrationExportProgressDialog } from "../OrchestrationDialog/OrchestrationExportProgressDialog"
import { PatternWorkspace } from "../PatternEditor/PatternWorkspace"
import { PianoRollEditor } from "../PianoRoll/PianoRollEditor"
import { SettingDialog } from "../SettingDialog/SettingDialog"
import { TempoEditor } from "../TempoGraph/TempoEditor"
import { ToneMapWorkspace } from "../ToneMap/ToneMapWorkspace"
import { TransportPanel } from "../TransportPanel/TransportPanel"
import { DropZone } from "./DropZone"

const Container = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  overflow: hidden;
`

const Column = styled.div`
  height: 100%;
  display: flex;
  flex-grow: 1;
  flex-direction: column;
  outline: none;
`

const Routes: FC = () => {
  const { path } = useRouter()
  return (
    <>
      {path === "/track" && <PianoRollEditor />}
      {path === "/tempo" && <TempoEditor />}
      {path === "/arrange" && <ArrangeEditor />}
      {path === "/jam" && <JamRoom />}
      {path === "/jam-grid" && <PatternWorkspace />}
      {path === "/jam-scan" && <ScanSequencer />}
      {path === "/tonemap" && <ToneMapWorkspace />}
    </>
  )
}

export const RootView: FC = () => {
  const keyboardShortcutProps = useGlobalKeyboardShortcut()
  useDisableZoom()
  useDisableBounceScroll()
  useDisableBrowserContextMenu()

  return (
    <>
      <DropZone>
        <Column {...keyboardShortcutProps} tabIndex={0}>
          <Navigation />
          <Container>
            <Routes />
            <TransportPanel />
            <BuildInfo />
          </Container>
        </Column>
      </DropZone>
      <HelpDialog />
      <ExportProgressDialog />
      <Head />
      <SettingDialog />
      <ControlSettingDialog />
      <OrchestrationDialog />
      <OrchestrationExportProgressDialog />
      <HummingDialog />
      <OnInit />
      <OnBeforeUnload />
    </>
  )
}
