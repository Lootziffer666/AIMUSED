import type { MuseMidiTrack, MuseNote } from "../midi-types";
import type { MuseMidiProject } from "../project-types";
import { ticksToSeconds } from "../tick-time";
import { hashStringToSeed } from "../seed-random";
import { resolveRecipe } from "./recipes";
import { getInstrumentById } from "./instruments";
import { limitChordVoices } from "./register-rules";
import {
  articulationDurationScale,
  articulationVelocityScale,
} from "./articulation";
import { humanizeNotes } from "./humanize";
import type {
  MuseArrangementSection,
  MuseInstrumentAssignment,
  MuseRenderGroup,
  MuseRenderNote,
  MuseRenderableProject,
} from "./types";

export interface AssembledNoteGroup {
  assignmentId: string;
  trackId: string;
  instrumentId: string;
  isDoubling: boolean;
  channel: number;
  notes: MuseNote[];
}

const FAMILY_GROUP_LABELS: Record<string, string> = {
  strings: "Strings",
  woodwinds: "Woodwinds",
  brass: "Brass",
  percussion: "Percussion",
  keys: "Keys",
  choir: "Choir",
  synth: "Additional",
  folk: "Additional",
  other: "Additional",
};

function familyGroupId(family: string): string {
  return family === "synth" || family === "folk" || family === "other"
    ? "additional"
    : family;
}

/**
 * Turns the arrangement plan into concrete note groups: octave shift, voice
 * limiting for instruments that can't play everything they're given,
 * section-based dynamics, articulation shaping, and (optionally) doubling
 * and seeded humanization. This is the single source of truth consumed by
 * both MIDI export (humanize=false, deterministic) and the audio
 * renderer/audio export (humanize=true, "performance" data).
 */
export function assembleArrangementGroups(
  project: MuseMidiProject,
  options: { humanize: boolean },
): AssembledNoteGroup[] {
  const plan = project.arrangement;
  if (!plan)
    throw new Error("Das Projekt hat noch keinen Orchestrierungsplan.");
  const recipe = resolveRecipe(plan.recipeId);

  const trackById = new Map<string, MuseMidiTrack>(
    project.tracks.map((t) => [t.id, t]),
  );
  const sectionForTick = makeSectionLookup(plan.sections);
  const intensityBySection = new Map(
    plan.dynamics.map((d) => [d.sectionId, d.intensity.value]),
  );

  const groups: AssembledNoteGroup[] = [];
  let nextMelodicChannel = 0;

  const allocateChannel = (isPercussion: boolean): number => {
    if (isPercussion) return 9;
    const channel =
      nextMelodicChannel === 9 ? ++nextMelodicChannel : nextMelodicChannel;
    nextMelodicChannel = (channel + 1) % 16;
    return channel;
  };

  for (const assignment of plan.assignments) {
    if (assignment.muted.value) continue;
    const track = trackById.get(assignment.targetTrackId);
    const instrument = getInstrumentById(assignment.instrumentId.value);
    if (!track || !instrument) continue;

    const baseNotes = buildAssignmentNotes(
      track,
      assignment,
      instrument.range,
      instrument.maxVoices,
      sectionForTick,
      intensityBySection,
      recipe.finaleBehavior,
    );
    // Keyed by the source track's stable index/channel (not the random assignment id) so
    // humanization stays reproducible even across independent re-imports of the same file.
    const seedKey = `${track.index}:${track.channel}:${assignment.role.value}`;
    const finalNotes = options.humanize
      ? humanizeAssignmentNotes(
          baseNotes,
          seedKey,
          plan.seed,
          recipe.humanization,
          project.timeline.ticksPerQuarterNote,
          project.timeline.tempoMap,
        )
      : baseNotes;

    groups.push({
      assignmentId: assignment.id,
      trackId: track.id,
      instrumentId: instrument.id,
      isDoubling: false,
      channel: allocateChannel(instrument.channelHint === "percussion"),
      notes: finalNotes,
    });

    const rolePreference = recipe.rolePreferences.find(
      (p) => p.role === assignment.role.value,
    );
    for (const doublingId of assignment.doublingInstrumentIds.value) {
      const doublingInstrument = getInstrumentById(doublingId);
      if (!doublingInstrument) continue;
      const condition = rolePreference?.doubling?.condition ?? "always";
      const eligibleNotes =
        condition === "climax"
          ? baseNotes.filter(
              (n) => sectionForTick(n.startTick)?.dramaturgyStage === "climax",
            )
          : baseNotes;
      if (eligibleNotes.length === 0) continue;

      const shifted = reRegisterForInstrument(
        eligibleNotes,
        doublingInstrument.range,
      );
      const doublingFinal = options.humanize
        ? humanizeAssignmentNotes(
            shifted,
            `${seedKey}:${doublingId}`,
            plan.seed,
            recipe.humanization,
            project.timeline.ticksPerQuarterNote,
            project.timeline.tempoMap,
          )
        : shifted;

      groups.push({
        assignmentId: assignment.id,
        trackId: track.id,
        instrumentId: doublingInstrument.id,
        isDoubling: true,
        channel: allocateChannel(
          doublingInstrument.channelHint === "percussion",
        ),
        notes: doublingFinal,
      });
    }
  }

  return groups;
}

