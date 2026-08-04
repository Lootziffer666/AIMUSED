import styled from "@emotion/styled"
import ChevronLeft from "mdi-react/ChevronLeftIcon"
import Close from "mdi-react/CloseIcon"
import Menu from "mdi-react/MenuIcon"
import type { FC } from "react"
import type {
  MusePattern,
  MusePatternLayerKind,
  MusePatternTrackLayer,
} from "../../entities/pattern/MusePattern"
import { Localized, useLocalization } from "../../localize/useLocalization"
import { IconButton } from "../ui/IconButton"
import { Chip, InlineSelect } from "../ui/Panel"

/**
 * Instrument layers live in a rail that is a narrow strip by default.
 * The question it answers is "which layer am I editing, and which do I want
 * to see as a reference" – not "manage my tracks".
 */

export const MELODIC_INSTRUMENTS: { name: string; program: number }[] = [
  { name: "Piano", program: 0 },
  { name: "Electric Piano", program: 4 },
  { name: "Guitar", program: 24 },
  { name: "Bass", program: 33 },
  { name: "Violin", program: 40 },
  { name: "Cello", program: 42 },
  { name: "Strings", program: 48 },
  { name: "Choir", program: 52 },
  { name: "Trumpet", program: 56 },
  { name: "Saxophone", program: 65 },
  { name: "Flute", program: 73 },
  { name: "Synth Pad", program: 89 },
]

export const DRUM_ZONES: { name: string; zoneId: string }[] = [
  { name: "Kick", zoneId: "kick" },
  { name: "Snare", zoneId: "snare" },
  { name: "Hi-Hat", zoneId: "hihat" },
  { name: "Clap", zoneId: "clap" },
  { name: "Tom", zoneId: "tom" },
]

const Rail = styled.aside`
  display: flex;
  width: 3.5rem;
  flex-direction: column;
  flex-shrink: 0;
  gap: 0.4rem;
  padding: 0.5rem;
  overflow-y: auto;
  box-sizing: border-box;
  border-right: 1px solid var(--color-divider);
  background: var(--color-background);

  &[data-open="true"] {
    width: 15rem;
  }
`

const RailHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
`

const RailTitle = styled.span`
  color: var(--color-text-secondary);
  font-size: 0.7rem;
  font-weight: 600;
`

const LayerCard = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem;
  border: 1px solid transparent;
  border-radius: 0.5rem;
  cursor: pointer;

  &:hover {
    background: var(--color-highlight);
  }

  &[data-selected="true"] {
    border-color: var(--color-divider);
    background: var(--color-highlight);
  }
`

const LayerTop = styled.div`
  display: flex;
  gap: 0.4rem;
  align-items: center;
`

const Dot = styled.span`
  width: 0.6rem;
  height: 0.6rem;
  flex-shrink: 0;
  border-radius: 50%;
`

const NameInput = styled.input`
  width: 100%;
  min-width: 0;
  height: 1.4rem;
  box-sizing: border-box;
  padding: 0 0.3rem;
  border: 1px solid transparent;
  border-radius: 0.2rem;
  color: var(--color-text);
  background: transparent;
  font-family: inherit;
  font-size: 0.75rem;
  outline: none;

  &:focus {
    border-color: var(--color-theme);
    background: var(--color-background-dark);
  }
`

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
`

const StripDot = styled.button`
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  flex-shrink: 0;
  place-items: center;
  border: 2px solid transparent;
  border-radius: 0.5rem;
  color: var(--color-text);
  background: var(--color-background-secondary);
  font-family: inherit;
  font-size: 0.65rem;
  font-weight: 600;
  cursor: pointer;
  outline: none;

  &:hover {
    background: var(--color-highlight);
  }
`

const AddRow = styled.div`
  display: flex;
  gap: 0.25rem;
`

const AddButton = styled.button`
  flex: 1;
  height: 1.8rem;
  border: 1px dashed var(--color-divider);
  border-radius: 0.3rem;
  color: var(--color-text-secondary);
  background: transparent;
  font-family: inherit;
  font-size: 0.7rem;
  cursor: pointer;
  outline: none;

  &:hover {
    background: var(--color-highlight);
    color: var(--color-text);
  }
`

const RemoveChip = styled(Chip)`
  margin-left: auto;
  padding: 0 0.25rem;

  &:hover {
    border-color: var(--color-red);
    color: var(--color-red);
  }
