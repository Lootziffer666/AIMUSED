import {
  buildArrangedExportTracks,
  type MuseMidiProject,
} from "@signal-app/orchestration-core";
import { buildMidiFromTracks } from "./midi/export";

/**
 * Exports the full arrangement as a Format-1 Standard MIDI File.
 *
 * This lives in `midi-project` rather than alongside
 * `buildArrangedExportTracks` (in `@signal-app/orchestration-core`) because
 * it's the one step that actually touches the `midi-file` SMF-writing
 * dependency — `buildMidiFromTracks` — which is intentionally scoped to
 * this package. `orchestration-core` cannot depend on this package (that
 * would form a cyclic workspace dependency, since this package already
 * depends on it for analysis/orchestration types and logic), so the final
 * "flatten the arrangement plan into deterministic export tracks, then
 * serialize to MIDI bytes" pipeline is split across this one-directional
 * boundary: `buildArrangedExportTracks` (pure data shaping) stays upstream,
 * `exportArrangedMidi` (real MIDI serialization) lives here.
 */
export function exportArrangedMidi(project: MuseMidiProject): Uint8Array {
  const tracks = buildArrangedExportTracks(project);
  return buildMidiFromTracks(
    project.timeline,
    tracks,
    `${project.name} (Arrangement)`,
  );
}
