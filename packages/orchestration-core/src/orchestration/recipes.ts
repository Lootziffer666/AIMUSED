import type { MuseOrchestrationRecipe } from "./types";

const faithfulRestoration: MuseOrchestrationRecipe = {
  id: "faithful_restoration",
  name: "Originalgetreu restauriert",
  description:
    "Bewahrt die ursprünglichen Rollen weitgehend, ersetzt nur die Klangfarben durch bessere Instrumente. Leichte Humanisierung, klare Dynamik, keine aggressive Neuinterpretation.",
  preferredFamilies: ["keys", "strings", "woodwinds"],
  rolePreferences: [
    { role: "melody", instrumentIds: ["flute", "solo_violin", "piano"] },
    { role: "counterMelody", instrumentIds: ["oboe", "clarinet"] },
    { role: "harmony", instrumentIds: ["string_ensemble", "piano"] },
    { role: "chordPad", instrumentIds: ["string_ensemble", "piano"] },
    { role: "bass", instrumentIds: ["double_bass", "solo_cello"] },
    { role: "rhythmicOstinato", instrumentIds: ["acoustic_guitar", "piano"] },
    { role: "percussion", instrumentIds: ["orchestral_percussion"] },
    { role: "pad", instrumentIds: ["choir_pad"] },
    { role: "accent", instrumentIds: ["orchestral_harp"] },
    { role: "effect", instrumentIds: ["orchestra_hit_fx"] },
    { role: "unknown", instrumentIds: ["piano"] },
  ],
  dramaturgyIntensityByStage: {
    intro: 0.35,
    buildup: 0.5,
    release: 0.4,
    buildup2: 0.55,
    climax: 0.65,
    outro: 0.4,
  },
  maxDensity: 4,
  percussionStrategy: "light",
  registerRules: { avoidLowClusters: true, maxVoicesPerRole: 2 },
  articulationBias: {},
  humanization: { timingMs: 8, velocityRange: 6, durationPercent: 4 },
  finaleBehavior: "restrained",
};

const cinematicAdventure: MuseOrchestrationRecipe = {
  id: "cinematic_adventure",
  name: "Cinematic Adventure",
  description:
    "Holzbläser und leichte Streicher führen das Motiv, Blech tritt kontrolliert hinzu, orchestrale Percussion baut schrittweise auf – bis zu einem deutlichen, aber motivtreuen Finale.",
  preferredFamilies: ["woodwinds", "strings", "brass", "percussion"],
  rolePreferences: [
    {
      role: "melody",
      instrumentIds: ["flute", "oboe", "solo_violin"],
      doubling: { instrumentIds: ["string_ensemble"], condition: "climax" },
    },
    { role: "counterMelody", instrumentIds: ["clarinet", "viola"] },
    { role: "harmony", instrumentIds: ["string_ensemble", "french_horn"] },
    { role: "chordPad", instrumentIds: ["string_ensemble", "choir_pad"] },
    {
      role: "bass",
      instrumentIds: ["double_bass", "tuba"],
      doubling: { instrumentIds: ["trombone"], condition: "climax" },
    },
    {
      role: "rhythmicOstinato",
      instrumentIds: ["acoustic_guitar", "string_ensemble"],
    },
    { role: "percussion", instrumentIds: ["orchestral_percussion", "timpani"] },
    { role: "pad", instrumentIds: ["choir_pad", "synth_pad"] },
    {
      role: "accent",
      instrumentIds: ["trumpet", "orchestral_harp"],
      doubling: { instrumentIds: ["french_horn"], condition: "climax" },
    },
    { role: "effect", instrumentIds: ["orchestra_hit_fx"] },
    { role: "unknown", instrumentIds: ["string_ensemble"] },
  ],
  dramaturgyIntensityByStage: {
    intro: 0.25,
    buildup: 0.5,
    release: 0.35,
    buildup2: 0.65,
    climax: 1.0,
    outro: 0.6,
  },
  maxDensity: 7,
  percussionStrategy: "orchestral",
  registerRules: { avoidLowClusters: true, maxVoicesPerRole: 4 },
  articulationBias: { melody: "legato", bass: "accent", percussion: "marcato" },
  humanization: { timingMs: 12, velocityRange: 10, durationPercent: 6 },
  finaleBehavior: "motif-return",
};

