import styled from "@emotion/styled"
import { useToast } from "dialog-hooks"
import { type FC, useCallback } from "react"
import {
  gridTicks,
  type MusePattern,
  stepCount,
} from "../../entities/pattern/MusePattern"
import { useMobxGetter } from "../../hooks/useMobxSelector"
import { useStores } from "../../hooks/useStores"
import { createEmptySongMakerPattern } from "../../services/jamRoom/songMaker"
import {
  addLayer,
  createLayer,
  createPattern,
} from "../../services/pattern/patternOps"
import { removePatternFromSong } from "../../services/pattern/patternSongAdapter"
import { songMakerPatternToMusePattern } from "../../services/pattern/songMakerMigration"
import { PatternEditor } from "./PatternEditor"

/**
 * Workspace root. The pattern editor is a distinct working state: either the
 * library is on screen or the editor is – never both, and nothing of the
 * editor leaks into arrange or jam views.
 */

const Shell = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  color: #ede9fe;
  background:
    radial-gradient(900px 620px at 15% -10%, rgba(124, 58, 237, 0.3), transparent 60%),
    radial-gradient(700px 520px at 88% 108%, rgba(236, 72, 153, 0.16), transparent 60%),
    #0d0a18;
`

const Header = styled.header`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  padding: 20px 24px 12px;

  h1 {
    margin: 0;
    font-size: 20px;
    letter-spacing: 0.02em;
  }

  p {
    margin: 4px 0 0;
    color: rgba(255, 255, 255, 0.55);
    font-size: 12px;
  }
`

const Spacer = styled.div`
  flex: 1;
`

const Button = styled.button<{ tone?: "primary" }>`
  padding: 10px 16px;
  border: 1px solid
    ${({ tone }) => (tone === "primary" ? "transparent" : "rgba(255,255,255,0.14)")};
  border-radius: 10px;
  color: ${({ tone }) => (tone === "primary" ? "#1b1030" : "#c7c2dd")};
  background: ${({ tone }) =>
    tone === "primary" ? "#a78bfa" : "rgba(255,255,255,0.04)"};
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 0.1s ease;

  &:hover {
    transform: translateY(-1px);
  }
`

const Grid = styled.div`
  display: grid;
  gap: 14px;
  padding: 8px 24px 28px;
  overflow-y: auto;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
`

const Card = styled.button`
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1px solid rgba(167, 139, 250, 0.24);
  border-radius: 16px;
  color: inherit;
  background: rgba(255, 255, 255, 0.04);
  text-align: left;
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.12s ease;

  &:hover {
    border-color: #a78bfa;
    transform: translateY(-2px);
  }
`

const CardTitle = styled.div`
  font-size: 15px;
  font-weight: 700;
`

const CardMeta = styled.div`
  color: rgba(255, 255, 255, 0.5);
  font-size: 11px;
`

const Dots = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
`

const Dot = styled.span<{ color: string }>`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${({ color }) => color};
`

const MiniPreview = styled.div`
  position: relative;
  height: 46px;
  overflow: hidden;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.35);
`

const MiniNote = styled.span<{ color: string }>`
  position: absolute;
  height: 3px;
  border-radius: 2px;
  background: ${({ color }) => color};
`

const CardActions = styled.div`
  display: flex;
  gap: 8px;
`

const SmallLink = styled.span`
  color: rgba(255, 255, 255, 0.45);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  &:hover {
    color: #fda4af;
  }
`

const Empty = styled.div`
  padding: 40px 24px;
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
  line-height: 1.7;
`

const MiniatureView: FC<{ pattern: MusePattern }> = ({ pattern }) => {
  const length = Math.max(1, pattern.lengthTicks)
  const pitches = pattern.trackLayers.flatMap((l) =>
    l.notes.map((n) => n.noteNumber),
  )
  const min = pitches.length > 0 ? Math.min(...pitches) : 48
  const max = pitches.length > 0 ? Math.max(...pitches) : 72
  const span = Math.max(1, max - min)
  return (
    <MiniPreview>
      {pattern.trackLayers.flatMap((layer) =>
        layer.notes.slice(0, 120).map((note) => (
          <MiniNote
            key={note.id}
            color={layer.color}
            style={{
              left: `${(note.startTick / length) * 100}%`,
              width: `${Math.max(2, (note.durationTicks / length) * 100)}%`,
              top: `${6 + (1 - (note.noteNumber - min) / span) * 34}px`,
            }}
          />
        )),
      )}
    </MiniPreview>
  )
}

