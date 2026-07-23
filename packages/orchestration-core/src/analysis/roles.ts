import type { MuseMidiTrack } from "../midi-types";
import type { MuseRoleDetection } from "./types";
import type { MuseTrackRawStats } from "./track-stats";

const PERCUSSION_CHANNEL = 9;
const UNKNOWN_THRESHOLD = 0.2;

/**
 * Rule-based, evidence-carrying role detection. Every point added to a score
 * is paired with a human-readable reason, so the UI can always explain why a
 * role was suggested (per MUSE's "sichtbare Entscheidungen" principle).
 */
export function detectTrackRoles(
  allTracks: MuseMidiTrack[],
  allStats: MuseTrackRawStats[],
): Map<string, MuseRoleDetection[]> {
  const result = new Map<string, MuseRoleDetection[]>();

  const pitched = allTracks
    .map((t, i) => ({ track: t, stats: allStats[i] }))
    .filter(
      ({ track, stats }) =>
        track.channel !== PERCUSSION_CHANNEL && stats.noteCount > 0,
    );

  const sortedByPitchDesc = [...pitched].sort(
    (a, b) => b.stats.meanPitch - a.stats.meanPitch,
  );
  const pitchRank = new Map(
    sortedByPitchDesc.map(({ track }, i) => [track.id, i]),
  );

  const maxDensity = Math.max(
    0.001,
    ...pitched.map(({ stats }) => stats.noteDensity),
  );
  const maxRepetition = Math.max(
    0.001,
    ...pitched.map(({ stats }) => stats.repetitionScore),
  );

  allTracks.forEach((track, i) => {
    const stats = allStats[i];

    if (stats.noteCount === 0) {
      result.set(track.id, [
        {
          role: "unknown",
          confidence: 0,
          evidence: ["Spur enthält keine Noten"],
        },
      ]);
      return;
    }

    if (track.channel === PERCUSSION_CHANNEL) {
      result.set(track.id, [
        {
          role: "percussion",
          confidence: 0.95,
          evidence: ["Kanal 10 (General-MIDI-Percussion)"],
        },
      ]);
      return;
    }

    const rank = pitchRank.get(track.id) ?? pitched.length;
    const isHighestPitch = rank === 0;
    const isSecondHighestPitch = rank === 1;
    const isLowestPitch = rank === pitched.length - 1;

    const candidates: MuseRoleDetection[] = [
      scoreMelody(stats, isHighestPitch),
      scoreCounterMelody(stats, isSecondHighestPitch),
      scoreBass(stats, isLowestPitch),
      scoreHarmonyOrChordPad(stats),
      scoreRhythmicOstinato(stats, maxDensity, maxRepetition),
      scorePad(stats),
      scoreAccent(stats),
      scoreEffect(stats),
    ].filter((c) => c.confidence > 0);

    candidates.sort((a, b) => b.confidence - a.confidence);

    if (
      candidates.length === 0 ||
      candidates[0].confidence < UNKNOWN_THRESHOLD
    ) {
      candidates.unshift({
        role: "unknown",
        confidence: 0.3,
        evidence: ["keine Merkmalskombination eindeutig genug"],
      });
    }

    result.set(track.id, candidates);
  });

  return result;
}

function scoreMelody(
  s: MuseTrackRawStats,
  isHighestPitch: boolean,
): MuseRoleDetection {
  let score = 0;
  const evidence: string[] = [];
  if (s.isMonophonic) {
    score += 0.3;
    evidence.push("überwiegend monophon");
  }
  if (isHighestPitch) {
    score += 0.3;
    evidence.push("höchste mittlere Lage im Vergleich zu den anderen Spuren");
  }
  if (s.onBeatRatio > 0.5) {
    score += 0.15;
    evidence.push("Noten beginnen überwiegend auf starken Zählzeiten");
  }
  if (s.repetitionScore > 0.15) {
    score += 0.15;
    evidence.push("wiederkehrendes Motiv erkennbar");
  }
  if (s.rhythmicActivity > 0.2 && s.rhythmicActivity < 0.85) {
    score += 0.1;
    evidence.push("moderate, gesangsähnliche rhythmische Aktivität");
  }
  return { role: "melody", confidence: Math.min(1, score), evidence };
}

function scoreCounterMelody(
  s: MuseTrackRawStats,
  isSecondHighestPitch: boolean,
): MuseRoleDetection {
  let score = 0;
  const evidence: string[] = [];
  if (s.isMonophonic) {
    score += 0.25;
    evidence.push("überwiegend monophon");
  }
  if (isSecondHighestPitch) {
    score += 0.35;
    evidence.push("zweithöchste mittlere Lage");
  }
  if (s.noteDensity < 4) {
    score += 0.15;
    evidence.push("zurückhaltende Notendichte");
  }
  if (s.repetitionScore > 0.1) {
    score += 0.1;
    evidence.push("wiederkehrendes Muster");
  }
  return { role: "counterMelody", confidence: Math.min(1, score), evidence };
}