const intimateEnsemble: MuseOrchestrationRecipe = {
  id: "intimate_ensemble",
  name: "Intimes Ensemble",
  description:
    "Reduzierte Besetzung aus Klavier, Holzbläsern und einer kleinen Streichergruppe. Wenig Percussion, viel Raum für die Hauptmelodie.",
  preferredFamilies: ["keys", "woodwinds", "strings"],
  rolePreferences: [
    { role: "melody", instrumentIds: ["piano", "flute", "solo_violin"] },
    { role: "counterMelody", instrumentIds: ["clarinet", "solo_cello"] },
    { role: "harmony", instrumentIds: ["string_ensemble", "piano"] },
    { role: "chordPad", instrumentIds: ["piano"] },
    { role: "bass", instrumentIds: ["solo_cello", "double_bass"] },
    { role: "rhythmicOstinato", instrumentIds: ["piano"] },
    { role: "percussion", instrumentIds: [] },
    { role: "pad", instrumentIds: ["choir_pad"] },
    { role: "accent", instrumentIds: ["orchestral_harp"] },
    { role: "effect", instrumentIds: [] },
    { role: "unknown", instrumentIds: ["piano"] },
  ],
  dramaturgyIntensityByStage: {
    intro: 0.2,
    buildup: 0.35,
    release: 0.25,
    buildup2: 0.4,
    climax: 0.55,
    outro: 0.3,
  },
  maxDensity: 3,
  percussionStrategy: "none",
  registerRules: { avoidLowClusters: true, maxVoicesPerRole: 2 },
  articulationBias: { melody: "legato" },
  humanization: { timingMs: 15, velocityRange: 8, durationPercent: 8 },
  finaleBehavior: "restrained",
};

const darkJourney: MuseOrchestrationRecipe = {
  id: "dark_journey",
  name: "Dark Journey",
  description:
    "Tiefe Streicher und Holzbläser, kontrolliertes Blech, rhythmische Spannung und dunkle Texturen – nie durchgehend maximal laut.",
  preferredFamilies: ["strings", "woodwinds", "brass"],
  rolePreferences: [
    { role: "melody", instrumentIds: ["solo_cello", "bassoon", "clarinet"] },
    { role: "counterMelody", instrumentIds: ["viola", "bassoon"] },
    { role: "harmony", instrumentIds: ["string_ensemble", "trombone"] },
    { role: "chordPad", instrumentIds: ["string_ensemble", "choir_pad"] },
    {
      role: "bass",
      instrumentIds: ["double_bass", "tuba"],
      doubling: { instrumentIds: ["trombone"], condition: "always" },
    },
    {
      role: "rhythmicOstinato",
      instrumentIds: ["solo_cello", "string_ensemble"],
    },
    { role: "percussion", instrumentIds: ["timpani", "orchestral_percussion"] },
    { role: "pad", instrumentIds: ["choir_pad", "synth_pad"] },
    { role: "accent", instrumentIds: ["french_horn"] },
    { role: "effect", instrumentIds: ["orchestra_hit_fx"] },
    { role: "unknown", instrumentIds: ["string_ensemble"] },
  ],
  dramaturgyIntensityByStage: {
    intro: 0.3,
    buildup: 0.45,
    release: 0.3,
    buildup2: 0.55,
    climax: 0.75,
    outro: 0.35,
  },
  maxDensity: 5,
  percussionStrategy: "light",
  registerRules: { avoidLowClusters: true, maxVoicesPerRole: 3 },
  articulationBias: { melody: "sustain", bass: "tremolo" },
  humanization: { timingMs: 10, velocityRange: 7, durationPercent: 5 },
  finaleBehavior: "restrained",
};

