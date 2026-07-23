import styled from "@emotion/styled"
import type { TrackEventOf } from "@signal-app/core"
import type { MuseDecisionOrigin } from "@signal-app/orchestration-core"
import type { ProgramChangeEvent } from "midifile-ts"
import { type FC, useCallback, useMemo, useState } from "react"
import type { TickTransform } from "../../entities/transform/TickTransform"
import { observeDrag2 } from "../../helpers/observeDrag"
import { useHistory } from "../../hooks/useHistory"
import { useTrackOrchestrationOrigin } from "../../hooks/useOrchestration"
import { usePianoRoll } from "../../hooks/usePianoRoll"
import { useQuantizer } from "../../hooks/useQuantizer"
import { useTrack } from "../../hooks/useTrack"
import { InstrumentBrowser } from "../InstrumentBrowser/InstrumentBrowser"
import { InstrumentEmoji, InstrumentName } from "../TrackList/InstrumentName"
import { Tooltip } from "../ui/Tooltip"

const Container = styled.div`
  position: absolute;
  white-space: nowrap;
  background: var(--color-theme);
  color: var(--color-text);
  padding: 0.2em 0.5em;
  border-radius: 0 4px 4px 0;
  margin: 0.2em 0 0 0;
  box-shadow: 1px 1px 3px 0 rgba(0, 0, 0, 0.02);
  transition: opacity 0.1s ease;
  opacity: 0.5;
  max-width: 7rem;
  overflow: hidden;
  cursor: grab;

  &:hover {
    opacity: 1;
    max-width: none;
    overflow: visible;
  }
`

// Small colored letter chip shown next to the instrument name when this
// track's instrument assignment came from an orchestration "apply to song"
// action (see `useTrackOrchestrationOrigin`) — one badge per
// `MuseDecisionOrigin`, reusing the app's existing theme color tokens (see
// `GlobalCSS.tsx`'s `--color-*` custom properties, derived from `Theme.ts`)
// rather than inventing new hardcoded colors, so it stays legible in both
// light and dark themes.
const OriginBadge = styled.span<{ background: string }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.2em;
  height: 1.2em;
  padding: 0 0.25em;
  margin-right: 0.35em;
  border-radius: 3px;
  font-size: 0.7em;
  font-weight: 700;
  line-height: 1;
  color: var(--color-on-surface);
  background: ${({ background }) => background};
  vertical-align: middle;
  cursor: default;
`

// `--color-on-surface` is documented in `Theme.ts` as "content color on
// themeColor" — i.e. exactly the foreground meant to sit on top of an
// accent-colored chip like this one, so every origin shares it as their text
// color and only the background varies.
const ORIGIN_BADGE: Record<
  MuseDecisionOrigin,
  { label: string; background: string }
> = {
  source: { label: "S", background: "var(--color-text-secondary)" },
  analysis: { label: "A", background: "var(--color-theme)" },
  recipe: { label: "R", background: "var(--color-green)" },
  user: { label: "U", background: "var(--color-yellow)" },
  agent: { label: "Ag", background: "var(--color-red)" },
}

export const InstrumentMark: FC<{
  event: TrackEventOf<ProgramChangeEvent>
  transform: TickTransform
}> = ({ event, transform }) => {
  const style = useMemo(() => {
    return {
      left: transform.getX(event.tick),
    }
  }, [transform, event.tick])
  const [isOpenInstrumentBrowser, setIsOpenInstrumentBrowser] = useState(false)
  const { selectedTrackId } = usePianoRoll()
  const { removeEvent, updateEvent } = useTrack(selectedTrackId)
  const { pushHistory } = useHistory()
  const { quantizeRound } = useQuantizer()
  const orchestrationOrigin = useTrackOrchestrationOrigin(selectedTrackId)

  const handleDoubleClick = useCallback(() => {
    setIsOpenInstrumentBrowser(true)
  }, [])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      removeEvent(event.id)
    },
    [event.id, removeEvent],
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()

      const startTick = event.tick
      let isChanged = false

      observeDrag2(e.nativeEvent, {
        onMouseMove: (_e, delta) => {
          if (!isChanged) {
            isChanged = true
            pushHistory()
          }
          const deltaTick = transform.getTick(delta.x)
          const newTick = Math.max(0, quantizeRound(startTick + deltaTick))
          updateEvent(event.id, { tick: newTick })
        },
      })
    },
    [event.id, event.tick, transform, updateEvent, pushHistory, quantizeRound],
  )

  return (
    <>
      <Container
        style={style}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
      >
        {orchestrationOrigin && (
          <Tooltip title={orchestrationOrigin.reason}>
            <OriginBadge
              background={ORIGIN_BADGE[orchestrationOrigin.origin].background}
            >
              {ORIGIN_BADGE[orchestrationOrigin.origin].label}
            </OriginBadge>
          </Tooltip>
        )}
        <InstrumentEmoji programNumber={event.value} isRhythmTrack={false} />{" "}
        <InstrumentName programNumber={event.value} isRhythmTrack={false} />
      </Container>
      <InstrumentBrowser
        isOpen={isOpenInstrumentBrowser}
        onOpenChange={setIsOpenInstrumentBrowser}
        trackId={selectedTrackId}
        targetEventId={event.id}
      />
    </>
  )
}
