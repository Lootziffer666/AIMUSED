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
import { Localized, useLocalization } from "../../localize/useLocalization"
import { createEmptySongMakerPattern } from "../../services/jamRoom/songMaker"
import {
  addLayer,
  createLayer,
  createPattern,
} from "../../services/pattern/patternOps"
import { removePatternFromSong } from "../../services/pattern/patternSongAdapter"
import { songMakerPatternToMusePattern } from "../../services/pattern/songMakerMigration"
import { Button, PrimaryButton } from "../ui/Button"
import {
  EmptyState,
  Meta,
  Spacer,
  Workspace,
  WorkspaceHeader,
  WorkspaceSubtitle,
  WorkspaceTitle,
} from "../ui/Panel"
import { PatternEditor } from "./PatternEditor"

/**
 * Workspace root. The pattern editor is a distinct working state: either the
 * library is on screen or the editor is – never both, and nothing of the
 * editor leaks into arrange or jam views.
 */

const Grid = styled.div`
  display: grid;
  gap: 0.75rem;
  padding: 1rem;
  overflow-y: auto;
  grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
`

const Card = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--color-divider);
  border-radius: 0.5rem;
  background: var(--color-background);
  text-align: left;
  cursor: pointer;
  outline: none;

  &:hover {
    background: var(--color-highlight);
  }
`

const CardTitle = styled.div`
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`

const Dots = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
`

const Dot = styled.span`
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
`

const MiniPreview = styled.div`
  position: relative;
  height: 3rem;
  overflow: hidden;
  border-radius: 0.3rem;
  background: var(--color-editor-background);
`

const MiniNote = styled.span`
  position: absolute;
  height: 2px;
  border-radius: 1px;
`

const CardActions = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`

const DeleteButton = styled(Button)`
  height: 1.5rem;
  padding: 0 0.5rem;
  font-size: 0.7rem;
  color: var(--color-text-secondary);

  &:hover {
    color: var(--color-red);
  }
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
            style={{
              background: layer.color,
              left: `${(note.startTick / length) * 100}%`,
              width: `${Math.max(2, (note.durationTicks / length) * 100)}%`,
              top: `${8 + (1 - (note.noteNumber - min) / span) * 62}%`,
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
  const localized = useLocalization()
  const patterns = useMobxGetter(patternStore, "patterns")
  const openPatternId = useMobxGetter(patternStore, "openPatternId")

  const createEmpty = useCallback(() => {
    let pattern = createPattern({
      name: `${localized["pattern"]} ${patternStore.patterns.length + 1}`,
      timebase: songStore.song.timebase,
      layers: [createLayer({ name: "Piano", kind: "melodic", program: 0 }, 0)],
    })
    pattern = addLayer(pattern, {
      name: "Kick",
      kind: "percussion",
      drumZoneId: "kick",
    })
    patternStore.save(pattern)
    patternStore.open(pattern.id)
  }, [localized, patternStore, songStore.song.timebase])

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
      toast.info(`${localized["pattern-deleted"]}: ${pattern.name}`)
    },
    [localized, patternStore, songStore.song, toast],
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
    <Workspace>
      <WorkspaceHeader>
        <div>
          <WorkspaceTitle>
            <Localized name="patterns" />
          </WorkspaceTitle>
          <WorkspaceSubtitle>
            <Localized name="pattern-intro" />
          </WorkspaceSubtitle>
        </div>
        <Spacer />
        <Button onClick={createFromSongMaker}>
          <Localized name="pattern-new-song-maker" />
        </Button>
        <PrimaryButton onClick={createEmpty}>
          <Localized name="pattern-new" />
        </PrimaryButton>
      </WorkspaceHeader>

      {patterns.length === 0 ? (
        <EmptyState>
          <Localized name="pattern-empty" />
        </EmptyState>
      ) : (
        <Grid>
          {patterns.map((pattern) => (
            <Card
              key={pattern.id}
              tabIndex={0}
              onClick={() => patternStore.open(pattern.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  patternStore.open(pattern.id)
                }
              }}
            >
              <CardTitle>{pattern.name}</CardTitle>
              <MiniatureView pattern={pattern} />
              <Meta>
                {stepCount(pattern)} · 1/{pattern.gridDivision} ·{" "}
                {pattern.trackLayers.length} ·{" "}
                {pattern.trackLayers.reduce((n, l) => n + l.notes.length, 0)}
              </Meta>
              <Dots>
                {pattern.trackLayers.map((layer) => (
                  <Dot
                    key={layer.id}
                    style={{ background: layer.color }}
                    title={layer.name}
                  />
                ))}
              </Dots>
              <CardActions>
                <DeleteButton
                  onClick={(e) => {
                    e.stopPropagation()
                    remove(pattern)
                  }}
                >
                  <Localized name="delete" />
                </DeleteButton>
                <Spacer />
                <Meta>{gridTicks(pattern)} ticks</Meta>
              </CardActions>
            </Card>
          ))}
        </Grid>
      )}
    </Workspace>
  )
}
