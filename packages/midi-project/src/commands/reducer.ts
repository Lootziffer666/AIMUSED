import {
  base64ToBytes,
  createId,
  hashStringToSeed,
} from "@signal-app/orchestration-core/shared";
import {
  analyzeProject,
  buildArrangementPlan,
  getInstrumentById,
  getRecipeById,
  type MuseInstrumentAssignment,
} from "@signal-app/orchestration-core";
import { createProjectFromMidiBytes } from "../project/create";
import type { MuseMidiProject } from "../project/types";
import type { MuseCommand } from "./types";

export class MuseCommandError extends Error {}

function findAssignment(
  project: MuseMidiProject,
  targetId: string,
): MuseInstrumentAssignment {
  const assignment = project.arrangement?.assignments.find(
    (a) => a.id === targetId,
  );
  if (!assignment)
    throw new MuseCommandError(
      `Keine Instrumentenzuweisung mit ID "${targetId}" gefunden.`,
    );
  return assignment;
}

function requireArrangement(
  project: MuseMidiProject,
): NonNullable<MuseMidiProject["arrangement"]> {
  if (!project.arrangement)
    throw new MuseCommandError(
      "Es wurde noch kein Orchestrierungsplan erstellt. Bitte zuerst ein Rezept anwenden.",
    );
  return project.arrangement;
}

function touch(project: MuseMidiProject): MuseMidiProject {
  return { ...project, updatedAt: new Date().toISOString() };
}

/**
 * Pure command reducer: throws `MuseCommandError` on anything invalid, so a
 * bad command never mutates or corrupts the project. `project` may be null
 * only for IMPORT_MIDI (there is nothing to import into yet).
 */
