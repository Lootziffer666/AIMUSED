import type { MuseSection } from "../analysis/types";
import { createId } from "../id";
import type { MuseArrangementSection, MuseDramaturgyStage } from "./types";

/** Relative "weight" of each stage — used to gate layer entrances against a recipe's max density. */
export const DRAMATURGY_STAGE_WEIGHT: Record<MuseDramaturgyStage, number> = {
  intro: 0,
  buildup: 1,
  release: 0.5,
  buildup2: 1.5,
  climax: 2,
  outro: 1,
};

const FIXED_SEQUENCES: Record<number, MuseDramaturgyStage[]> = {
  1: ["climax"],
  2: ["intro", "climax"],
  3: ["intro", "buildup", "climax"],
  4: ["intro", "buildup", "climax", "outro"],
  5: ["intro", "buildup", "climax", "buildup2", "outro"],
};

/**
 * Maps the analysis' detected sections onto MUSE's six-stage dramaturgy
 * (intro / buildup / release / buildup2 / climax / outro). Reuses section
 * ids from an existing plan when start/end ticks match, so user overrides
 * on intensity/layers survive a recipe re-apply.
 */
export function assignDramaturgyStages(
  sections: MuseSection[],
  existingSections: MuseArrangementSection[] = [],
): MuseArrangementSection[] {
  const stages = stageSequenceFor(sections.length);
  return sections.map((section, i) => {
    const reused = existingSections.find(
      (e) => e.startTick === section.startTick && e.endTick === section.endTick,
    );
    return {
      id: reused?.id ?? createId("arr-section"),
      sourceSectionId: section.id,
      startTick: section.startTick,
      endTick: section.endTick,
      label: section.label,
      dramaturgyStage: stages[i] ?? "climax",
    };
  });
}

function stageSequenceFor(count: number): MuseDramaturgyStage[] {
  if (count <= 0) return [];
  if (FIXED_SEQUENCES[count]) return FIXED_SEQUENCES[count];

  const middleCount = count - 2;
  const cycle: MuseDramaturgyStage[] = [
    "buildup",
    "release",
    "buildup2",
    "climax",
  ];
  const middle: MuseDramaturgyStage[] = [];
  for (let i = 0; i < middleCount; i++) middle.push(cycle[i % cycle.length]);
  return ["intro", ...middle, "outro"];
}