function makeSectionLookup(sections: MuseArrangementSection[]) {
  const sorted = [...sections].sort((a, b) => a.startTick - b.startTick);
  return (tick: number): MuseArrangementSection | undefined => {
    for (const s of sorted) {
      if (tick >= s.startTick && tick < s.endTick) return s;
    }
    return sorted[sorted.length - 1];
  };
}

function buildAssignmentNotes(
  track: MuseMidiTrack,
  assignment: MuseInstrumentAssignment,
  range: { lowMidi: number; highMidi: number },
  maxVoices: number,
  sectionForTick: (tick: number) => MuseArrangementSection | undefined,
  intensityBySection: Map<string, number>,
  _finaleBehavior: string,
): MuseNote[] {
  const octaveShiftSemitones = Math.round(assignment.octaveShift.value * 12);
  const durationScale = articulationDurationScale(
    assignment.articulation.value,
  );
  const velocityScale = articulationVelocityScale(
    assignment.articulation.value,
  );

  let notes: MuseNote[] = track.notes.map((n) => {
    const section = sectionForTick(n.startTick);
    const intensity = section
      ? (intensityBySection.get(section.id) ?? 0.5)
      : 0.5;
    const dynamicMultiplier = 0.6 + intensity * 0.8;
    const pitch = clamp(
      n.pitch + octaveShiftSemitones,
      range.lowMidi,
      range.highMidi,
    );
    const velocity = clamp(
      Math.round(n.velocity * dynamicMultiplier * velocityScale),
      1,
      127,
    );
    const durationTicks = Math.max(
      1,
      Math.round(n.durationTicks * durationScale),
    );
    return { ...n, pitch, velocity, durationTicks };
  });

  if (maxVoices === 1) {
    notes = extractTopVoicePreservingOrder(notes);
  } else {
    notes = reducePolyphonyToMaxVoices(notes, maxVoices);
  }

  return notes;
}

function reRegisterForInstrument(
  notes: MuseNote[],
  range: { lowMidi: number; highMidi: number },
): MuseNote[] {
  return notes.map((n) => ({
    ...n,
    pitch: clamp(n.pitch, range.lowMidi, range.highMidi),
  }));
}

function extractTopVoicePreservingOrder(notes: MuseNote[]): MuseNote[] {
  const byStart = new Map<number, MuseNote[]>();
  for (const n of notes) {
    const g = byStart.get(n.startTick) ?? [];
    g.push(n);
    byStart.set(n.startTick, g);
  }
  const picked = [...byStart.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => group.reduce((a, b) => (b.pitch > a.pitch ? b : a)));

  for (let i = 0; i < picked.length - 1; i++) {
    const end = picked[i].startTick + picked[i].durationTicks;
    if (end > picked[i + 1].startTick) {
      picked[i] = {
        ...picked[i],
        durationTicks: Math.max(
          1,
          picked[i + 1].startTick - picked[i].startTick,
        ),
      };
    }
  }
  return picked;
}

function reducePolyphonyToMaxVoices(
  notes: MuseNote[],
  maxVoices: number,
): MuseNote[] {
  const byStart = new Map<number, MuseNote[]>();
  for (const n of notes) {
    const g = byStart.get(n.startTick) ?? [];
    g.push(n);
    byStart.set(n.startTick, g);
  }
  const result: MuseNote[] = [];
  const active: MuseNote[] = [];
  for (const [, group] of [...byStart.entries()].sort((a, b) => a[0] - b[0])) {
    const startTick = group[0].startTick;
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].startTick + active[i].durationTicks <= startTick)
        active.splice(i, 1);
    }
    const available = Math.max(0, maxVoices - active.length);
    if (available === 0) continue;
    const keptPitches = limitChordVoices(
      group.map((n) => n.pitch),
      available,
    );
    const used = new Set<string>();
    for (const pitch of keptPitches) {
      const match = group.find((n) => n.pitch === pitch && !used.has(n.id));
      if (match) {
        used.add(match.id);
        result.push(match);
        active.push(match);
      }
    }
  }
  return result.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
}

