import { expect, test } from "vitest";
import {
  approveHummingDraft,
  correctHummingDraft,
  detectOnsets,
  detectPitchFrames,
  importHumming,
  stabilizePitchFrames,
} from "../pipeline";

function sine(frequency: number, seconds = 1, sampleRate = 8000) {
  const data = new Float32Array(seconds * sampleRate);
  for (let i = sampleRate / 10; i < data.length; i++)
    data[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.6;
  return { id: "hum", sampleRate, channelData: data, recordedAt: "2026-01-01" };
}

test("detects pitch and onset from a hummed sine", () => {
  const recording = sine(440);
  const voiced = detectPitchFrames(recording, 1024, 256).filter(
    (frame) => frame.detectedPitch !== null,
  );
  expect(voiced.length).toBeGreaterThan(5);
  expect(voiced.at(-1)!.detectedPitch).toBeCloseTo(69, 0);
  expect(detectOnsets(recording).length).toBeGreaterThan(0);
});

test("quantizes detected humming into editable notes", () => {
  const result = importHumming(sine(261.63), { strength: 1, gridSubdivision: 16 }, 120);
  expect(result.detectedNotes.length).toBeGreaterThan(0);
  expect(result.detectedNotes[0].pitch).toBe(60);
  expect(result.detectedNotes[0].startSeconds % 0.125).toBeCloseTo(0, 5);
  expect(result.reviewStatus).toBe("draft");
  expect(result.onsets.length).toBeGreaterThan(0);
  expect(result.detectedNotes[0].evidence.frameCount).toBeGreaterThan(0);
  const corrected = correctHummingDraft(result, [{ noteIndex: 0, pitch: 62 }]);
  expect(corrected.detectedNotes[0].pitch).toBe(62);
  expect(approveHummingDraft(corrected).reviewStatus).toBe("approved");
});

test("smooths a one-frame octave error while preserving silence", () => {
  const frames = stabilizePitchFrames([
    { timeSeconds: 0, detectedPitch: 60, confidence: 0.9 },
    { timeSeconds: 0.1, detectedPitch: 72, confidence: 0.9 },
    { timeSeconds: 0.2, detectedPitch: 60.1, confidence: 0.9 },
    { timeSeconds: 0.3, detectedPitch: null, confidence: 0 },
  ]);
  expect(frames[1].detectedPitch).toBeCloseTo(60, 0);
  expect(frames[3].detectedPitch).toBeNull();
});
