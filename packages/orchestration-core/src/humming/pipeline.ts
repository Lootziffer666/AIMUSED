import type {
  MuseHummingCorrection,
  MuseHummingImportResult,
  MuseMicrophoneRecording,
  MuseOnsetEvent,
  MusePitchDetectionFrame,
  MuseQuantizationSettings,
} from "./types";

/**
 * Ported 1:1 (behavior unchanged) from MUSE's `src/lib/humming/pipeline.ts`.
 * Pure functions over `Float32Array` PCM data — no DOM/browser dependency,
 * so it's exercised here with exactly the same synthetic-sine-wave tests
 * MUSE used (`__tests__/pipeline.test.ts`).
 */

export function detectPitchFrames(
  recording: MuseMicrophoneRecording,
  frameSize = 2048,
  hopSize = 512,
): MusePitchDetectionFrame[] {
  const frames: MusePitchDetectionFrame[] = [];
  for (
    let offset = 0;
    offset + frameSize <= recording.channelData.length;
    offset += hopSize
  ) {
    const frame = recording.channelData.subarray(offset, offset + frameSize);
    let energy = 0;
    for (const value of frame) energy += value * value;
    if (Math.sqrt(energy / frame.length) < 0.015) {
      frames.push({
        timeSeconds: offset / recording.sampleRate,
        detectedPitch: null,
        confidence: 0,
      });
      continue;
    }
    let bestLag = 0;
    let bestCorrelation = -1;
    const correlations: number[] = [];
    const minLag = Math.floor(recording.sampleRate / 1000);
    const maxLag = Math.min(
      Math.floor(recording.sampleRate / 55),
      frame.length / 2,
    );
    for (let lag = minLag; lag <= maxLag; lag++) {
      let correlation = 0;
      let norm = 0;
      for (let i = 0; i < frame.length - lag; i++) {
        correlation += frame[i] * frame[i + lag];
        norm += frame[i] * frame[i];
      }
      const normalized = norm ? correlation / norm : 0;
      correlations[lag] = normalized;
      if (normalized > bestCorrelation) {
        bestCorrelation = normalized;
        bestLag = lag;
      }
    }
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if (
        correlations[lag] > 0.72 &&
        correlations[lag] >= correlations[lag - 1] &&
        correlations[lag] >= correlations[lag + 1]
      ) {
        bestLag = lag;
        bestCorrelation = correlations[lag];
        break;
      }
    }
    const frequency = recording.sampleRate / bestLag;
    frames.push({
      timeSeconds: offset / recording.sampleRate,
      detectedPitch: 69 + 12 * Math.log2(frequency / 440),
      confidence: Math.max(0, Math.min(1, bestCorrelation)),
    });
  }
  return stabilizePitchFrames(frames);
}

/** Median smoothing plus nearest-octave continuity correction for short autocorrelation errors. */
export function stabilizePitchFrames(
  frames: MusePitchDetectionFrame[],
): MusePitchDetectionFrame[] {
  return frames.map((frame, index) => {
    if (frame.detectedPitch === null) return frame;
    const neighbors = frames
      .slice(Math.max(0, index - 2), index + 3)
      .map((item) => item.detectedPitch)
      .filter((pitch): pitch is number => pitch !== null)
      .sort((a, b) => a - b);
    const median = neighbors[Math.floor(neighbors.length / 2)] ?? frame.detectedPitch;
    const candidates = [
      frame.detectedPitch - 12,
      frame.detectedPitch,
      frame.detectedPitch + 12,
    ];
    const corrected = candidates.reduce((best, pitch) =>
      Math.abs(pitch - median) < Math.abs(best - median) ? pitch : best,
    );
    return {
      ...frame,
      detectedPitch: Math.abs(corrected - median) > 2.5 ? median : corrected,
      confidence:
        Math.abs(corrected - frame.detectedPitch) >= 11
          ? frame.confidence * 0.8
          : frame.confidence,
    };
  });
}

