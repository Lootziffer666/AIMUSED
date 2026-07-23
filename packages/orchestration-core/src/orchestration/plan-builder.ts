import type { MuseMidiProject } from "../project-types";
import type { MuseMusicalRole, MuseTrackAnalysis } from "../analysis/types";
import { createId } from "../id";
import { resolveRecipe } from "./recipes";
import {
  getInstrumentById,
  getInstrumentsForRole,
  MUSE_INSTRUMENT_CATALOG,
} from "./instruments";
import { checkRegisterFit, suggestOctaveShift } from "./register-rules";
import { deriveDefaultArticulation } from "./articulation";
import { assignDramaturgyStages, DRAMATURGY_STAGE_WEIGHT } from "./dramaturgy";
import type {
  MuseArrangementPlan,
  MuseArrangementSection,
  MuseDecision,
  MuseDecisionOrigin,
  MuseDynamicPlan,
  MuseInstrumentAssignment,
  MuseInstrumentDefinition,
  MuseLayerPlan,
  MuseOrchestrationRecipe,
  MuseWarning,
} from "./types";

export interface BuildArrangementPlanOptions {
  project: MuseMidiProject;
  recipeId: string;
  seed: number;
  preserveUserOverrides: boolean;
  existingPlan?: MuseArrangementPlan | null;
}

/** -1 marks "always active" core roles that protect the musical source. */
const ROLE_ACTIVATION_WEIGHT: Record<MuseMusicalRole, number> = {
  melody: -1,
  bass: -1,
  harmony: -1,
  chordPad: -1,
  counterMelody: 1,
  rhythmicOstinato: 1,
  percussion: 1,
  pad: 1.5,
  accent: 1.5,
  effect: 2,
  unknown: 1,
};

const BASE_DENSITY_REFERENCE = 6;

function decision<T>(
  value: T,
  origin: MuseDecisionOrigin,
  locked: boolean,
  reason: string,
): MuseDecision<T> {
  return { value, origin, locked, reason };
}

function reuseIfLocked<T>(
  existing: MuseDecision<T> | undefined,
  preserve: boolean,
  fallback: () => MuseDecision<T>,
): MuseDecision<T> {
  if (preserve && existing?.locked) return existing;
  return fallback();
}

