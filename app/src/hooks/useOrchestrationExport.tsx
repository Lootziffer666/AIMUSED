import { TrackId } from "@signal-app/core"
import { PlayerEvent, renderAudio } from "@signal-app/player"
import { atom, useAtomValue, useSetAtom, useStore } from "jotai"
import { downloadBlob } from "../helpers/Downloader"
import { encodeWAV } from "../helpers/encodeAudio"
import {
  AppliedOrchestrationTrack,
  filterEventsByTrackIds,
  groupAppliedTracksByFamily,
} from "../services/orchestration/orchestrationExport"
import { useSong } from "./useSong"
import { useStores } from "./useStores"

/**
 * WAV mix/stem export for the tracks most recently added to the song by
 * `OrchestrationDialog`'s "apply to song" action. Reuses AIMUSED's existing
 * offline rendering pipeline (`@signal-app/player`'s `renderAudio` +
 * `encodeWAV`) exactly like `useExport.tsx` does for whole-song export, just
 * scoped to a subset of tracks via `filterEventsByTrackIds`.
 *
 * Deliberately a separate atom/hook set from `useExport.tsx` (not a shared
 * one) so the existing plain-song export feature is untouched.
 */
export function useOrchestrationExport() {
  return {
    get openOrchestrationExportDialog() {
      return useAtomValue(openOrchestrationExportDialogAtom)
    },
    get progress() {
      return useAtomValue(orchestrationExportProgressAtom)
    },
    /** Human-readable label for what's currently rendering ("Mix", or a stem's group name). */
    get exportLabel() {
      return useAtomValue(orchestrationExportLabelAtom)
    },
    setOpenOrchestrationExportDialog: useSetAtom(
      openOrchestrationExportDialogAtom,
    ),
    cancelOrchestrationExport: useSetAtom(cancelOrchestrationExportAtom),
    exportOrchestrationMix: useExportOrchestrationMix(),
    exportOrchestrationStems: useExportOrchestrationStems(),
  }
}

// atoms
const openOrchestrationExportDialogAtom = atom<boolean>(false)
const orchestrationExportProgressAtom = atom<number>(0)
const orchestrationExportLabelAtom = atom<string>("")
const isOrchestrationExportCanceledAtom = atom<boolean>(false)

// actions
const cancelOrchestrationExportAtom = atom(null, (_get, set) => {
  set(isOrchestrationExportCanceledAtom, true)
})

const waitForAnimationFrame = () =>
  new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

// Renders the events belonging to `trackIds` to a WAV `Uint8Array`, sharing
// the same soundfont/timebase/sampleRate/progress wiring `useExport.tsx`
// uses for the whole song.
function useRenderOrchestrationTracksToWav() {
  const { synth } = useStores()
  const { timebase, getSong } = useSong()
  const setProgress = useSetAtom(orchestrationExportProgressAtom)
  const store = useStore()

  return async (trackIds: ReadonlySet<TrackId>): Promise<Uint8Array> => {
    const soundFontData = synth.loadedSoundFont?.data
    if (soundFontData === undefined) {
      throw new Error("No SoundFont loaded")
    }

    const sampleRate = 44100
    const events = filterEventsByTrackIds(
      getSong().allEvents as unknown as PlayerEvent[],
      trackIds,
    )

    const audioBuffer = await renderAudio(
      soundFontData,
      events,
      timebase,
      sampleRate,
      {
        cancel: () => store.get(isOrchestrationExportCanceledAtom),
        waitForEventLoop: waitForAnimationFrame,
        onProgress: (numFrames, totalFrames) =>
          setProgress(numFrames / totalFrames),
      },
    )

    return encodeWAV(audioBuffer)
  }
}

const useExportOrchestrationMix = () => {
  const renderToWav = useRenderOrchestrationTracksToWav()
  const { getSong } = useSong()
  const setOpenDialog = useSetAtom(openOrchestrationExportDialogAtom)
  const setProgress = useSetAtom(orchestrationExportProgressAtom)
  const setLabel = useSetAtom(orchestrationExportLabelAtom)
  const setCanceled = useSetAtom(isOrchestrationExportCanceledAtom)

  return async (tracks: readonly AppliedOrchestrationTrack[]) => {
    if (tracks.length === 0) {
      return
    }

    setCanceled(false)
    setOpenDialog(true)
    setProgress(0)
    setLabel("Mix")

    try {
      const trackIds = new Set(tracks.map((t) => t.trackId))
      const wav = await renderToWav(trackIds)
      setOpenDialog(false)
      const name = `${getSong().name || "orchestration"}-mix.wav`
      downloadBlob(new Blob([wav as BlobPart], { type: "audio/wav" }), name)
    } catch (e) {
      console.warn(e)
      setOpenDialog(false)
    }
  }
}

const useExportOrchestrationStems = () => {
  const renderToWav = useRenderOrchestrationTracksToWav()
  const { getSong } = useSong()
  const setOpenDialog = useSetAtom(openOrchestrationExportDialogAtom)
  const setProgress = useSetAtom(orchestrationExportProgressAtom)
  const setLabel = useSetAtom(orchestrationExportLabelAtom)
  const setCanceled = useSetAtom(isOrchestrationExportCanceledAtom)
  const store = useStore()

  return async (tracks: readonly AppliedOrchestrationTrack[]) => {
    const groups = groupAppliedTracksByFamily(tracks)
    if (groups.length === 0) {
      return
    }

    setCanceled(false)
    setOpenDialog(true)

    try {
      for (const group of groups) {
        if (store.get(isOrchestrationExportCanceledAtom)) {
          break
        }
        setLabel(group.groupName)
        setProgress(0)

        const wav = await renderToWav(new Set(group.trackIds))

        if (store.get(isOrchestrationExportCanceledAtom)) {
          break
        }

        const name = `${getSong().name || "orchestration"}-${group.groupName}.wav`
        downloadBlob(new Blob([wav as BlobPart], { type: "audio/wav" }), name)

        // Sequential downloads with a short delay between each: browsers
        // (Chrome in particular) can throttle or block several
        // programmatic downloads triggered from a single click without a
        // user gesture per file. A small delay keeps each download
        // separately dispatched rather than firing all at once.
        await sleep(400)
      }
    } catch (e) {
      console.warn(e)
    } finally {
      setOpenDialog(false)
    }
  }
}