export function applyCommand(
  project: MuseMidiProject | null,
  command: MuseCommand,
): MuseMidiProject {
  if (command.type === "IMPORT_MIDI") {
    const source = command.source;
    if (source.kind !== "file") {
      throw new MuseCommandError(
        "Nur Datei-Importe werden derzeit unterstützt.",
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(source.bytesBase64);
    } catch {
      throw new MuseCommandError(
        "Die MIDI-Datei konnte nicht gelesen werden (ungültige Kodierung).",
      );
    }
    const newProject = createProjectFromMidiBytes(source.fileName, bytes);
    newProject.analysis = analyzeProject(newProject);
    return newProject;
  }

  if (!project) {
    throw new MuseCommandError(
      "Es ist noch kein Projekt geöffnet — bitte zuerst eine MIDI-Datei importieren.",
    );
  }

  switch (command.type) {
    case "SET_TRACK_ROLE": {
      const arrangement = requireArrangement(project);
      const assignment = arrangement.assignments.find(
        (a) => a.targetTrackId === command.trackId,
      );
      if (!assignment)
        throw new MuseCommandError(
          `Keine Spur mit ID "${command.trackId}" im Orchestrierungsplan gefunden.`,
        );
      const updated: MuseInstrumentAssignment = {
        ...assignment,
        role: {
          value: command.role,
          origin: "user",
          locked: true,
          reason: "Rolle manuell durch Nutzer gesetzt",
        },
      };
      return touch({
        ...project,
        arrangement: {
          ...arrangement,
          assignments: arrangement.assignments.map((a) =>
            a.id === updated.id ? updated : a,
          ),
        },
      });
    }

    case "ASSIGN_INSTRUMENT": {
      const arrangement = requireArrangement(project);
      const assignment = findAssignment(project, command.targetId);
      const instrument = getInstrumentById(command.instrumentId);
      if (!instrument)
        throw new MuseCommandError(
          `Unbekanntes Instrument "${command.instrumentId}".`,
        );
      const updated: MuseInstrumentAssignment = {
        ...assignment,
        instrumentId: {
          value: command.instrumentId,
          origin: "user",
          locked: true,
          reason: `Instrument manuell auf ${instrument.name} gesetzt`,
        },
      };
      return touch({
        ...project,
        arrangement: {
          ...arrangement,
          assignments: arrangement.assignments.map((a) =>
            a.id === updated.id ? updated : a,
          ),
        },
      });
    }

    case "TOGGLE_DOUBLING": {
      const arrangement = requireArrangement(project);
      const assignment = findAssignment(project, command.targetId);
      const instrument = getInstrumentById(command.instrumentId);
      if (!instrument)
        throw new MuseCommandError(
          `Unbekanntes Instrument "${command.instrumentId}".`,
        );
      const current = assignment.doublingInstrumentIds.value;
      const next = command.enabled
        ? [...new Set([...current, command.instrumentId])]
        : current.filter((id) => id !== command.instrumentId);
      const updated: MuseInstrumentAssignment = {
        ...assignment,
        doublingInstrumentIds: {
          value: next,
          origin: "user",
          locked: true,
          reason: `Verdopplung mit ${instrument.name} manuell ${command.enabled ? "aktiviert" : "deaktiviert"}`,
        },
      };
      return touch({
        ...project,
        arrangement: {
          ...arrangement,
          assignments: arrangement.assignments.map((a) =>
            a.id === updated.id ? updated : a,
          ),
        },
      });
    }

    case "SET_OCTAVE_SHIFT": {
      const arrangement = requireArrangement(project);
      const assignment = findAssignment(project, command.targetId);
      if (
        !Number.isInteger(command.octaveShift) ||
        command.octaveShift < -3 ||
        command.octaveShift > 3
      ) {
        throw new MuseCommandError(
          "Oktavverschiebung muss eine ganze Zahl zwischen -3 und 3 sein.",
        );
      }
      const updated: MuseInstrumentAssignment = {
        ...assignment,
        octaveShift: {
          value: command.octaveShift,
          origin: "user",
          locked: true,
          reason: `Oktave manuell um ${command.octaveShift} verschoben`,
        },
      };
      return touch({
        ...project,
        arrangement: {
          ...arrangement,
          assignments: arrangement.assignments.map((a) =>
            a.id === updated.id ? updated : a,
          ),
        },
      });
    }

    case "SET_ARTICULATION_OVERRIDE": {
      const arrangement = requireArrangement(project);
      const assignment = findAssignment(project, command.targetId);
      const instrument = getInstrumentById(assignment.instrumentId.value);
      if (
        instrument &&
        !instrument.capabilities.includes(command.articulation)
      ) {
        throw new MuseCommandError(
          `${instrument.name} unterstützt die Artikulation "${command.articulation}" nicht.`,
        );
      }
      const updated: MuseInstrumentAssignment = {
        ...assignment,
        articulation: {
          value: command.articulation,
          origin: "user",
          locked: true,
          reason: "Artikulation manuell überschrieben",
        },
      };
      return touch({
        ...project,
        arrangement: {
          ...arrangement,
          assignments: arrangement.assignments.map((a) =>
            a.id === updated.id ? updated : a,
          ),
        },
      });
    }

    case "SET_TRACK_MUTED": {
      const arrangement = requireArrangement(project);
      const assignment = findAssignment(project, command.targetId);
      const updated: MuseInstrumentAssignment = {
        ...assignment,
        muted: {
          value: command.muted,
          origin: "user",
          locked: true,
          reason: command.muted
            ? "manuell stummgeschaltet"
            : "manuell aktiviert",
        },
      };
      return touch({
        ...project,
        arrangement: {
          ...arrangement,
          assignments: arrangement.assignments.map((a) =>
            a.id === updated.id ? updated : a,
          ),
        },
      });
    }

    case "APPLY_RECIPE": {
      if (!project.analysis)
        throw new MuseCommandError(
          "Das Projekt muss zuerst analysiert werden.",
        );
      const recipe = getRecipeById(command.recipeId);
      if (!recipe)
        throw new MuseCommandError(
          `Unbekanntes Orchestrierungsrezept "${command.recipeId}".`,
        );
      const seed =
        command.seed ??
        project.arrangement?.seed ??
        hashStringToSeed(project.id);
      const arrangement = buildArrangementPlan({
        project,
        recipeId: command.recipeId,
        seed,
        preserveUserOverrides: command.preserveUserOverrides,
        existingPlan: project.arrangement,
      });
      return touch({ ...project, arrangement });
    }

    case "SET_SECTION_INTENSITY": {
      const arrangement = requireArrangement(project);
      const section = arrangement.sections.find(
        (s) => s.id === command.sectionId,
      );
      if (!section)
        throw new MuseCommandError(
          `Kein Abschnitt mit ID "${command.sectionId}" gefunden.`,
        );
      if (command.intensity < 0 || command.intensity > 1)
        throw new MuseCommandError("Intensität muss zwischen 0 und 1 liegen.");
      const dynamics = arrangement.dynamics.map((d) =>
        d.sectionId === command.sectionId
          ? {
              ...d,
              intensity: {
                value: command.intensity,
                origin: "user" as const,
                locked: true,
                reason: "Intensität manuell gesetzt",
              },
            }
          : d,
      );
      return touch({ ...project, arrangement: { ...arrangement, dynamics } });
    }

    case "SET_LAYER_ACTIVE_RANGE": {
      const arrangement = requireArrangement(project);
      const layer = arrangement.layers.find((l) => l.id === command.layerId);
      if (!layer)
        throw new MuseCommandError(
          `Keine Schicht mit ID "${command.layerId}" gefunden.`,
        );
      if (command.startTick < 0 || command.endTick <= command.startTick) {
        throw new MuseCommandError(
          "Der aktive Bereich einer Schicht muss startTick < endTick mit startTick >= 0 erfüllen.",
        );
      }
      const layers = arrangement.layers.map((l) =>
        l.id === command.layerId
          ? {
              ...l,
              activeRange: {
                value: {
                  startTick: command.startTick,
                  endTick: command.endTick,
                },
                origin: "user" as const,
                locked: true,
                reason: "Aktiver Bereich manuell gesetzt",
              },
            }
          : l,
      );
      return touch({ ...project, arrangement: { ...arrangement, layers } });
    }

    case "LOCK_MELODY": {
      const arrangement = requireArrangement(project);
      const assignment = arrangement.assignments.find(
        (a) => a.targetTrackId === command.sourceTrackId,
      );
      if (!assignment)
        throw new MuseCommandError(
          `Keine Spur mit ID "${command.sourceTrackId}" im Orchestrierungsplan gefunden.`,
        );
      const updated: MuseInstrumentAssignment = {
        ...assignment,
        role: {
          value: "melody",
          origin: "user",
          locked: true,
          reason: "Als Hauptmelodie gesperrt",
        },
        muted: {
          value: false,
          origin: "user",
          locked: true,
          reason: "Hauptmelodie darf nicht stummgeschaltet werden",
        },
      };
      return touch({
        ...project,
        arrangement: {
          ...arrangement,
          assignments: arrangement.assignments.map((a) =>
            a.id === updated.id ? updated : a,
          ),
        },
      });
    }

    case "CREATE_VARIANT": {
      requireArrangement(project);
      if (project.variants.some((v) => v.id === command.variant.id)) {
        throw new MuseCommandError(
          `Es existiert bereits eine Variante mit ID "${command.variant.id}".`,
        );
      }
      return touch({
        ...project,
        variants: [...project.variants, command.variant],
      });
    }

    case "DELETE_VARIANT": {
      return touch({
        ...project,
        variants: project.variants.filter((v) => v.id !== command.variantId),
      });
    }

    case "UNDO":
    case "REDO":
      throw new MuseCommandError(
        `"${command.type}" wird von der Store-Ebene behandelt, nicht vom reinen Reducer.`,
      );

    default: {
      const exhaustive: never = command;
      throw new MuseCommandError(
        `Unbekannter Command: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

export function makeImportCommand(
  fileName: string,
  bytesBase64: string,
): MuseCommand {
  return {
    type: "IMPORT_MIDI",
    source: { kind: "file", fileName, bytesBase64 },
  };
}

export function newCommandLogId(): string {
  return createId("cmd");
}
