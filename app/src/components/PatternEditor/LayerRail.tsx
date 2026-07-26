import styled from "@emotion/styled"
import type { FC } from "react"
import type {
  MusePattern,
  MusePatternLayerKind,
  MusePatternTrackLayer,
} from "../../entities/pattern/MusePattern"

/**
 * Instrument layers live in a rail that is a narrow strip by default.
 * The question it answers is "which layer am I editing, and which do I want
 * to see as a reference" – not "manage my tracks".
 */

export const MELODIC_INSTRUMENTS: { name: string; program: number }[] = [
  { name: "Klavier", program: 0 },
  { name: "E-Piano", program: 4 },
  { name: "Gitarre", program: 24 },
  { name: "Bass", program: 33 },
  { name: "Violine", program: 40 },
  { name: "Cello", program: 42 },
  { name: "Streicher", program: 48 },
  { name: "Chor", program: 52 },
  { name: "Trompete", program: 56 },
  { name: "Saxophon", program: 65 },
  { name: "Flöte", program: 73 },
  { name: "Synth-Pad", program: 89 },
]

export const DRUM_ZONES: { name: string; zoneId: string }[] = [
  { name: "Kick", zoneId: "kick" },
  { name: "Snare", zoneId: "snare" },
  { name: "Hi-Hat", zoneId: "hihat" },
  { name: "Clap", zoneId: "clap" },
  { name: "Tom", zoneId: "tom" },
]

const Rail = styled.aside<{ open: boolean }>`
  display: flex;
  width: ${({ open }) => (open ? "254px" : "58px")};
  flex-direction: column;
  flex-shrink: 0;
  gap: 8px;
  padding: 10px 8px;
  overflow-y: auto;
  border-right: 1px solid rgba(167, 139, 250, 0.16);
  background: rgba(16, 12, 30, 0.72);
  transition: width 0.16s ease;
`

const RailHead = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
`

const RailTitle = styled.span`
  color: #c4b5fd;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
`

const IconButton = styled.button`
  display: grid;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid rgba(167, 139, 250, 0.28);
  border-radius: 9px;
  color: #ddd6fe;
  background: rgba(167, 139, 250, 0.12);
  font-size: 14px;
  cursor: pointer;

  &:hover {
    background: rgba(167, 139, 250, 0.26);
  }
`

const LayerCard = styled.div<{ active: boolean; color: string }>`
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 9px 10px;
  border: 1px solid
    ${({ active, color }) => (active ? color : "rgba(255,255,255,0.09)")};
  border-radius: 12px;
  background: ${({ active }) =>
    active ? "rgba(167, 139, 250, 0.16)" : "rgba(255, 255, 255, 0.03)"};
  cursor: pointer;
`

const LayerTop = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
`

const Dot = styled.span<{ color: string; dim: boolean }>`
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  border-radius: 50%;
  background: ${({ color }) => color};
  opacity: ${({ dim }) => (dim ? 0.3 : 1)};
`

const NameInput = styled.input`
  width: 100%;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #f5f3ff;
  background: transparent;
  font: inherit;
  font-size: 12px;

  &:focus {
    border-color: rgba(167, 139, 250, 0.5);
    background: rgba(0, 0, 0, 0.3);
    outline: none;
  }
`

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`

const Chip = styled.button<{ on: boolean; tone?: string }>`
  padding: 3px 7px;
  border: 1px solid
    ${({ on, tone }) => (on ? (tone ?? "#a78bfa") : "rgba(255,255,255,0.14)")};
  border-radius: 999px;
  color: ${({ on, tone }) => (on ? (tone ?? "#ddd6fe") : "rgba(255,255,255,0.5)")};
  background: ${({ on, tone }) =>
    on ? `${tone ?? "#a78bfa"}26` : "transparent"};
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  cursor: pointer;
`

const Select = styled.select`
  width: 100%;
  padding: 4px 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  color: #ede9fe;
  background: rgba(10, 8, 20, 0.9);
  font-size: 11px;
  cursor: pointer;