export function detectOnsets(
  recording: MuseMicrophoneRecording,
  windowSize = 512,
): MuseOnsetEvent[] {
  const onsets: MuseOnsetEvent[] = [];
  let previous = 0;
  for (
    let offset = 0;
    offset + windowSize <= recording.channelData.length;
    offset += windowSize
  ) {
    let energy = 0;
    for (let i = offset; i < offset + windowSize; i++)
      energy += recording.channelData[i] ** 2;
    energy = Math.sqrt(energy / windowSize);
    const rise = energy - previous;
    if (energy > 0.025 && rise > 0.015)
      onsets.push({
        timeSeconds: offset / recording.sampleRate,
        strength: Math.min(1, rise * 8),
      });
    previous = energy;
  }
  return onsets;
}

export function importHumming(
  recording: MuseMicrophoneRecording,
  settings: MuseQuantizationSettings,
  bpm = 120,
): MuseHummingImportResult {
  const allFrames = detectPitchFrames(recording);
  const onsets = detectOnsets(recording);
  const frames = allFrames.filter(
    (frame) => frame.detectedPitch !== null && frame.confidence >= 0.55,
  );
  const gridSeconds = (60 / bpm) * (4 / settings.gridSubdivision);
  const snap = (time: number) =>
    time + (Math.round(time / gridSeconds) * gridSeconds - time) * settings.strength;
  const notes: MuseHummingImportResult["detectedNotes"] = [];
  for (const frame of frames) {
    const pitch = Math.round(frame.detectedPitch!);
    const last = notes.at(-1);
    const onset = onsets.find(
      (item) =>
        Math.abs(item.timeSeconds - frame.timeSeconds) <=
        512 / recording.sampleRate,
    );
    const phraseBreak = !allFrames.some(
      (item) =>
        item.timeSeconds > (last?.startSeconds ?? 0) &&
        item.timeSeconds < frame.timeSeconds &&
        item.detectedPitch !== null,
    );
    if (
      last &&
      !onset &&
      !phraseBreak &&
      last.pitch === pitch &&
      frame.timeSeconds - (last.startSeconds + last.durationSeconds) < 0.08
    ) {
      last.durationSeconds = Math.max(
        gridSeconds / 4,
        snap(frame.timeSeconds + 512 / recording.sampleRate) - last.startSeconds,
      );
      last.confidence = Math.max(last.confidence, frame.confidence);
      last.evidence.frameCount++;
    } else {
      notes.push({
        pitch,
        startSeconds: snap(frame.timeSeconds),
        durationSeconds: gridSeconds / 2,
        confidence: frame.confidence,
        evidence: {
          frameCount: 1,
          onsetStrength: onset?.strength ?? 0,
          medianPitch: frame.detectedPitch!,
        },
      });
    }
  }
  return {
    recordingId: recording.id,
    detectedNotes: notes,
    onsets,
    reviewStatus: "draft",
    quantization: settings,
  };
}

export function correctHummingDraft(
  result: MuseHummingImportResult,
  corrections: MuseHummingCorrection[],
): MuseHummingImportResult {
  const byIndex = new Map(corrections.map((correction) => [correction.noteIndex, correction]));
  return {
    ...result,
    detectedNotes: result.detectedNotes.flatMap((note, index) => {
      const correction = byIndex.get(index);
      if (correction?.discard) return [];
      return [
        {
          ...note,
          ...(correction?.pitch === undefined ? {} : { pitch: correction.pitch }),
          ...(correction?.startSeconds === undefined
            ? {}
            : { startSeconds: correction.startSeconds }),
          ...(correction?.durationSeconds === undefined
            ? {}
            : { durationSeconds: correction.durationSeconds }),
        },
      ];
    }),
  };
}

export function approveHummingDraft(
  result: MuseHummingImportResult,
): MuseHummingImportResult {
  return { ...result, reviewStatus: "approved" };
}
