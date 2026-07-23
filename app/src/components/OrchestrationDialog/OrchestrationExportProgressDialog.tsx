import { FC, useCallback } from "react"
import { useOrchestrationExport } from "../../hooks/useOrchestrationExport"
import { Localized } from "../../localize/useLocalization"
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "../Dialog/Dialog"
import { Button } from "../ui/Button"
import { LinearProgress } from "../ui/LinearProgress"

export const OrchestrationExportProgressDialog: FC = () => {
  const {
    openOrchestrationExportDialog: open,
    setOpenOrchestrationExportDialog: setOpen,
    progress,
    exportLabel,
    cancelOrchestrationExport,
  } = useOrchestrationExport()

  const onClickCancel = useCallback(() => {
    setOpen(false)
    cancelOrchestrationExport()
  }, [setOpen, cancelOrchestrationExport])

  return (
    <Dialog open={open} style={{ minWidth: "20rem" }}>
      <DialogTitle>
        <Localized name="exporting-audio" />
        {exportLabel.length > 0 && `: ${exportLabel}`}
      </DialogTitle>
      <DialogContent>
        <LinearProgress value={progress} max={1} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClickCancel}>
          <Localized name="cancel" />
        </Button>
      </DialogActions>
    </Dialog>
  )
}
