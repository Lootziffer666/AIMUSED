import { Player } from "@signal-app/player"
import { deserializeSingleEvent, Stream } from "midifile-ts"
import { MIDIDeviceStore } from "../stores/MIDIDeviceStore"
import { MIDIInputEvent } from "./MIDIInput"

export class MIDIMonitor {
  channel: number = 0

  /**
   * Off while another view sounds MIDI input itself.
   *
   * The pattern editor plays incoming notes with the instrument of the layer
   * being recorded into, which is not the selected song track. Leaving the
   * monitor on as well would sound every note twice, on two instruments.
   */
  enabled: boolean = true

  constructor(
    private readonly player: Player,
    private readonly midiDeviceStore: MIDIDeviceStore,
  ) {}

  onMessage(e: MIDIInputEvent) {
    if (!this.enabled) {
      return
    }

    const stream = new Stream(e.data)
    const event = deserializeSingleEvent(stream)

    // Only allow channel and SysEx events
    if (
      event.type !== "channel" &&
      event.type !== "sysEx" &&
      event.type !== "dividedSysEx"
    ) {
      return
    }

    if (
      this.midiDeviceStore.midiInputRouting === "selectedTrack" &&
      event.type === "channel"
    ) {
      // modify channel to the selected track channel
      event.channel = this.channel
    }

    this.player.sendEvent(event)
  }
}
