import type {
  MuseControlChangeEvent,
  MuseMidiPartDerivation,
  MuseMidiTrack,
  MusePitchBendEvent,
} from "./types";

const PERCUSSION_CHANNEL = 9;

function valueAt<T extends { tick: number }>(
  events: T[],
  tick: number,
): T | undefined {
  return events.filter((event) => event.tick <= tick).at(-1);
}

function controllerStateAt(
  events: MuseControlChangeEvent[],
  tick: number,
): MuseControlChangeEvent[] {
  const state = new Map<number, MuseControlChangeEvent>();
  for (const event of events)
    if (event.tick <= tick) state.set(event.controller, event);
  return [...state.values()]
    .sort((a, b) => a.controller - b.controller)
    .map((event) => ({ ...event, tick }));
}

/**
 * Splits an imported channel track into instrument-homogeneous logical parts.
 * Notes are assigned by the program active at note-on. Controller and bend
 * state is carried to each part boundary so every returned part can play alone.
 */
export function normalizeProgramChanges(track: MuseMidiTrack): MuseMidiTrack[] {
  const sortedPrograms = [...track.programChanges].sort(
    (a, b) => a.tick - b.tick || a.program - b.program,
  );
  if (track.channel === PERCUSSION_CHANNEL || sortedPrograms.length === 0)
    return [track];

  const boundaries = sortedPrograms.filter(
    (event, index) =>
      index === 0 || event.program !== sortedPrograms[index - 1].program,
  );
  const segmentAt = (tick: number) =>
    Math.max(
      0,
      boundaries.findLastIndex((event) => event.tick <= tick),
    );
  const occupiedSegments = [
    ...new Set(track.notes.map((note) => segmentAt(note.startTick))),
  ];
  if (occupiedSegments.length <= 1) return [track];

  return occupiedSegments.map((segmentIndex, partIndex) => {
    const program = boundaries[segmentIndex]?.program ?? 0;
    const notes = track.notes.filter(
      (note) => segmentAt(note.startTick) === segmentIndex,
    );
    const startTick = Math.min(...notes.map((note) => note.startTick));
    const endTick = Math.max(
      ...notes.map((note) => note.startTick + note.durationTicks),
    );
    const carriedControllers = controllerStateAt(
      track.controlChanges,
      startTick,
    );
    const controlChanges = [
      ...carriedControllers,
      ...track.controlChanges.filter(
        (event) => event.tick > startTick && event.tick <= endTick,
      ),
    ].sort((a, b) => a.tick - b.tick || a.controller - b.controller);
    const carriedBend = valueAt(track.pitchBends, startTick);
    const pitchBends: MusePitchBendEvent[] = [
      ...(carriedBend ? [{ ...carriedBend, tick: startTick }] : []),
      ...track.pitchBends.filter(
        (event) => event.tick > startTick && event.tick <= endTick,
      ),
    ].sort((a, b) => a.tick - b.tick);
    const derivation: MuseMidiPartDerivation = {
      sourceTrackId: track.derivation?.sourceTrackId ?? track.id,
      sourceTrackIndex: track.derivation?.sourceTrackIndex ?? track.index,
      channel: track.channel,
      program,
      startTick,
      endTick,
      reason: "program-change",
    };
    const id = `${track.id}:program-${program}:part-${partIndex}`;
    return {
      ...track,
      id,
      name: track.name
        ? `${track.name} · P${program + 1}`
        : `Programm ${program + 1}`,
      notes: notes.map((note) => ({ ...note, sourceTrackId: id })),
      controlChanges,
      pitchBends,
      sustainEvents: controlChanges
        .filter((event) => event.controller === 64)
        .map((event) => ({ tick: event.tick, on: event.value >= 64 })),
      programChanges: [{ tick: startTick, program }],
      derivation,
    };
  });
}

export function normalizeTracksByProgram(
  tracks: MuseMidiTrack[],
): MuseMidiTrack[] {
  return tracks
    .flatMap(normalizeProgramChanges)
    .sort(
      (a, b) =>
        a.index - b.index ||
        a.channel - b.channel ||
        (a.derivation?.startTick ?? 0) - (b.derivation?.startTick ?? 0) ||
        a.id.localeCompare(b.id),
    );
}
