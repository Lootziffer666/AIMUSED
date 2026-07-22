import { createId } from "../id";
import type { MuseArrangementPlan } from "../orchestration/types";
import type {
  MuseAdaptiveCuePoint,
  MuseAdaptiveLoopRegion,
  MuseAdaptiveMetadata,
  MuseArrangementVariant,
} from "./types";

function variantIdsOfKind(
  variants: MuseArrangementVariant[],
  kinds: MuseArrangementVariant["kind"][],
): string[] {
  return variants.filter((v) => kinds.includes(v.kind)).map((v) => v.id);
}

/**
 * Prepares (but does not run) the metadata Adaptive Pathos needs downstream:
 * cue points at structurally meaningful ticks, and loop-region candidates
 * over the piece's steady-state sections. MUSE stops at data preparation —
 * no runtime adaptive playback engine lives here.
 */
export function buildAdaptiveMetadata(
  plan: MuseArrangementPlan,
  variants: MuseArrangementVariant[],
  barTicks: number,
): MuseAdaptiveMetadata {
  const cuePoints: MuseAdaptiveCuePoint[] = [];
  const loopRegions: MuseAdaptiveLoopRegion[] = [];

  const intro = plan.sections.find((s) => s.dramaturgyStage === "intro");
  const mainLoopSections = plan.sections.filter(
    (s) =>
      s.dramaturgyStage === "buildup" ||
      s.dramaturgyStage === "release" ||
      s.dramaturgyStage === "buildup2",
  );
  const climaxSections = plan.sections.filter(
    (s) => s.dramaturgyStage === "climax",
  );
  const outro = [...plan.sections]
    .reverse()
    .find((s) => s.dramaturgyStage === "outro");

  if (intro) {
    cuePoints.push({
      id: createId("cue"),
      tick: intro.startTick,
      kind: "intro",
      compatibleVariantIds: variantIdsOfKind(variants, [
        "exploration",
        "reduced",
      ]),
    });
  }
  for (const section of mainLoopSections) {
    cuePoints.push({
      id: createId("cue"),
      tick: section.startTick,
      kind: "mainLoopStart",
      compatibleVariantIds: variantIdsOfKind(variants, [
        "exploration",
        "danger",
        "reduced",
      ]),
    });
  }
  for (const section of climaxSections) {
    cuePoints.push({
      id: createId("cue"),
      tick: section.startTick,
      kind: "transition",
      compatibleVariantIds: variantIdsOfKind(variants, ["combat", "finale"]),
    });
  }
  if (outro) {
    cuePoints.push({
      id: createId("cue"),
      tick: outro.startTick,
      kind: "outro",
      compatibleVariantIds: variantIdsOfKind(variants, ["finale"]),
    });
    cuePoints.push({
      id: createId("cue"),
      tick: outro.endTick,
      kind: "stinger",
      compatibleVariantIds: variantIdsOfKind(variants, ["finale", "combat"]),
    });
  }

  const explorationVariant =
    variants.find((v) => v.kind === "exploration") ?? variants[0];
  for (const section of mainLoopSections) {
    loopRegions.push({
      id: createId("loop"),
      startTick: section.startTick,
      endTick: section.endTick,
      variantId: explorationVariant.id,
      barAligned:
        section.startTick % barTicks === 0 && section.endTick % barTicks === 0,
    });
  }

  return {
    cuePoints,
    loopRegions,
    intensityLevels: [0, 0.33, 0.5, 0.66, 0.85, 1],
  };
}
