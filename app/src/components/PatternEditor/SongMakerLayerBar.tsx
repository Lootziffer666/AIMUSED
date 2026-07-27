import styled from "@emotion/styled"
import Eye from "mdi-react/EyeIcon"
import EyeOff from "mdi-react/EyeOffIcon"
import type { FC } from "react"
import type {
  MusePattern,
  MusePatternTrackLayer,
} from "../../entities/pattern/MusePattern"
import { useLocalization } from "../../localize/useLocalization"
import type { InstrumentSelection } from "../../services/pattern/patternOps"
import { InlineSelect } from "../ui/Panel"
import { DRUM_ZONES, MELODIC_INSTRUMENTS } from "./LayerRail"

/**
 * The Song Maker's layer strip.
 *
 * Two things live here because they belong together: what you are playing, and
 * what you can see. Picking an instrument opens a layer instead of rewriting
 * the current one, and every layer has its own eye – the stack stays visible as
 * a stack, the way image layers do.
 */

const Bar = styled.div`
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.35rem 0.5rem;
  overflow-x: auto;
  border-bottom: 1px solid var(--color-divider);
  background: var(--color-background);
`

const Layers = styled.div`
  display: flex;
  gap: 0.3rem;
  align-items: center;
`

const LayerChip = styled.div`
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 0.2rem;
  padding: 0.1rem 0.35rem 0.1rem 0.1rem;
  border: 1px solid var(--color-divider);
  border-radius: 999px;
  background: var(--color-background-secondary);

  &[data-selected="true"] {
    border-color: var(--color-theme);
    background: var(--color-highlight);
  }

  &[data-hidden="true"] {
    opacity: 0.5;
  }
`

const EyeButton = styled.button`
  display: grid;
  width: 1.4rem;
  height: 1.4rem;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 50%;
  color: var(--color-text-secondary);
  background: transparent;
  cursor: pointer;
  outline: none;

  &:hover {
    color: var(--color-text);
  }
`

const NameButton = styled.button`
  display: flex;
  align-items: center;
  gap: 0.3rem;
  max-width: 8rem;
  padding: 0;
  border: none;
  color: var(--color-text);
  background: transparent;
  font-family: inherit;
  font-size: 0.7rem;
  white-space: nowrap;
  cursor: pointer;
  outline: none;
`

const Swatch = styled.span`
  width: 0.55rem;
  height: 0.55rem;
  flex-shrink: 0;
  border-radius: 50%;
`

/** Encodes a layer's sound as one select value, so both kinds share one list. */
export function selectionValue(selection: InstrumentSelection): string {
  return selection.kind === "melodic"
    ? `melodic:${selection.program ?? 0}`
    : `percussion:${selection.drumZoneId ?? "kick"}`
}

export function layerSelectionValue(layer: MusePatternTrackLayer): string {
  return layer.kind === "melodic"
    ? `melodic:${layer.program ?? 0}`
    : `percussion:${layer.drumZoneId ?? "kick"}`
}

/** The reverse, with the display name the new layer should carry. */
export function parseSelectionValue(
  value: string,
): InstrumentSelection | undefined {
  const [kind, rest] = value.split(":")
  if (kind === "melodic") {
    const program = Number(rest)
    const instrument = MELODIC_INSTRUMENTS.find((i) => i.program === program)
    if (!instrument) return undefined
    return { kind: "melodic", program, name: instrument.name }
  }
  if (kind === "percussion") {
    const zone = DRUM_ZONES.find((z) => z.zoneId === rest)
    if (!zone) return undefined
    return { kind: "percussion", drumZoneId: zone.zoneId, name: zone.name }
  }
  return undefined
}

export interface SongMakerLayerBarProps {
  pattern: MusePattern
  activeLayerId: string
  onSelectLayer: (layerId: string) => void
  onToggleVisible: (layerId: string) => void
  onPickInstrument: (selection: InstrumentSelection) => void
}

export const SongMakerLayerBar: FC<SongMakerLayerBarProps> = ({
  pattern,
  activeLayerId,
  onSelectLayer,
  onToggleVisible,
  onPickInstrument,
}) => {
  const localized = useLocalization()
  const active = pattern.trackLayers.find((l) => l.id === activeLayerId)

  return (
    <Bar>
      <InlineSelect
        value={active ? layerSelectionValue(active) : "melodic:0"}
        onChange={(e) => {
          const selection = parseSelectionValue(e.target.value)
          if (selection) onPickInstrument(selection)
        }}
        aria-label={localized["pattern-instrument"]}
        title={localized["pattern-instrument-new-layer"]}
      >
        <optgroup label={localized["pattern-instrument"]}>
          {MELODIC_INSTRUMENTS.map((instrument) => (
            <option
              key={instrument.program}
              value={`melodic:${instrument.program}`}
            >
              {instrument.name}
            </option>
          ))}
        </optgroup>
        <optgroup label={localized["pattern-drum"]}>
          {DRUM_ZONES.map((zone) => (
            <option key={zone.zoneId} value={`percussion:${zone.zoneId}`}>
              {zone.name}
            </option>
          ))}
        </optgroup>
      </InlineSelect>

      <Layers>
        {pattern.trackLayers.map((layer) => (
          <LayerChip
            key={layer.id}
            data-selected={layer.id === activeLayerId}
            data-hidden={!layer.visible}
          >
            <EyeButton
              type="button"
              onClick={() => onToggleVisible(layer.id)}
              aria-label={`${localized["pattern-layer-visibility"]}: ${layer.name}`}
              aria-pressed={layer.visible}
            >
              {layer.visible ? <Eye size="0.9rem" /> : <EyeOff size="0.9rem" />}
            </EyeButton>
            <NameButton
              type="button"
              onClick={() => onSelectLayer(layer.id)}
              title={layer.name}
            >
              <Swatch style={{ background: layer.color }} />
              {layer.name}
            </NameButton>
          </LayerChip>
        ))}
      </Layers>
    </Bar>
  )
}
