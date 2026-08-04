import { emptySong, type Track } from "@signal-app/core"
import { describe, expect, it } from "vitest"
import { PatternStore } from "../../stores/PatternStore"
import {
  addLayer,
  addNote,
  createPattern,
  setPatternName,
  setPatternSteps,
  toggleLayerFlag,
} from "./patternOps"
import {
  applyPatternToSong,
  patternTrackName,
  removePatternFromSong,
} from "./patternSongAdapter"

const TIMEBASE = 480

function noteEvents(track: Track) {
  return track.events.filter((e) => "subtype" in e && e.subtype === "note")
}

function demoPattern() {
  let pattern = createPattern({
    name: "Demo",
    timebase: TIMEBASE,
    steps: 16,
  })
  const piano = pattern.trackLayers[0].id
  pattern = addLayer(pattern, {
    name: "Kick",
    kind: "percussion",
    drumZoneId: "kick",
  })
  const kick = pattern.trackLayers[1].id
  pattern = addNote(pattern, piano, {
    startTick: 0,
    durationTicks: 480,
    noteNumber: 60,
  }).pattern
  pattern = addNote(pattern, kick, { startTick: 0, noteNumber: 60 }).pattern
  return { pattern, piano, kick }
}

describe("Pattern export to song", () => {
  it("creates one track per exporting layer", () => {
    const song = emptySong()
    const before = song.tracks.length
    const { pattern } = demoPattern()

    const binding = applyPatternToSong(song, pattern)

    expect(song.tracks.length).toBe(before + 2)
    expect(Object.keys(binding)).toHaveLength(2)
    const names = song.tracks.map((t) => t.name)
    expect(names).toContain(patternTrackName(pattern, pattern.trackLayers[0]))
  })

  it("updates the same tracks on repeated export instead of duplicating", () => {
    const song = emptySong()
    const { pattern, piano } = demoPattern()
    const first = applyPatternToSong(song, pattern)
    const trackCount = song.tracks.length

    const changed = addNote(pattern, piano, {
      startTick: 960,
      noteNumber: 64,
    }).pattern
    const second = applyPatternToSong(song, changed, first)

    expect(song.tracks.length).toBe(trackCount)
    expect(second[piano]).toBe(first[piano])
    const track = song.getTrack(second[piano])
    expect(track).toBeDefined()
    expect(noteEvents(track!)).toHaveLength(2)
  })

  it("does not accumulate note events across exports", () => {
    const song = emptySong()
    const { pattern, piano } = demoPattern()
    let binding = applyPatternToSong(song, pattern)
    binding = applyPatternToSong(song, pattern, binding)
    binding = applyPatternToSong(song, pattern, binding)
    expect(noteEvents(song.getTrack(binding[piano])!)).toHaveLength(1)
  })

  it("renames bound tracks when the pattern is renamed", () => {
    const song = emptySong()
    const { pattern, piano } = demoPattern()
    const binding = applyPatternToSong(song, pattern)
    const renamed = setPatternName(pattern, "Refrain")
    applyPatternToSong(song, renamed, binding)
    expect(song.getTrack(binding[piano])!.name).toBe(
      patternTrackName(renamed, renamed.trackLayers[0]),
    )
  })

  it("skips events beyond the end marker and clips held notes", () => {
    const song = emptySong()
    let { pattern, piano } = demoPattern()
    pattern = addNote(pattern, piano, {
      startTick: 480 * 8,
      noteNumber: 72,
    }).pattern
    pattern = addNote(pattern, piano, {
      startTick: 480,
      durationTicks: 480 * 40,
      noteNumber: 67,
    }).pattern
    pattern = setPatternSteps(pattern, 8) // 8 * 120 ticks = 960

    const binding = applyPatternToSong(song, pattern)
    const events = noteEvents(song.getTrack(binding[piano])!) as unknown as {
      tick: number
      duration: number
    }[]
    expect(events).toHaveLength(2) // the note at tick 3840 stays out
    const held = events.find((e) => e.tick === 480)
    expect(held?.duration).toBe(pattern.lengthTicks - 480)
  })

  it("gives melodic and percussion layers separate channels", () => {
    const song = emptySong()
    const { pattern, piano, kick } = demoPattern()
    const binding = applyPatternToSong(song, pattern)
    expect(song.getTrack(binding[kick])!.channel).toBe(9)
    expect(song.getTrack(binding[piano])!.channel).not.toBe(9)
  })

  it("releases the track of a layer that stops exporting", () => {
    const song = emptySong()
    const { pattern, kick } = demoPattern()
    const binding = applyPatternToSong(song, pattern)
    const trackCount = song.tracks.length

    const muted = toggleLayerFlag(pattern, kick, "muted")
    const next = applyPatternToSong(song, muted, binding)

    expect(next[kick]).toBeUndefined()
    expect(song.tracks.length).toBe(trackCount - 1)
  })

  it("removes every track a pattern owns", () => {
    const song = emptySong()
    const before = song.tracks.length
    const { pattern } = demoPattern()
    const binding = applyPatternToSong(song, pattern)
    removePatternFromSong(song, binding)
    expect(song.tracks.length).toBe(before)
  })

  it("recovers when a bound track disappeared from the song", () => {
    const song = emptySong()
    const { pattern, piano } = demoPattern()
    const binding = applyPatternToSong(song, pattern)
    song.removeTrack(binding[piano])
    const next = applyPatternToSong(song, pattern, binding)
    expect(song.getTrack(next[piano])).toBeDefined()
  })
})

describe("Pattern store persistence", () => {
  it("saves in place and never duplicates a pattern", () => {
    const store = new PatternStore()
    const { pattern } = demoPattern()
    store.save(pattern)
    store.save(setPatternName(pattern, "Zweiter Name"))
    expect(store.patterns).toHaveLength(1)
    expect(store.get(pattern.id)?.name).toBe("Zweiter Name")
  })

  it("closes and reopens a pattern with all layers and notes intact", () => {
    const store = new PatternStore()
    const { pattern, piano } = demoPattern()
    store.save(pattern)
    store.open(pattern.id)
    expect(store.openPattern?.id).toBe(pattern.id)

    store.close()
    expect(store.openPattern).toBeUndefined()

    store.open(pattern.id)
    const reopened = store.openPattern
    expect(reopened?.trackLayers).toHaveLength(2)
    expect(
      reopened?.trackLayers.find((l) => l.id === piano)?.notes,
    ).toHaveLength(1)
  })

  it("keeps the track binding per pattern", () => {
    const store = new PatternStore()
    const song = emptySong()
    const { pattern } = demoPattern()
    store.save(pattern)
    store.setBinding(pattern.id, applyPatternToSong(song, pattern))
    expect(Object.keys(store.getBinding(pattern.id))).toHaveLength(2)

    store.remove(pattern.id)
    expect(store.getBinding(pattern.id)).toEqual({})
    expect(store.patterns).toHaveLength(0)
  })
})
