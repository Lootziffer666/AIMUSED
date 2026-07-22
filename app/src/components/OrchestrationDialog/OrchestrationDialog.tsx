import styled from "@emotion/styled"
import { useToast } from "dialog-hooks"
import { FC, useCallback, useMemo, useState } from "react"
import {
  analyzeProject,
  buildArrangedExportTracks,
  getInstrumentById,
  MUSE_RECIPE_CATALOG,
} from "@signal-app/orchestration-core"
import { useOrchestration } from "../../hooks/useOrchestration"
import { useRootView } from "../../hooks/useRootView"
import { useStores } from "../../hooks/useStores"
import { Localized, useLocalization } from "../../localize/useLocalization"
import {
  applyRenderResultToSong,
  songToMuseProject,
} from "../../services/orchestration/songAdapter"
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "../Dialog/Dialog"
import { Button, PrimaryButton } from "../ui/Button"

const Content = styled.div`
  min-width: 34rem;
  max-width: 42rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
`

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
`

const SectionHeading = styled.h3`
  margin: 0;
  font-size: 0.9rem;
  color: var(--color-text-secondary);
`

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 0.75rem;
`

const List = styled.div`
  display: flex;
  flex-direction: column;
  max-height: 12rem;
  overflow-y: auto;
  background: var(--color-background-secondary);
  border-radius: 0.3rem;
`

const ListItem = styled.div`
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--color-divider);
  font-size: 0.8rem;

  &:last-child {
    border-bottom: none;
  }
`

const ItemTitle = styled.div`
  display: flex;
  justify-content: space-between;
  font-weight: 600;
`

const Evidence = styled.div`
  color: var(--color-text-secondary);
  font-size: 0.75rem;
  margin-top: 0.15rem;
`

const RecipeGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
  gap: 0.5rem;
`

const RecipeCard = styled.button<{ selected: boolean }>`
  text-align: left;
  border: 1px solid
    ${({ selected }) => (selected ? "var(--color-theme)" : "var(--color-divider)")};
  background: ${({ selected }) =>
    selected ? "var(--color-highlight)" : "var(--color-background-secondary)"};
  border-radius: 0.3rem;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  color: var(--color-text);
  font-size: 0.8rem;

  &:hover {
    background: var(--color-highlight);
  }
`

const RecipeName = styled.div`
  font-weight: 600;
  margin-bottom: 0.2rem;
`

const RecipeDescription = styled.div`
  font-size: 0.7rem;
  color: var(--color-text-secondary);
`

const Empty = styled.div`
  font-size: 0.8rem;
  color: var(--color-text-secondary);
  padding: 0.5rem 0;
