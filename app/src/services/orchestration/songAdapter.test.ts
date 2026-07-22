import { emptySong, NoteEvent, Song, Track } from "@signal-app/core"
import {
  analyzeProject,
  buildArrangementPlan,
} from "@signal-app/orchestration-core"
import { buildArrangedExportTracks } from "@signal-app/orchestration-core"
import { applyRenderResultToSong, songToMuseProject } from "./songAdapter"

// A small, hand-authored melody + bass sketch, just rich enough for MUSE's
// analysis/orchestration pipeline to produce a meaningful plan without
// pulling in an external fixture file.
function buildTestSong(): Song {
  const song = emptySong()
  const timebase = song.timebase

  const melody = song.tracks[1]
  const motif = [67, 69, 71, 72, 71, 69, 67, 64]
  motif.forEach((pitch, i) => {
    for (let bar = 0; bar < 4; bar++) {
      melody.addEvent<NoteEvent>({
        type: "channel",
        subtype: "note",
        tick: bar * timebase * 4 + i * (timebase / 2),
        duration: timebase / 2 - 4,
        noteNumber: pitch,
        velocity: 90,
      })
    }
  })

  const bass = new Track()
  bass.channel = 1
  song.addTrack(bass)
  for (let beat = 0; beat < 16; beat++) {
    bass.addEvent<NoteEvent>({
      type: "channel",
      subtype: "note",
      tick: beat * timebase,
      duration: timebase - 4,
      noteNumber: 40,
      velocity: 80,
    })
  }

  song.updateEndOfSong()
  return song
}

describe("songAdapter", () => {
  it("round-trips a Song into a MuseMidiProject with a track id mapping", () => {
    const song = buildTestSong()
    const { project, mapping } = songToMuseProject(song, "Test Song")

    expect(project.name).toBe("Test Song")
    expect(project.tracks.length).toBeGreaterThan(0)
    // Every MUSE track should map back to a real AIMUSED track id.
    for (const museTrack of project.tracks) {
      const songTrackId = mapping.museTrackIdToSongTrackId.get(museTrack.id)
      expect(songTrackId).toBeDefined()
      if (songTrackId !== undefined) {
        expect(song.getTrack(songTrackId)).toBeDefined()
      }
    }
  })

  it("analyzes, orchestrates and applies the result back onto the Song as new tracks", () => {
    const song = buildTestSong()
    const originalTrackCount = song.tracks.length
    const { project } = songToMuseProject(song, "Test Song")

    project.analysis = analyzeProject(project)
    expect(project.analysis.tracks.length).toBe(project.tracks.length)

    project.arrangement = buildArrangementPlan({
      project,
      recipeId: "cinematic_adventure",
      seed: 42,
      preserveUserOverrides: false,
    })
    expect(project.arrangement.assignments.length).toBeGreaterThan(0)

    const exportTracks = buildArrangedExportTracks(project)
    expect(exportTracks.length).toBeGreaterThan(0)

    const newTracks = applyRenderResultToSong(song, exportTracks)

    expect(newTracks.length).toBe(exportTracks.length)
    expect(song.tracks.length).toBe(originalTrackCount + exportTracks.length)

    // Non-destructive: the original tracks are still present, unchanged in count.
    expect(song.tracks.slice(0, originalTrackCount).length).toBe(
      originalTrackCount,
    )

    let totalNotes = 0
    for (const track of newTracks) {
      expect(track.events.length).toBeGreaterThan(0)
      for (const event of track.events) {
        if ("noteNumber" in event) {
          totalNotes++
          // Every note must fall within the song's overall length.
          expect(event.tick).toBeGreaterThanOrEqual(0)
          expect(event.tick).toBeLessThan(song.endOfSong)
        }
      }
    }
    expect(totalNotes).toBeGreaterThan(0)
  })
})