function scoreBass(
  s: MuseTrackRawStats,
  isLowestPitch: boolean,
): MuseRoleDetection {
  let score = 0;
  const evidence: string[] = [];
  if (isLowestPitch) {
    score += 0.4;
    evidence.push(
      "niedrigste mittlere Lage im Vergleich zu den anderen Spuren",
    );
  }
  if (s.pitchRange.high < 55) {
    score += 0.15;
    evidence.push("tiefes Register");
  }
  if (s.isMonophonic || s.overlapFraction < 0.15) {
    score += 0.15;
    evidence.push("niedrige Lage mit geringer Polyphonie");
  }
  if (s.onBeatRatio > 0.6) {
    score += 0.15;
    evidence.push("Noten beginnen überwiegend auf starken Zählzeiten");
  }
  if (s.longNoteRatio > 0.3) {
    score += 0.15;
    evidence.push("überwiegend lange Notenwerte");
  }
  return { role: "bass", confidence: Math.min(1, score), evidence };
}

function scoreHarmonyOrChordPad(s: MuseTrackRawStats): MuseRoleDetection {
  let score = 0;
  const evidence: string[] = [];
  if (s.polyphony >= 2) {
    score += 0.35;
    evidence.push(`gleichzeitig klingende Stimmen (max. ${s.polyphony})`);
  }
  if (s.longNoteRatio > 0.5) {
    score += 0.2;
    evidence.push("überwiegend lange, gehaltene Noten");
  }
  if (s.rhythmicActivity < 0.35) {
    score += 0.15;
    evidence.push("geringe rhythmische Aktivität");
  }
  if (score === 0) return { role: "harmony", confidence: 0, evidence: [] };
  const isChordPad = s.longNoteRatio > 0.7 && s.rhythmicActivity < 0.2;
  return {
    role: isChordPad ? "chordPad" : "harmony",
    confidence: Math.min(1, score),
    evidence,
  };
}

function scoreRhythmicOstinato(
  s: MuseTrackRawStats,
  maxDensity: number,
  maxRepetition: number,
): MuseRoleDetection {
  let score = 0;
  const evidence: string[] = [];
  if (s.noteDensity / maxDensity > 0.6) {
    score += 0.3;
    evidence.push("hohe Notendichte relativ zu den anderen Spuren");
  }
  if (s.repetitionScore / maxRepetition > 0.6) {
    score += 0.3;
    evidence.push("stark wiederkehrendes rhythmisches Muster");
  }
  if (s.pitchRange.high - s.pitchRange.low <= 4) {
    score += 0.2;
    evidence.push("enger Tonhöhenbereich");
  }
  if (s.shortNoteRatio > 0.5) {
    score += 0.2;
    evidence.push("überwiegend kurze Notenwerte");
  }
  return { role: "rhythmicOstinato", confidence: Math.min(1, score), evidence };
}

function scorePad(s: MuseTrackRawStats): MuseRoleDetection {
  let score = 0;
  const evidence: string[] = [];
  if (s.longNoteRatio > 0.8) {
    score += 0.35;
    evidence.push("fast ausschließlich lange, flächige Noten");
  }
  if (s.rhythmicActivity < 0.15) {
    score += 0.25;
    evidence.push("sehr geringe rhythmische Aktivität");
  }
  if (s.averageVelocity < 70) {
    score += 0.15;
    evidence.push("niedrige mittlere Velocity");
  }
  return { role: "pad", confidence: Math.min(1, score), evidence };
}

function scoreAccent(s: MuseTrackRawStats): MuseRoleDetection {
  let score = 0;
  const evidence: string[] = [];
  if (s.noteDensity < 0.5) {
    score += 0.4;
    evidence.push("sehr geringe Notendichte");
  }
  if (s.averageVelocity > 100) {
    score += 0.2;
    evidence.push("hohe mittlere Velocity");
  }
  return { role: "accent", confidence: Math.min(1, score), evidence };
}

function scoreEffect(s: MuseTrackRawStats): MuseRoleDetection {
  let score = 0;
  const evidence: string[] = [];
  if (s.noteCount <= 4) {
    score += 0.5;
    evidence.push("sehr wenige Einzelereignisse");
  }
  if (s.pitchRange.high - s.pitchRange.low > 24) {
    score += 0.2;
    evidence.push("ungewöhnlich weiter Tonhöhenbereich");
  }
  return { role: "effect", confidence: Math.min(1, score), evidence };
}
