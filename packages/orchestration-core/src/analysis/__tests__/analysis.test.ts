import { describe, expect, test } from "vitest";
import { buildSyntheticAdventureProject } from "../../test-helpers/synthetic-adventure-project";
import { analyzeProject } from "../index";

function analyzeFixture() {
  const project = buildSyntheticAdventureProject();
  return { project, analysis: analyzeProject(project) };
}

describe("analyzeProject", () => {
  test("detects melody as the highest, monophonic, on-beat track", () => {
    const { project, analysis } = analyzeFixture();
    const melodyTrack = project.tracks.find((t) => t.name === "Melody")!;
    const trackAnalysis = analysis.tracks.find(
      (t) => t.trackId === melodyTrack.id,
    )!;

    expect(trackAnalysis.isMonophonic).toBe(true);
    expect(trackAnalysis.roles[0].role).toBe("melody");
    expect(trackAnalysis.roles[0].confidence).toBeGreaterThan(0.5);
    expect(trackAnalysis.roles[0].evidence.length).toBeGreaterThan(0);
  });

  test("detects bass as the lowest, on-beat track", () => {
    const { project, analysis } = analyzeFixture();
    const bassTrack = project.tracks.find((t) => t.name === "Bass")!;
    const trackAnalysis = analysis.tracks.find(
      (t) => t.trackId === bassTrack.id,
    )!;

    expect(trackAnalysis.roles[0].role).toBe("bass");
    expect(trackAnalysis.roles[0].confidence).toBeGreaterThan(0.5);
  });

  test("detects harmony as a polyphonic, sustained track", () => {
    const { project, analysis } = analyzeFixture();
    const harmonyTrack = project.tracks.find((t) => t.name === "Harmony")!;
    const trackAnalysis = analysis.tracks.find(
      (t) => t.trackId === harmonyTrack.id,
    )!;

    expect(trackAnalysis.polyphony).toBeGreaterThanOrEqual(3);
    expect(["harmony", "chordPad"]).toContain(trackAnalysis.roles[0].role);
  });

  test("detects percussion via the General MIDI drum channel", () => {
    const { project, analysis } = analyzeFixture();
    const percussionTrack = project.tracks.find(
      (t) => t.name === "Percussion",
    )!;
    const trackAnalysis = analysis.tracks.find(
      (t) => t.trackId === percussionTrack.id,
    )!;

    expect(trackAnalysis.roles[0].role).toBe("percussion");
    expect(trackAnalysis.roles[0].confidence).toBeGreaterThan(0.8);
  });

  test("finds the repeating 8-note motif in the melody", () => {
    const { project, analysis } = analyzeFixture();
    const melodyTrack = project.tracks.find((t) => t.name === "Melody")!;
    const melodyMotifs = analysis.motifs.filter(
      (m) => m.sourceTrackId === melodyTrack.id,
    );

    expect(melodyMotifs.length).toBeGreaterThan(0);
    expect(melodyMotifs[0].occurrences.length).toBeGreaterThanOrEqual(2);
    // The A' repeat is transposed up a perfect fourth (+5 semitones) in the fixture.
    const transpositions = new Set(
      melodyMotifs[0].occurrences.map((o) => o.transposition),
    );
    expect(transpositions.size).toBeGreaterThanOrEqual(1);
  });

  test("uses the file's own markers as sections with high certainty", () => {
    const { analysis } = analyzeFixture();
    expect(analysis.global.sections.length).toBeGreaterThanOrEqual(2);
    expect(
      analysis.global.sections.every((s) => s.certainty === "erkannt"),
    ).toBe(true);
    expect(analysis.global.sections.map((s) => s.label)).toEqual(["A", "A'"]);
  });

  test("computes plausible global tempo and key estimates", () => {
    const { analysis } = analyzeFixture();
    expect(analysis.global.tempoSummary.averageBpm).toBeCloseTo(120, 5);
    expect(analysis.global.estimatedKey.confidence).toBeGreaterThan(0);
  });

  test("is fully deterministic across repeated runs", () => {
    const projectA = buildSyntheticAdventureProject();
    const projectB = buildSyntheticAdventureProject();
    const analysisA = analyzeProject(projectA);
    const analysisB = analyzeProject(projectB);

    expect(analysisA.global.pitchHistogram).toEqual(
      analysisB.global.pitchHistogram,
    );
    expect(analysisA.global.estimatedKey).toEqual(
      analysisB.global.estimatedKey,
    );
    expect(analysisA.motifs.map((m) => m.pitchIntervals)).toEqual(
      analysisB.motifs.map((m) => m.pitchIntervals),
    );
  });
});