export function buildArrangementPlan(
  options: BuildArrangementPlanOptions,
): MuseArrangementPlan {
  const { project, recipeId, seed, preserveUserOverrides, existingPlan } =
    options;
  const analysis = project.analysis;
  if (!analysis) {
    throw new Error(
      "Das Projekt wurde noch nicht analysiert — Orchestrierung benötigt ein Analyseergebnis.",
    );
  }

  const recipe = resolveRecipe(recipeId);
  const warnings: MuseWarning[] = [];

  const sections = assignDramaturgyStages(
    analysis.global.sections,
    preserveUserOverrides ? (existingPlan?.sections ?? []) : [],
  );

  const existingAssignmentByTrack = new Map(
    (existingPlan?.assignments ?? []).map((a) => [a.targetTrackId, a]),
  );

  const assignments: MuseInstrumentAssignment[] = project.tracks.map(
    (track) => {
      const stats = analysis.tracks.find(
        (t) => t.trackId === track.id,
      ) as MuseTrackAnalysis;
      const existing = existingAssignmentByTrack.get(track.id);
      const topDetection = stats.roles[0] ?? {
        role: "unknown" as const,
        confidence: 0,
        evidence: [],
      };

      const roleDecision = reuseIfLocked(
        existing?.role,
        preserveUserOverrides,
        () =>
          decision(
            topDetection.role,
            "analysis",
            false,
            topDetection.evidence.length > 0
              ? topDetection.evidence.join("; ")
              : "keine eindeutigen Merkmale gefunden",
          ),
      );
      const role = roleDecision.value;

      const rolePreference = recipe.rolePreferences.find(
        (p) => p.role === role,
      );
      const candidateIds = rolePreference?.instrumentIds ?? [];
      const isRecipeSilencedRole =
        candidateIds.length === 0 &&
        (role === "percussion" ? recipe.percussionStrategy === "none" : true);

      const { instrument, octaveShiftSemitones, fitsAbsolute } =
        pickInstrumentForRole(candidateIds, role, stats);

      const instrumentDecision = reuseIfLocked(
        existing?.instrumentId,
        preserveUserOverrides,
        () =>
          decision(
            instrument.id,
            "recipe",
            false,
            candidateIds.includes(instrument.id)
              ? `Rezept "${recipe.name}" bevorzugt ${instrument.name} für die Rolle ${role}`
              : `Kein rezeptspezifisches Instrument passte im Register; Fallback auf ${instrument.name}`,
          ),
      );

      const octaveShiftDecision = reuseIfLocked(
        existing?.octaveShift,
        preserveUserOverrides,
        () =>
          decision(
            octaveShiftSemitones / 12,
            "analysis",
            false,
            octaveShiftSemitones === 0
              ? "Originallage passt bereits in das Register des Instruments"
              : `Register um ${octaveShiftSemitones / 12} Oktave(n) angepasst, um in ${instrument.name} zu passen`,
          ),
      );

      const doublingDecision = reuseIfLocked(
        existing?.doublingInstrumentIds,
        preserveUserOverrides,
        () =>
          decision(
            rolePreference?.doubling?.instrumentIds ?? [],
            "recipe",
            false,
            rolePreference?.doubling
              ? `Rezept verdoppelt mit ${rolePreference.doubling.instrumentIds.join(", ")} (${
                  rolePreference.doubling.condition === "climax"
                    ? "nur im Höhepunkt"
                    : "durchgehend"
                })`
              : "keine Verdopplung im Rezept vorgesehen",
          ),
      );

      const articulationDecision = reuseIfLocked(
        existing?.articulation,
        preserveUserOverrides,
        () => {
          const bias = recipe.articulationBias[role];
          const value = deriveDefaultArticulation(
            role,
            {
              shortNoteRatio: stats.shortNoteRatio,
              longNoteRatio: stats.longNoteRatio,
              averageVelocity: stats.averageVelocity,
            },
            instrument,
            bias,
          );
          return decision(
            value,
            bias ? "recipe" : "analysis",
            false,
            bias
              ? `Rezept "${recipe.name}" bevorzugt ${value} für ${role}`
              : `aus Notenlängen/Velocity von "${track.name ?? track.id}" abgeleitet`,
          );
        },
      );

      const mutedDecision = reuseIfLocked(
        existing?.muted,
        preserveUserOverrides,
        () =>
          decision(
            isRecipeSilencedRole,
            isRecipeSilencedRole ? "recipe" : "source",
            false,
            isRecipeSilencedRole
              ? `Rezept "${recipe.name}" verzichtet auf ${role}`
              : "keine Stummschaltung",
          ),
      );

      if (!fitsAbsolute) {
        warnings.push({
          id: createId("warning"),
          severity: "warning",
          message: `Der Tonumfang von "${track.name ?? track.id}" passt auch nach Oktavverschiebung nicht vollständig in ${instrument.name}; Randnoten werden beim Rendern geclippt.`,
          targetId: track.id,
        });
      }
      if (instrument.maxVoices === 1 && stats.polyphony > 1) {
        warnings.push({
          id: createId("warning"),
          severity: "info",
          message: `${instrument.name} ist monophon: Nur die oberste Stimme von "${track.name ?? track.id}" wird verwendet.`,
          targetId: track.id,
        });
      } else if (
        instrument.maxVoices > 1 &&
        stats.polyphony > instrument.maxVoices
      ) {
        warnings.push({
          id: createId("warning"),
          severity: "info",
          message: `"${track.name ?? track.id}" hat mehr gleichzeitige Stimmen (${stats.polyphony}) als ${instrument.name} sinnvoll spielen kann (max. ${instrument.maxVoices}); Akkorde werden reduziert.`,
          targetId: track.id,
        });
      }

      return {
        id: existing?.id ?? createId("assignment"),
        targetTrackId: track.id,
        role: roleDecision,
        instrumentId: instrumentDecision,
        doublingInstrumentIds: doublingDecision,
        octaveShift: octaveShiftDecision,
        articulation: articulationDecision,
        muted: mutedDecision,
      };
    },
  );

  if (recipe.percussionStrategy === "none") {
    warnings.push({
      id: createId("warning"),
      severity: "info",
      message: `Rezept "${recipe.name}" verzichtet bewusst auf Percussion.`,
    });
  }

  const existingDynamicsBySection = new Map(
    (existingPlan?.dynamics ?? []).map((d) => [d.sectionId, d]),
  );
  const dynamics: MuseDynamicPlan[] = sections.map((section) => {
    const existing = existingDynamicsBySection.get(section.id);
    const intensity = reuseIfLocked(
      existing?.intensity,
      preserveUserOverrides,
      () =>
        decision(
          recipe.dramaturgyIntensityByStage[section.dramaturgyStage],
          "recipe",
          false,
          `Zielintensität für Stufe "${section.dramaturgyStage}" laut Rezept`,
        ),
    );
    return { sectionId: section.id, intensity };
  });

  const layers = buildLayers(
    assignments,
    sections,
    recipe,
    project.timeline.totalTicks,
    preserveUserOverrides ? (existingPlan?.layers ?? []) : [],
  );

  return {
    id: existingPlan?.id ?? createId("arrangement"),
    recipeId: recipe.id,
    sourceProjectId: project.id,
    createdAt: new Date().toISOString(),
    seed,
    sections,
    assignments,
    dynamics,
    layers,
    warnings,
  };
}

