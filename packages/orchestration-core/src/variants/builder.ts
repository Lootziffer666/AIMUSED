import { createId } from "../id";
import type { MuseArrangementPlan } from "../orchestration/types";
import type { MuseArrangementVariant, MuseVariantKind } from "./types";

interface VariantSpec {
  kind: MuseVariantKind;
  name: string;
  intensity: number;
  /** Which layers (matched by role name — MuseLayerPlan.name is the role) stay enabled in this variant. */
  keepsRole: (role: string) => boolean;
  transitionCompatibility: MuseVariantKind[];
}

const VARIANT_SPECS: VariantSpec[] = [
  {
    kind: "full",
    name: "Full Arrangement",
    intensity: 1,
    keepsRole: () => true,
    transitionCompatibility: ["reduced", "finale"],
  },
  {
    kind: "reduced",
    name: "Reduced",
    intensity: 0.4,
    keepsRole: (role) =>
      role === "melody" ||
      role === "bass" ||
      role === "harmony" ||
      role === "chordPad",
    transitionCompatibility: ["full", "exploration"],
  },
  {
    kind: "exploration",
    name: "Exploration",
    intensity: 0.3,
    keepsRole: (role) =>
      role === "melody" ||
      role === "bass" ||
      role === "harmony" ||
      role === "chordPad" ||
      role === "pad",
    transitionCompatibility: ["reduced", "danger"],
  },
  {
    kind: "danger",
    name: "Danger",
    intensity: 0.7,
    keepsRole: (role) => role !== "pad" && role !== "effect",
    transitionCompatibility: ["exploration", "combat"],
  },
  {
    kind: "combat",
    name: "Combat",
    intensity: 0.9,
    keepsRole: () => true,
    transitionCompatibility: ["danger", "finale"],
  },
  {
    kind: "finale",
    name: "Finale",
    intensity: 1,
    keepsRole: () => true,
    transitionCompatibility: ["combat", "full"],
  },
];

/**
 * Derives the six baseline variants from the current arrangement's layers —
 * no recomposition, just which layers stay active and an overall intensity
 * multiplier per variant, ready for Adaptive Pathos to consume later.
 */
export function buildDefaultVariants(
  plan: MuseArrangementPlan,
): MuseArrangementVariant[] {
  return VARIANT_SPECS.map((spec) => {
    const enabledLayers = plan.layers
      .filter((l) => spec.keepsRole(l.name))
      .map((l) => l.id);
    const overrides = plan.layers.map((l) => ({
      layerId: l.id,
      active: enabledLayers.includes(l.id),
      intensityMultiplier: spec.intensity,
    }));
    return {
      id: createId("variant"),
      name: spec.name,
      kind: spec.kind,
      baseArrangementId: plan.id,
      intensity: spec.intensity,
      enabledLayers,
      overrides,
      transitionCompatibility: spec.transitionCompatibility,
    };
  });
}