`

const StripDot = styled.button<{
  color: string
  active: boolean
  dim: boolean
}>`
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 2px solid ${({ color, active }) => (active ? color : "transparent")};
  border-radius: 12px;
  background: ${({ color, dim }) => (dim ? `${color}33` : `${color}66`)};
  color: #0f0a1e;
  font-size: 10px;
  font-weight: 800;
  cursor: pointer;
`

const AddRow = styled.div`
  display: flex;
  gap: 6px;
`

const AddButton = styled.button`
  flex: 1;
  padding: 7px 8px;
  border: 1px dashed rgba(167, 139, 250, 0.45);
  border-radius: 10px;
  color: #c4b5fd;
  background: transparent;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;

  &:hover {
    background: rgba(167, 139, 250, 0.14);
  }
`

const Danger = styled(Chip)`
  margin-left: auto;
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
  if (!open) {
    return (
      <Rail open={false}>
        <IconButton onClick={onToggleOpen} title="Ebenen öffnen">
          ☰
        </IconButton>
        {pattern.trackLayers.map((layer) => (
          <StripDot
            key={layer.id}
            color={layer.color}
            active={layer.id === activeLayerId}
            dim={!layer.visible || layer.muted}
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
    <Rail open>
      <RailHead>
        <RailTitle>Ebenen</RailTitle>
        <IconButton onClick={onToggleOpen} title="Ebenen schließen">
          ‹
        </IconButton>
      </RailHead>

      {pattern.trackLayers.map((layer: MusePatternTrackLayer) => (
        <LayerCard
          key={layer.id}
          color={layer.color}
          active={layer.id === activeLayerId}
          onPointerDown={() => onSelect(layer.id)}
        >
          <LayerTop>
            <Dot color={layer.color} dim={!layer.visible} />
            <NameInput
              value={layer.name}
              onChange={(e) => onRename(layer.id, e.target.value)}
              aria-label="Ebenenname"
            />
          </LayerTop>

          {layer.kind === "melodic" ? (
            <Select
              value={layer.program ?? 0}
              onChange={(e) =>
                onSetInstrument(layer.id, Number(e.target.value))
              }
              aria-label="Instrument"
            >
              {MELODIC_INSTRUMENTS.map((instrument) => (
                <option key={instrument.program} value={instrument.program}>
                  {instrument.name}
                </option>
              ))}
            </Select>
          ) : (
            <Select
              value={layer.drumZoneId ?? "kick"}
              onChange={(e) => onSetDrumZone(layer.id, e.target.value)}
              aria-label="Sound"
            >
              {DRUM_ZONES.map((zone) => (
                <option key={zone.zoneId} value={zone.zoneId}>
                  {zone.name}
                </option>
              ))}
            </Select>
          )}

          <Chips>
            <Chip
              on={layer.visible}
              onClick={() => onToggleFlag(layer.id, "visible")}
              title="Sichtbar"
            >
              {layer.visible ? "sichtbar" : "aus"}
            </Chip>
            <Chip
              on={layer.muted}
              tone="#fb7185"
              onClick={() => onToggleFlag(layer.id, "muted")}
            >
              mute
            </Chip>
            <Chip
              on={layer.soloed}
              tone="#fbbf24"
              onClick={() => onToggleFlag(layer.id, "soloed")}
            >
              solo
            </Chip>
            <Chip
              on={layer.locked}
              tone="#38bdf8"
              onClick={() => onToggleFlag(layer.id, "locked")}
            >
              lock
            </Chip>
            <Danger
              on={false}
              tone="#fb7185"
              onClick={() => onRemoveLayer(layer.id)}
              title="Ebene löschen"
            >
              ✕
            </Danger>
          </Chips>
        </LayerCard>
      ))}

      <AddRow>
        <AddButton onClick={() => onAddLayer("melodic")}>
          + Instrument
        </AddButton>
        <AddButton onClick={() => onAddLayer("percussion")}>+ Drum</AddButton>
      </AddRow>
    </Rail>
  )
}