function humanizeAssignmentNotes(
  notes: MuseNote[],
  seedKey: string,
  baseSeed: number,
  humanization: {
    timingMs: number;
    velocityRange: number;
    durationPercent: number;
  },
  ticksPerQuarterNote: number,
  tempoMap: { bpm: number }[],
): MuseNote[] {
  const averageBpm =
    tempoMap.length > 0
      ? tempoMap.reduce((s, t) => s + t.bpm, 0) / tempoMap.length
      : 120;
  const ticksPerMs = (ticksPerQuarterNote * averageBpm) / 60000;
  const seed = (baseSeed + hashStringToSeed(seedKey)) >>> 0;
  return humanizeNotes(notes, humanization, seed, ticksPerMs);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Builds the flattened, humanized project the audio renderer plays and offline-renders. */
export function buildRenderableProject(
  project: MuseMidiProject,
): MuseRenderableProject {
  const plan = project.arrangement;
  if (!plan)
    throw new Error("Das Projekt hat noch keinen Orchestrierungsplan.");

  const groups = assembleArrangementGroups(project, { humanize: true });
  const assignmentById = new Map(plan.assignments.map((a) => [a.id, a]));
  const usedGroupIds = new Set<string>();
  const renderGroups: MuseRenderGroup[] = [];

  const notes: MuseRenderNote[] = [];
  let maxEndSeconds = 0;

  for (const group of groups) {
    const instrument = getInstrumentById(group.instrumentId)!;
    const assignment = assignmentById.get(group.assignmentId)!;
    const groupId = familyGroupId(instrument.family);
    if (!usedGroupIds.has(groupId)) {
      usedGroupIds.add(groupId);
      renderGroups.push({
        id: groupId,
        name: FAMILY_GROUP_LABELS[instrument.family] ?? instrument.family,
        family: instrument.family,
      });
    }

    for (const n of group.notes) {
      const startSeconds = ticksToSeconds(
        n.startTick,
        project.timeline.ticksPerQuarterNote,
        project.timeline.tempoMap,
      );
      const endSeconds = ticksToSeconds(
        n.startTick + n.durationTicks,
        project.timeline.ticksPerQuarterNote,
        project.timeline.tempoMap,
      );
      maxEndSeconds = Math.max(maxEndSeconds, endSeconds);
      notes.push({
        id: n.id,
        pitch: n.pitch,
        velocity: n.velocity,
        startTick: n.startTick,
        durationTicks: n.durationTicks,
        startSeconds,
        durationSeconds: Math.max(0.01, endSeconds - startSeconds),
        channel: group.channel,
        instrumentId: instrument.id,
        articulation: assignment.articulation.value,
        groupId,
      });
    }
  }

  return {
    id: plan.id,
    ticksPerQuarterNote: project.timeline.ticksPerQuarterNote,
    totalSeconds: Math.max(project.timeline.totalSeconds, maxEndSeconds) + 1.5,
    notes,
    groups: renderGroups,
  };
}

/**
 * Structural duplicate of `@signal-app/midi-project`'s `midi/export.ts`
 * `MuseExportNote`/`MuseExportTrackInput` — see `../midi-types.ts` for why:
 * `buildMidiFromTracks` (the function that actually serializes these to
 * bytes) lives in `@signal-app/midi-project`, which already depends on this
 * package, so a real dependency back onto it here would be cyclic. This
 * package only ever *produces* values of this shape (in
 * `buildArrangedExportTracks` below); the app layer passes them straight
 * into `@signal-app/midi-project`'s `buildMidiFromTracks`, which accepts the
 * real `MuseExportTrackInput` — structurally identical, so no adapter is
 * needed at the call site.
 */
export interface MuseExportNote {
  pitch: number;
  velocity: number;
  startTick: number;
  durationTicks: number;
}

export interface MuseExportTrackInput {
  name: string;
  channel: number;
  programNumber: number;
  notes: MuseExportNote[];
}

/** Builds the arranged MIDI file's per-instrument tracks — deterministic, no humanization jitter. */
export function buildArrangedExportTracks(
  project: MuseMidiProject,
): MuseExportTrackInput[] {
  const groups = assembleArrangementGroups(project, { humanize: false });
  const plan = project.arrangement!;
  const assignmentByTrackId = new Map(
    plan.assignments.map((a) => [a.targetTrackId, a]),
  );
  const trackById = new Map(project.tracks.map((t) => [t.id, t]));

  return groups.map((group) => {
    const instrument = getInstrumentById(group.instrumentId)!;
    const assignment = assignmentByTrackId.get(group.trackId);
    const sourceTrack = trackById.get(group.trackId);
    const baseName = sourceTrack?.name ?? group.trackId;
    const roleLabel = assignment?.role.value ?? "unknown";
    const name = group.isDoubling
      ? `${instrument.name} (Verdopplung: ${baseName})`
      : `${instrument.name} (${roleLabel}: ${baseName})`;

    return {
      name,
      channel: group.channel,
      programNumber: instrument.generalMidiProgram,
      notes: group.notes.map((n) => ({
        pitch: n.pitch,
        velocity: n.velocity,
        startTick: n.startTick,
        durationTicks: n.durationTicks,
      })),
    };
  });
}