`

export const OrchestrationDialog: FC = () => {
  const { openOrchestrationDialog: open, setOpenOrchestrationDialog } =
    useRootView()
  const { songStore, orchestrationStore } = useStores()
  const { project, analysis, arrangement, canUndo, canRedo, undo, redo } =
    useOrchestration()
  const localized = useLocalization()
  const toast = useToast()

  const [selectedRecipeId, setSelectedRecipeId] = useState(
    MUSE_RECIPE_CATALOG[0].id,
  )
  const [isBusy, setIsBusy] = useState(false)

  const onClose = useCallback(
    () => setOpenOrchestrationDialog(false),
    [setOpenOrchestrationDialog],
  )

  const trackName = useCallback(
    (trackId: string) =>
      project?.tracks.find((t) => t.id === trackId)?.name ?? trackId,
    [project],
  )

  const onAnalyze = useCallback(async () => {
    setIsBusy(true)
    try {
      const song = songStore.song
      const { project: newProject } = songToMuseProject(
        song,
        song.name || "Song",
      )
      newProject.analysis = analyzeProject(newProject)
      orchestrationStore.loadProject(newProject)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setIsBusy(false)
    }
  }, [songStore, orchestrationStore, toast])

  const onApplyRecipe = useCallback(() => {
    try {
      orchestrationStore.dispatch({
        type: "APPLY_RECIPE",
        recipeId: selectedRecipeId,
        preserveUserOverrides: true,
      })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }, [orchestrationStore, selectedRecipeId, toast])

  const onApplyToSong = useCallback(() => {
    if (project === undefined || project === null || !project.arrangement) {
      return
    }
    try {
      const exportTracks = buildArrangedExportTracks(project)
      applyRenderResultToSong(songStore.song, exportTracks)
      toast.success(localized["orchestration-applied"])
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }, [project, songStore, toast, localized, onClose])

  const trackAnalyses = useMemo(() => analysis?.tracks ?? [], [analysis])

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogTitle>
        <Localized name="orchestration-title" />
      </DialogTitle>
      <DialogContent>
        <Content>
          <Section>
            <Row>
              <PrimaryButton onClick={onAnalyze} disabled={isBusy}>
                <Localized
                  name={
                    isBusy ? "orchestration-analyzing" : "orchestration-analyze"
                  }
                />
              </PrimaryButton>
              {canUndo && (
                <Button onClick={undo}>
                  <Localized name="orchestration-undo" />
                </Button>
              )}
              {canRedo && (
                <Button onClick={redo}>
                  <Localized name="orchestration-redo" />
                </Button>
              )}
            </Row>
          </Section>

          <Section>
            <SectionHeading>
              <Localized name="orchestration-roles-heading" />
            </SectionHeading>
            {trackAnalyses.length === 0 ? (
              <Empty>
                <Localized name="orchestration-no-analysis" />
              </Empty>
            ) : (
              <List>
                {trackAnalyses.map((t) => {
                  const primary = t.roles[0]
                  return (
                    <ListItem key={t.trackId}>
                      <ItemTitle>
                        <span>{trackName(t.trackId)}</span>
                        <span>
                          {primary?.role ?? "unknown"} (
                          {Math.round((primary?.confidence ?? 0) * 100)}%)
                        </span>
                      </ItemTitle>
                      {primary && primary.evidence.length > 0 && (
                        <Evidence>{primary.evidence.join("; ")}</Evidence>
                      )}
                    </ListItem>
                  )
                })}
              </List>
            )}
          </Section>

          <Section>
            <SectionHeading>
              <Localized name="orchestration-recipe-heading" />
            </SectionHeading>
            <RecipeGrid>
              {MUSE_RECIPE_CATALOG.map((recipe) => (
                <RecipeCard
                  key={recipe.id}
                  type="button"
                  selected={recipe.id === selectedRecipeId}
                  onClick={() => setSelectedRecipeId(recipe.id)}
                >
                  <RecipeName>{recipe.name}</RecipeName>
                  <RecipeDescription>{recipe.description}</RecipeDescription>
                </RecipeCard>
              ))}
            </RecipeGrid>
            <Row>
              <Button onClick={onApplyRecipe} disabled={analysis === null}>
                <Localized name="orchestration-apply-recipe" />
              </Button>
            </Row>
          </Section>

          <Section>
            <SectionHeading>
              <Localized name="orchestration-results-heading" />
            </SectionHeading>
            {!arrangement ? (
              <Empty>
                <Localized name="orchestration-no-arrangement" />
              </Empty>
            ) : (
              <List>
                {arrangement.assignments.map((assignment) => {
                  const instrument = getInstrumentById(
                    assignment.instrumentId.value,
                  )
                  return (
                    <ListItem key={assignment.id}>
                      <ItemTitle>
                        <span>{trackName(assignment.targetTrackId)}</span>
                        <span>
                          {instrument?.name ?? assignment.instrumentId.value}
                        </span>
                      </ItemTitle>
                      <Evidence>
                        <Localized name="orchestration-origin" />:{" "}
                        {assignment.instrumentId.origin} —{" "}
                        {assignment.instrumentId.reason}
                      </Evidence>
                    </ListItem>
                  )
                })}
              </List>
            )}
          </Section>
        </Content>
      </DialogContent>
      <DialogActions>
        <PrimaryButton onClick={onApplyToSong} disabled={!arrangement}>
          <Localized name="orchestration-apply-to-song" />
        </PrimaryButton>
        <div style={{ flex: 1 }} />
        <Button onClick={onClose}>
          <Localized name="close" />
        </Button>
      </DialogActions>
    </Dialog>
  )
}
