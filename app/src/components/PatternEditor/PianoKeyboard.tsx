import styled from "@emotion/styled"
import {
  type FC,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useMemo,
  useRef,
} from "react"
import { noteNameWithOctString } from "../../helpers/noteNumberString"
import { isBlackKey, keyLayout } from "../../services/pattern/keyboardPiano"

/**
 * The piano.
 *
 * Full size it is a real keyboard – seven octaves, every key reachable without
 * scrolling, because a piano you have to scroll is not a piano. The keys share
 * the available width, so the same component is a wall of thin keys on a
 * monitor and, in compact mode, two octaves of keys wide enough for a child's
 * finger on a phone. Compact loses the range, not the instrument: the octave
 * buttons move the same keyboard, so nothing is out of reach, it just takes a
 * tap to get there.
 *
 * Sliding a finger across the keys plays them in turn. That is done by asking
 * the document what is under the pointer rather than by per-key enter events,
 * because a touch pointer never enters a second element – it stays captured by
 * the one it started on, and a glissando would be silent.
 */

const Frame = styled.div`
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border-top: 1px solid var(--color-divider);
  background: var(--color-background);
`

const Keys = styled.div`
  position: relative;
  display: flex;
  width: 100%;
  height: 7rem;
  box-sizing: border-box;
  padding: 0 0.25rem 0.25rem;
  /* the browser must not take the drag away for scrolling or text selection */
  touch-action: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;

  &[data-compact="true"] {
    height: 8.5rem;
  }
`

const WhiteKey = styled.div`
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 0.25rem;
  box-sizing: border-box;
  border: 1px solid var(--color-divider);
  border-radius: 0 0 0.25rem 0.25rem;
  background: var(--color-piano-lane-white);
  color: var(--color-text-secondary);
  font-size: 0.6rem;
  cursor: pointer;

  &[data-down="true"] {
    background: var(--color-theme);
    color: var(--color-background);
  }

  &[data-root="true"] {
    border-color: var(--color-text-secondary);
  }
`

const BlackKey = styled.div`
  position: absolute;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  height: 62%;
  padding-bottom: 0.2rem;
  box-sizing: border-box;
  border: 1px solid var(--color-background);
  border-radius: 0 0 0.2rem 0.2rem;
  background: var(--color-piano-lane-black);
  color: var(--color-text-secondary);
  font-size: 0.55rem;
  cursor: pointer;

  &[data-down="true"] {
    background: var(--color-theme);
    color: var(--color-background);
  }
`

const Label = styled.span`
  pointer-events: none;
  overflow: hidden;
  white-space: nowrap;
`

export interface PianoKeyboardProps {
  /** Lowest C of the keyboard */
  baseNote: number
  octaves: number
  compact: boolean
  /** Notes currently sounding, from any source */
  activeNotes: ReadonlySet<number>
  /** Physical key printed on each note, when the keyboard is big enough to show it */
  codeLabels?: ReadonlyMap<number, string> | null
  onNoteOn: (noteNumber: number, velocity: number) => void
  onNoteOff: (noteNumber: number) => void
}

/**
 * Velocity from where the key was hit: near the pivot is quiet, at the tip is
 * loud – the way a real key responds, and the only velocity a touchscreen can
 * offer at all.
 */
export function velocityFromHit(offsetY: number, height: number): number {
  if (height <= 0) return 96
  const depth = Math.min(1, Math.max(0, offsetY / height))
  return Math.round(56 + depth * 68)
}

export const PianoKeyboard: FC<PianoKeyboardProps> = ({
  baseNote,
  octaves,
  compact,
  activeNotes,
  codeLabels,
  onNoteOn,
  onNoteOff,
}) => {
  const { white, blackAfter } = useMemo(
    () => keyLayout(baseNote, octaves),
    [baseNote, octaves],
  )
  const widthPct = 100 / Math.max(1, white.length)

  /** Note each pointer is currently holding down. */
  const sounding = useRef(new Map<number, number>())

  const noteUnder = useCallback((x: number, y: number): number | null => {
    const element = document.elementFromPoint(x, y)
    const note = element?.getAttribute("data-note")
    return note === null || note === undefined ? null : Number(note)
  }, [])

  const press = useCallback(
    (pointerId: number, note: number, velocity: number) => {
      const previous = sounding.current.get(pointerId)
      if (previous === note) return
      if (previous !== undefined) onNoteOff(previous)
      sounding.current.set(pointerId, note)
      onNoteOn(note, velocity)
    },
    [onNoteOff, onNoteOn],
  )

  const release = useCallback(
    (pointerId: number) => {
      const note = sounding.current.get(pointerId)
      if (note === undefined) return
      sounding.current.delete(pointerId)
      onNoteOff(note)
    },
    [onNoteOff],
  )

  const handleDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      const note = target.getAttribute("data-note")
      if (note === null) return
      e.preventDefault()
      const box = target.getBoundingClientRect()
      press(
        e.pointerId,
        Number(note),
        velocityFromHit(e.clientY - box.top, box.height),
      )
    },
    [press],
  )

  const handleMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!sounding.current.has(e.pointerId)) return
      const note = noteUnder(e.clientX, e.clientY)
      if (note === null) {
        release(e.pointerId)
        return
      }
      // a slide keeps the velocity of the key it started on; re-reading it per
      // key would make a glissando lurch in volume
      const previous = sounding.current.get(e.pointerId)
      if (previous !== note) press(e.pointerId, note, 84)
    },
    [noteUnder, press, release],
  )

  const handleUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => release(e.pointerId),
    [release],
  )

  const renderLabel = (note: number) => {
    if (compact) {
      // no room for two labels; C is the landmark that keeps you oriented
      return note % 12 === 0 ? noteNameWithOctString(note) : ""
    }
    return (
      codeLabels?.get(note) ??
      (note % 12 === 0 ? noteNameWithOctString(note) : "")
    )
  }

  return (
    <Frame>
      <Keys
        data-compact={compact}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        onPointerLeave={handleUp}
        role="group"
        aria-label="piano"
      >
        {white.map((note) => (
          <WhiteKey
            key={note}
            data-note={note}
            data-down={activeNotes.has(note)}
            data-root={note % 12 === 0}
            aria-label={noteNameWithOctString(note)}
          >
            <Label>{renderLabel(note)}</Label>
          </WhiteKey>
        ))}
        {white.map((note, index) => {
          const black = blackAfter[index]
          if (black === null) return null
          return (
            <BlackKey
              key={black}
              data-note={black}
              data-down={activeNotes.has(black)}
              aria-label={noteNameWithOctString(black)}
              style={{
                left: `calc(${(index + 1) * widthPct}% - ${widthPct * 0.32}%)`,
                width: `${widthPct * 0.64}%`,
              }}
            >
              <Label>{compact ? "" : (codeLabels?.get(black) ?? "")}</Label>
            </BlackKey>
          )
        })}
      </Keys>
    </Frame>
  )
}

export { isBlackKey }