export const PatternWorkspace: FC = () => {
  const { patternStore, songStore } = useStores()
  const toast = useToast()
  const patterns = useMobxGetter(patternStore, "patterns")
  const openPatternId = useMobxGetter(patternStore, "openPatternId")

  const createEmpty = useCallback(() => {
    let pattern = createPattern({
      name: `Pattern ${patternStore.patterns.length + 1}`,
      timebase: songStore.song.timebase,
      layers: [
        createLayer({ name: "Klavier", kind: "melodic", program: 0 }, 0),
      ],
    })
    pattern = addLayer(pattern, {
      name: "Kick",
      kind: "percussion",
      drumZoneId: "kick",
    })
    patternStore.save(pattern)
    patternStore.open(pattern.id)
  }, [patternStore, songStore.song.timebase])

  const createFromSongMaker = useCallback(() => {
    // Empty 16-step grid in the classic layout – the migration path that also
    // covers patterns coming from the old Song Maker data model.
    const pattern = songMakerPatternToMusePattern(
      createEmptySongMakerPattern(),
      { name: "Song Maker 16", timebase: songStore.song.timebase },
    )
    const withDrums = ["kick", "snare", "hihat"].reduce(
      (p, zoneId) =>
        addLayer(p, {
          name:
            zoneId === "hihat"
              ? "Hi-Hat"
              : zoneId === "kick"
                ? "Kick"
                : "Snare",
          kind: "percussion",
          drumZoneId: zoneId,
        }),
      pattern,
    )
    patternStore.save(withDrums)
    patternStore.open(withDrums.id)
  }, [patternStore, songStore.song.timebase])

  const remove = useCallback(
    (pattern: MusePattern) => {
      removePatternFromSong(songStore.song, patternStore.getBinding(pattern.id))
      patternStore.remove(pattern.id)
      toast.info(`„${pattern.name}“ gelöscht.`)
    },
    [patternStore, songStore.song, toast],
  )

  if (
    openPatternId !== null &&
    openPatternId !== undefined &&
    patternStore.get(openPatternId)
  ) {
    return (
      <PatternEditor
        key={openPatternId}
        patternId={openPatternId}
        onClose={() => patternStore.close()}
      />
    )
  }

  return (
    <Shell>
      <Header>
        <div>
          <h1>Patterns</h1>
          <p>
            Zeit läuft nach rechts, Tonhöhe nach oben. Jede Ebene ist ein
            eigenes Instrument.
          </p>
        </div>
        <Spacer />
        <Button onClick={createFromSongMaker}>Song-Maker-Raster</Button>
        <Button tone="primary" onClick={createEmpty}>
          + Neues Pattern
        </Button>
      </Header>

      {patterns.length === 0 ? (
        <Empty>
          Noch keine Patterns.
          <br />
          Lege eines an – Töne hältst du über mehrere Schritte, jede
          Instrumentenebene bekommt ihre eigene Spur, und das Pattern-Ende setzt
          du selbst.
        </Empty>
      ) : (
        <Grid>
          {patterns.map((pattern) => (
            <Card
              key={pattern.id}
              onClick={() => patternStore.open(pattern.id)}
            >
              <CardTitle>{pattern.name}</CardTitle>
              <MiniatureView pattern={pattern} />
              <CardMeta>
                {stepCount(pattern)} Schritte · 1/{pattern.gridDivision} ·{" "}
                {pattern.trackLayers.length} Ebenen ·{" "}
                {pattern.trackLayers.reduce((n, l) => n + l.notes.length, 0)}{" "}
                Ereignisse
              </CardMeta>
              <Dots>
                {pattern.trackLayers.map((layer) => (
                  <Dot key={layer.id} color={layer.color} title={layer.name} />
                ))}
              </Dots>
              <CardActions>
                <SmallLink
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(pattern)
                  }}
                >
                  Löschen
                </SmallLink>
                <Spacer />
                <CardMeta>{gridTicks(pattern)} ticks/Step</CardMeta>
              </CardActions>
            </Card>
          ))}
        </Grid>
      )}
    </Shell>
  )
}