`

export interface LayerRailProps {
  pattern: MusePattern
  open: boolean
  activeLayerId: string
  onToggleOpen: () => void
  onSelect: (layerId: string) => void
  onToggleFlag: (
    layerId: string,
    flag: "visible" | "muted" | "soloed" | "locked",
  ) => void
  onRename: (layerId: string, name: string) => void
  onSetInstrument: (layerId: string, program: number) => void
  onSetDrumZone: (layerId: string, zoneId: string) => void
  onAddLayer: (kind: MusePatternLayerKind) => void
  onRemoveLayer: (layerId: string) => void
}

export const LayerRail: FC<LayerRailProps> = ({
  pattern,
  open,
  activeLayerId,
  onToggleOpen,
  onSelect,
  onToggleFlag,
  onRename,
  onSetInstrument,
  onSetDrumZone,
  onAddLayer,
  onRemoveLayer,
}) => {
  const localized = useLocalization()

  if (!open) {
    return (
      <Rail data-open={false}>
        <IconButton
          onClick={onToggleOpen}
          aria-label={localized["pattern-layer-rail"]}
        >
          <Menu size="1.1rem" />
        </IconButton>
        {pattern.trackLayers.map((layer) => (
          <StripDot
            key={layer.id}
            data-selected={layer.id === activeLayerId}
            style={{
              borderColor:
                layer.id === activeLayerId ? layer.color : "transparent",
              opacity: !layer.visible || layer.muted ? 0.4 : 1,
            }}
            onClick={() => onSelect(layer.id)}
            title={layer.name}
          >
            {layer.name.slice(0, 2).toUpperCase()}
          </StripDot>
        ))}
      </Rail>
    )
  }

  return (
    <Rail data-open={true}>
      <RailHead>
        <RailTitle>
          <Localized name="pattern-layers" />
        </RailTitle>
        <IconButton
          onClick={onToggleOpen}
          aria-label={localized["pattern-layer-rail"]}
        >
          <ChevronLeft size="1.1rem" />
        </IconButton>
      </RailHead>

      {pattern.trackLayers.map((layer: MusePatternTrackLayer) => (
        <LayerCard
          key={layer.id}
          data-selected={layer.id === activeLayerId}
          onPointerDown={() => onSelect(layer.id)}
        >
          <LayerTop>
            <Dot
              style={{
                background: layer.color,
                opacity: layer.visible ? 1 : 0.3,
              }}
            />
            <NameInput
              value={layer.name}
              onChange={(e) => onRename(layer.id, e.target.value)}
              aria-label={localized["pattern-layer-name"]}
            />
          </LayerTop>

          {layer.kind === "melodic" ? (
            <InlineSelect
              value={layer.program ?? 0}
              onChange={(e) =>
                onSetInstrument(layer.id, Number(e.target.value))
              }
              aria-label={localized["pattern-instrument"]}
            >
              {MELODIC_INSTRUMENTS.map((instrument) => (
                <option key={instrument.program} value={instrument.program}>
                  {instrument.name}
                </option>
              ))}
            </InlineSelect>
          ) : (
            <InlineSelect
              value={layer.drumZoneId ?? "kick"}
              onChange={(e) => onSetDrumZone(layer.id, e.target.value)}
              aria-label={localized["pattern-sound"]}
            >
              {DRUM_ZONES.map((zone) => (
                <option key={zone.zoneId} value={zone.zoneId}>
                  {zone.name}
                </option>
              ))}
            </InlineSelect>
          )}

          <Chips>
            <Chip
              data-selected={layer.visible}
              onClick={() => onToggleFlag(layer.id, "visible")}
            >
              <Localized name="pattern-visible" />
            </Chip>
            <Chip
              data-selected={layer.muted}
              data-tone="danger"
              onClick={() => onToggleFlag(layer.id, "muted")}
            >
              <Localized name="pattern-mute" />
            </Chip>
            <Chip
              data-selected={layer.soloed}
              onClick={() => onToggleFlag(layer.id, "soloed")}
            >
              <Localized name="pattern-solo" />
            </Chip>
            <Chip
              data-selected={layer.locked}
              onClick={() => onToggleFlag(layer.id, "locked")}
            >
              <Localized name="pattern-lock" />
            </Chip>
            <RemoveChip
              onClick={() => onRemoveLayer(layer.id)}
              aria-label={localized["pattern-remove-layer"]}
            >
              <Close size="0.8rem" />
            </RemoveChip>
          </Chips>
        </LayerCard>
      ))}

      <AddRow>
        <AddButton onClick={() => onAddLayer("melodic")}>
          + <Localized name="pattern-instrument" />
        </AddButton>
        <AddButton onClick={() => onAddLayer("percussion")}>
          + <Localized name="pattern-drum" />
        </AddButton>
      </AddRow>
    </Rail>
  )
}
