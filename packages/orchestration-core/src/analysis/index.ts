import type { MuseMidiProject } from "../project-types";
import { computeTrackStats } from "./track-stats";
import { detectTrackRoles } from "./roles";
import { detectMotifs } from "./motifs";
import { detectSections } from "./sections";
import { computeGlobalAnalysis, computePhraseBoundaries } from "./global";
import type { MuseAnalysisResult, MuseTrackAnalysis } from "./types";

export const MUSE_ANALYSIS_SCHEMA_VERSION = 1;

export function analyzeProject(project: MuseMidiProject): MuseAnalysisResult {
  const ppq = project.timeline.ticksPerQuarterNote;
  const rawStats = project.tracks.map((t) => computeTrackStats(t, ppq));
  const rolesByTrack = detectTrackRoles(project.tracks, rawStats);
  const motifs = detectMotifs(project.tracks, rolesByTrack);

  const melodyTrack = pickPrimaryMelodyTrack(project.tracks, rolesByTrack);
  const phraseBoundaryTicks = melodyTrack
    ? computePhraseBoundaries(melodyTrack, ppq)
    : [];

  const sections = detectSections(project.timeline, project.tracks);
  const global = computeGlobalAnalysis(
    project.timeline,
    project.tracks,
    sections,
    phraseBoundaryTicks,
  );

  const tracks: MuseTrackAnalysis[] = project.tracks.map((track, i) => {
    const s = rawStats[i];
    return {
      trackId: track.id,
      noteCount: s.noteCount,
      pitchRange: s.pitchRange,
      meanPitch: s.meanPitch,
      noteDensity: s.noteDensity,
      polyphony: s.polyphony,
      isMonophonic: s.isMonophonic,
      rhythmicActivity: s.rhythmicActivity,
      averageVelocity: s.averageVelocity,
      longNoteRatio: s.longNoteRatio,
      shortNoteRatio: s.shortNoteRatio,
      repetitionScore: s.repetitionScore,
      roles: rolesByTrack.get(track.id) ?? [
        { role: "unknown", confidence: 0, evidence: [] },
      ],
    };
  });

  return {
    schemaVersion: MUSE_ANALYSIS_SCHEMA_VERSION,
    analyzedAt: new Date().toISOString(),
    global,
    tracks,
    motifs,
  };
}

function pickPrimaryMelodyTrack(
  tracks: MuseMidiProject["tracks"],
  rolesByTrack: ReturnType<typeof detectTrackRoles>,
) {
  let best: {
    track: MuseMidiProject["tracks"][number];
    confidence: number;
  } | null = null;
  for (const track of tracks) {
    const melodyDetection = rolesByTrack
      .get(track.id)
      ?.find((r) => r.role === "melody");
    if (
      melodyDetection &&
      (!best || melodyDetection.confidence > best.confidence)
    ) {
      best = { track, confidence: melodyDetection.confidence };
    }
  }
  return best?.track ?? null;
}

export { detectTrackRoles } from "./roles";
export { detectMotifs } from "./motifs";
export { detectSections } from "./sections";
export { computeGlobalAnalysis } from "./global";
export { computeTrackStats } from "./track-stats";
export * from "./types";
