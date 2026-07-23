import type { MuseMusicalRole } from "../analysis/types";
import type { MuseArticulation, MuseInstrumentDefinition } from "./types";

export interface ArticulationInputStats {
  shortNoteRatio: number;
  longNoteRatio: number;
  averageVelocity: number;
}

/**
 * Picks the assignment's default articulation: a recipe bias wins outright,
 * otherwise simple, explainable rules derive it from the track's own note
 * statistics (short notes -> staccato, long sustained pads -> sustain, etc.),
 * falling back to whatever the instrument actually supports.
 */
export function deriveDefaultArticulation(
  role: MuseMusicalRole,
  stats: ArticulationInputStats,
  instrument: MuseInstrumentDefinition,
  recipeBias?: MuseArticulation,
): MuseArticulation {
  const candidate = recipeBias ?? heuristicArticulation(role, stats);
  if (instrument.capabilities.includes(candidate)) return candidate;
  if (instrument.capabilities.includes("sustain")) return "sustain";
  return instrument.capabilities[0];
}

function heuristicArticulation(
  role: MuseMusicalRole,
  stats: ArticulationInputStats,
): MuseArticulation {
  if (stats.shortNoteRatio > 0.6) return "staccato";
  if (
    stats.longNoteRatio > 0.6 &&
    (role === "pad" || role === "chordPad" || role === "harmony")
  )
    return "sustain";
  if (stats.longNoteRatio > 0.5) return "swell";
  if (stats.averageVelocity > 100) return "marcato";
  if (role === "bass" || role === "rhythmicOstinato" || role === "percussion")
    return "accent";
  return "legato";
}

/** Per-note duration scaling used only at performance/render time — never stored in the plan. */
export function articulationDurationScale(
  articulation: MuseArticulation,
): number {
  switch (articulation) {
    case "staccato":
      return 0.5;
    case "pizzicato":
      return 0.35;
    case "marcato":
      return 0.85;
    case "accent":
      return 0.9;
    case "legato":
      return 1.02;
    case "tremolo":
      return 0.95;
    default:
      // "swell" and "sustain" also fall through here, unscaled.
      return 1.0;
  }
}

export function articulationVelocityScale(
  articulation: MuseArticulation,
): number {
  switch (articulation) {
    case "marcato":
      return 1.15;
    case "accent":
      return 1.1;
    case "pizzicato":
      return 0.9;
    default:
      return 1.0;
  }
}
