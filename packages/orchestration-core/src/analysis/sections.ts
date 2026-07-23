import type { MuseMidiTrack, MuseMusicalTimeline } from "../midi-types";
import { createId } from "../id";
import type { MuseSection } from "./types";

const SECTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

/**
 * Prefers the composer's own markers (high confidence). Falls back to a
 * bar-level note-density segmentation when no markers exist — this is
 * explicitly an approximation and is labeled with lower certainty.
 */
export function detectSections(
  timeline: MuseMusicalTimeline,
  tracks: MuseMidiTrack[],
): MuseSection[] {
  if (timeline.markers.length >= 1) {
    return sectionsFromMarkers(timeline);
  }
  return sectionsFromDensity(timeline, tracks);
}

function sectionsFromMarkers(timeline: MuseMusicalTimeline): MuseSection[] {
  const markers = [...timeline.markers].sort((a, b) => a.tick - b.tick);
  const sections: MuseSection[] = [];

  if (markers[0].tick > 0) {
    sections.push({
      id: createId("section"),
      startTick: 0,
      endTick: markers[0].tick,
      label: "Intro",
      certainty: "wahrscheinlich",
    });
  }

  markers.forEach((marker, i) => {
    const start = marker.tick;
    const end =
      i + 1 < markers.length ? markers[i + 1].tick : timeline.totalTicks;
    if (end <= start) return;
    sections.push({
      id: createId("section"),
      startTick: start,
      endTick: end,
      label: marker.text || `Abschnitt ${i + 1}`,
      certainty: "erkannt",
    });
  });

  return sections;
}

function sectionsFromDensity(
  timeline: MuseMusicalTimeline,
  tracks: MuseMidiTrack[],
): MuseSection[] {
  const ppq = timeline.ticksPerQuarterNote;
  const ts = timeline.timeSignatureMap[0] ?? {
    tick: 0,
    numerator: 4,
    denominator: 4,
  };
  const barTicks = Math.max(
    1,
    Math.round(ppq * ts.numerator * (4 / ts.denominator)),
  );
  const totalTicks = timeline.totalTicks || barTicks;
  const barCount = Math.max(1, Math.ceil(totalTicks / barTicks));

  if (barCount < 4) {
    return [
      {
        id: createId("section"),
        startTick: 0,
        endTick: totalTicks,
        label: "Ganzes Stück",
        certainty: "nicht erkannt",
      },
    ];
  }

  const density = new Array(barCount).fill(0);
  for (const track of tracks) {
    for (const note of track.notes) {
      const bar = Math.floor(note.startTick / barTicks);
      if (bar >= 0 && bar < barCount) density[bar]++;
    }
  }

  const maxDensity = Math.max(1, ...density);
  const levels = density.map((d) =>
    d / maxDensity < 0.33 ? 0 : d / maxDensity < 0.66 ? 1 : 2,
  );

  const rawSections: { startBar: number; endBar: number; level: number }[] = [];
  let curStart = 0;
  for (let i = 1; i <= barCount; i++) {
    if (i === barCount || levels[i] !== levels[curStart]) {
      rawSections.push({
        startBar: curStart,
        endBar: i,
        level: levels[curStart],
      });
      curStart = i;
    }
  }

  const merged: typeof rawSections = [];
  for (const s of rawSections) {
    if (merged.length > 0 && s.endBar - s.startBar < 2) {
      merged[merged.length - 1].endBar = s.endBar;
    } else {
      merged.push({ ...s });
    }
  }

  const labelForLevel = new Map<number, string>();
  let nextLetterIndex = 0;

  return merged.map((s) => {
    let label = labelForLevel.get(s.level);
    if (!label) {
      label = SECTION_LETTERS[nextLetterIndex % SECTION_LETTERS.length];
      nextLetterIndex++;
      labelForLevel.set(s.level, label);
    }
    return {
      id: createId("section"),
      startTick: s.startBar * barTicks,
      endTick: Math.min(totalTicks, s.endBar * barTicks),
      label,
      certainty: merged.length >= 2 ? "wahrscheinlich" : "unsicher",
    };
  });
}
