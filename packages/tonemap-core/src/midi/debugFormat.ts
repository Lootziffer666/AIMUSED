import type { MidiGraph, MidiGraphEvent } from "./eventGraph.ts"
import { tickToSeconds } from "./eventGraph.ts"

/**
 * Human readable debug views of the canonical event graph.
 *
 * These are *derived* views, never the source of truth: they exist so a human
 * can diff two imports or check an alignment by eye.
 */

export interface DebugOptions {
  /** Include absolute seconds (requires walking the tempo map per event) */
  withSeconds?: boolean
}

function eventFields(event: MidiGraphEvent): Record<string, unknown> {
  const { deltaTime: _deltaTime, ...rest } = event.event as unknown as Record<
    string,
    unknown
  > & { deltaTime?: number }
  return rest
}

/** One JSON object per line – stable field order, stable event order. */
export function graphToJsonl(
  graph: MidiGraph,
  options: DebugOptions = {},
): string {
  const lines: string[] = []
  for (const track of graph.tracks) {
    for (const item of [...track.events].sort(
      (a, b) => a.tick - b.tick || a.order - b.order,
    )) {
      const record: Record<string, unknown> = {
        id: item.id,
        track: item.trackIndex,
        tick: item.tick,
        order: item.order,
        ...eventFields(item),
      }
      if (options.withSeconds) {
        record.seconds = Number(tickToSeconds(graph, item.tick).toFixed(6))
      }
      lines.push(JSON.stringify(record))
    }
  }
  return `${lines.join("\n")}\n`
}

const TSV_COLUMNS = [
  "id",
  "track",
  "tick",
  "order",
  "type",
  "channel",
  "noteNumber",
  "velocity",
  "value",
  "text",
]

/** Tab separated view for spreadsheet-style inspection. */
export function graphToTsv(graph: MidiGraph): string {
  const rows: string[] = [TSV_COLUMNS.join("\t")]
  for (const track of graph.tracks) {
    for (const item of [...track.events].sort(
      (a, b) => a.tick - b.tick || a.order - b.order,
    )) {
      const fields = eventFields(item) as Record<string, unknown>
      const row = [
        item.id,
        String(item.trackIndex),
        String(item.tick),
        String(item.order),
        String(fields.type ?? ""),
        stringify(fields.channel),
        stringify(fields.noteNumber),
        stringify(fields.velocity),
        stringify(
          fields.value ??
            fields.controllerValue ??
            fields.programNumber ??
            fields.amount,
        ),
        stringify(fields.text).replace(/\t|\n/g, " "),
      ]
      rows.push(row.join("\t"))
    }
  }
  return `${rows.join("\n")}\n`
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return ""
  return String(value)
}

/** Compact note list – the view most useful when checking an alignment. */
export function notesToTsv(graph: MidiGraph): string {
  const rows: string[] = [
    [
      "id",
      "track",
      "channel",
      "note",
      "startTick",
      "endTick",
      "durationTicks",
      "startSeconds",
      "velocity",
      "unterminated",
    ].join("\t"),
  ]
  for (const note of graph.notes) {
    rows.push(
      [
        note.id,
        note.trackIndex,
        note.channel,
        note.noteNumber,
        note.startTick,
        note.endTick,
        note.endTick - note.startTick,
        tickToSeconds(graph, note.startTick).toFixed(6),
        note.velocity,
        note.unterminated ? "yes" : "no",
      ].join("\t"),
    )
  }
  return `${rows.join("\n")}\n`
}