const grandFinale: MuseOrchestrationRecipe = {
  id: "grand_finale",
  name: "Grand Finale",
  description:
    "Vollständiges Ensemble mit motivischer Wiederaufnahme, verstärkter Bassbewegung, größerer Percussion und kontrollierten Verdopplungen zu einem klaren Höhepunkt.",
  extends: "cinematic_adventure",
  preferredFamilies: ["brass", "strings", "percussion", "woodwinds", "choir"],
  rolePreferences: [
    {
      role: "melody",
      instrumentIds: ["solo_violin", "flute", "trumpet"],
      doubling: {
        instrumentIds: ["string_ensemble", "trumpet"],
        condition: "always",
      },
    },
    { role: "counterMelody", instrumentIds: ["french_horn", "viola"] },
    {
      role: "harmony",
      instrumentIds: ["string_ensemble", "french_horn", "choir_pad"],
    },
    { role: "chordPad", instrumentIds: ["string_ensemble", "choir_pad"] },
    {
      role: "bass",
      instrumentIds: ["double_bass", "tuba"],
      doubling: { instrumentIds: ["trombone", "bassoon"], condition: "always" },
    },
    {
      role: "rhythmicOstinato",
      instrumentIds: ["string_ensemble", "acoustic_guitar"],
    },
    { role: "percussion", instrumentIds: ["orchestral_percussion", "timpani"] },
    { role: "pad", instrumentIds: ["choir_pad", "synth_pad"] },
    {
      role: "accent",
      instrumentIds: ["trumpet", "orchestra_hit_fx"],
      doubling: {
        instrumentIds: ["french_horn", "trombone"],
        condition: "always",
      },
    },
    { role: "effect", instrumentIds: ["orchestra_hit_fx"] },
    { role: "unknown", instrumentIds: ["string_ensemble"] },
  ],
  dramaturgyIntensityByStage: {
    intro: 0.4,
    buildup: 0.6,
    release: 0.5,
    buildup2: 0.8,
    climax: 1.0,
    outro: 0.9,
  },
  maxDensity: 8,
  percussionStrategy: "driving",
  registerRules: { avoidLowClusters: true, maxVoicesPerRole: 5 },
  articulationBias: {
    melody: "marcato",
    bass: "marcato",
    percussion: "marcato",
  },
  humanization: { timingMs: 9, velocityRange: 9, durationPercent: 5 },
  finaleBehavior: "full-tutti",
};

export const MUSE_RECIPE_CATALOG: MuseOrchestrationRecipe[] = [
  faithfulRestoration,
  cinematicAdventure,
  intimateEnsemble,
  darkJourney,
  grandFinale,
];

const RECIPE_MAP = new Map(MUSE_RECIPE_CATALOG.map((r) => [r.id, r]));

/**
 * Resolves a recipe, merging in fields from `extends` (a base recipe) where
 * the derived recipe doesn't explicitly override them. This is what keeps
 * recipes "kombinierbar oder ableitbar" rather than fully independent copies.
 */
export function resolveRecipe(id: string): MuseOrchestrationRecipe {
  const recipe = RECIPE_MAP.get(id);
  if (!recipe) throw new Error(`Unbekanntes Orchestrierungsrezept: ${id}`);
  if (!recipe.extends) return recipe;

  const base = resolveRecipe(recipe.extends);
  return {
    ...base,
    ...recipe,
    dramaturgyIntensityByStage: {
      ...base.dramaturgyIntensityByStage,
      ...recipe.dramaturgyIntensityByStage,
    },
    articulationBias: { ...base.articulationBias, ...recipe.articulationBias },
    registerRules: { ...base.registerRules, ...recipe.registerRules },
    humanization: { ...base.humanization, ...recipe.humanization },
  };
}

export function getRecipeById(id: string): MuseOrchestrationRecipe | undefined {
  try {
    return resolveRecipe(id);
  } catch {
    return undefined;
  }
}