function pickInstrumentForRole(
  candidateIds: string[],
  role: MuseMusicalRole,
  stats: MuseTrackAnalysis,
): {
  instrument: MuseInstrumentDefinition;
  octaveShiftSemitones: number;
  fitsAbsolute: boolean;
} {
  const pool =
    candidateIds.length > 0
      ? (candidateIds
          .map((id) => getInstrumentById(id))
          .filter(Boolean) as MuseInstrumentDefinition[])
      : getInstrumentsForRole(role).length > 0
        ? getInstrumentsForRole(role)
        : MUSE_INSTRUMENT_CATALOG;

  let best: {
    instrument: MuseInstrumentDefinition;
    octaveShiftSemitones: number;
    fitsAbsolute: boolean;
  } | null = null;
  for (const instrument of pool) {
    const octaveShiftSemitones = suggestOctaveShift(
      instrument,
      stats.meanPitch,
    );
    const fit = checkRegisterFit(
      instrument,
      stats.pitchRange,
      octaveShiftSemitones,
    );
    if (fit.fitsAbsolute)
      return { instrument, octaveShiftSemitones, fitsAbsolute: true };
    if (!best) best = { instrument, octaveShiftSemitones, fitsAbsolute: false };
  }
  return (
    best ?? {
      instrument: pool[0] ?? MUSE_INSTRUMENT_CATALOG[0],
      octaveShiftSemitones: 0,
      fitsAbsolute: false,
    }
  );
}

function buildLayers(
  assignments: MuseInstrumentAssignment[],
  sections: MuseArrangementSection[],
  recipe: MuseOrchestrationRecipe,
  totalTicks: number,
  existingLayers: MuseLayerPlan[],
): MuseLayerPlan[] {
  const byRole = new Map<MuseMusicalRole, MuseInstrumentAssignment[]>();
  for (const a of assignments) {
    const list = byRole.get(a.role.value) ?? [];
    list.push(a);
    byRole.set(a.role.value, list);
  }

  const existingByRole = new Map(existingLayers.map((l) => [l.name, l]));

  const layers: MuseLayerPlan[] = [];
  for (const [role, roleAssignments] of byRole) {
    const instrumentIds = new Set(
      roleAssignments.map((a) => a.instrumentId.value),
    );
    const primaryInstrument =
      getInstrumentById([...instrumentIds][0]) ?? MUSE_INSTRUMENT_CATALOG[0];
    const existing = existingByRole.get(role);

    const weight = ROLE_ACTIVATION_WEIGHT[role];
    const alwaysActive = weight < 0;
    const threshold = alwaysActive
      ? -1
      : weight * (BASE_DENSITY_REFERENCE / recipe.maxDensity);

    const qualifying = alwaysActive
      ? sections
      : sections.filter(
          (s) => DRAMATURGY_STAGE_WEIGHT[s.dramaturgyStage] >= threshold,
        );
    const effectiveSections =
      qualifying.length > 0
        ? qualifying
        : [
            sections.reduce(
              (a, b) =>
                DRAMATURGY_STAGE_WEIGHT[b.dramaturgyStage] >
                DRAMATURGY_STAGE_WEIGHT[a.dramaturgyStage]
                  ? b
                  : a,
              sections[0],
            ),
          ];

    const startTick = Math.min(...effectiveSections.map((s) => s.startTick));
    const isEphemeral =
      !alwaysActive &&
      (role === "accent" || role === "effect" || role === "pad") &&
      recipe.finaleBehavior !== "full-tutti";
    const endTick = isEphemeral
      ? Math.max(...effectiveSections.map((s) => s.endTick))
      : totalTicks;

    const activeRange = reuseIfLocked(existing?.activeRange, true, () =>
      decision(
        { startTick, endTick },
        "recipe",
        false,
        alwaysActive
          ? "Kernrolle bleibt durchgängig aktiv, um die musikalische Quelle zu schützen"
          : `Schicht setzt ab Dramaturgiestufe mit Gewicht ${threshold.toFixed(2)} ein`,
      ),
    );

    layers.push({
      id: existing?.id ?? createId("layer"),
      name: role,
      family: primaryInstrument.family,
      sourceTrackIds: roleAssignments.map((a) => a.targetTrackId),
      activeRange,
    });
  }

  return layers;
}
