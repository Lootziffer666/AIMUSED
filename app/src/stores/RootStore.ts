import { CommandService } from "@signal-app/core"
import { Player, SoundFont, SoundFontSynth } from "@signal-app/player"
import { isRunningInElectron } from "../helpers/platform"
import { EventSource } from "../player/EventSource"
import { AutoSaveService } from "../services/AutoSaveService"
import { GroupOutput } from "../services/GroupOutput"
import { MIDIActivity } from "../services/MIDIActivity"
import { MIDIInput } from "../services/MIDIInput"
import { MIDIMonitor } from "../services/MIDIMonitor"
import { MIDIRecorder } from "../services/MIDIRecorder"
import { BluetoothMIDIDeviceStore } from "./BluetoothMIDIDeviceStore"
import { MIDIDeviceStore } from "./MIDIDeviceStore"
import { OrchestrationStore } from "./OrchestrationStore"
import { PatternStore } from "./PatternStore"
import { registerReactions } from "./reactions"
import { SongStore } from "./SongStore"
import { SoundFontStore } from "./SoundFontStore"
import { ToneMapStore } from "./ToneMapStore"

export default class RootStore {
  readonly songStore = new SongStore()
  readonly audioContext: AudioContext
  readonly midiDeviceStore: MIDIDeviceStore
  readonly player: Player
  readonly synth: SoundFontSynth
  readonly metronomeSynth: SoundFontSynth
  readonly synthGroup: GroupOutput
  readonly midiInput = new MIDIInput()
  readonly midiRecorder: MIDIRecorder
  readonly midiMonitor: MIDIMonitor
  readonly midiActivity: MIDIActivity
  readonly soundFontStore: SoundFontStore
  readonly bluetoothMIDIDeviceStore: BluetoothMIDIDeviceStore
  readonly autoSaveService: AutoSaveService
  readonly commands = new CommandService(this.songStore)
  readonly orchestrationStore = new OrchestrationStore()
  readonly patternStore = new PatternStore()
  readonly toneMapStore = new ToneMapStore()

  constructor() {
    const context = new (window.AudioContext || window.webkitAudioContext)()
    this.audioContext = context
    this.synth = new SoundFontSynth(context)
    this.metronomeSynth = new SoundFontSynth(context)
    this.synthGroup = new GroupOutput(this.metronomeSynth)
    this.synthGroup.outputs.push({ synth: this.synth, isEnabled: true })

    const eventSource = new EventSource(this.songStore)
    this.player = new Player(this.synthGroup, eventSource)

    this.soundFontStore = new SoundFontStore(this.synth)

    this.midiDeviceStore = new MIDIDeviceStore(this.midiInput)
    this.bluetoothMIDIDeviceStore = new BluetoothMIDIDeviceStore(this.midiInput)
    this.midiRecorder = new MIDIRecorder(
      this.songStore,
      this.player,
      this.midiDeviceStore,
    )
    this.midiMonitor = new MIDIMonitor(this.player, this.midiDeviceStore)
    this.midiActivity = new MIDIActivity(
      this.midiDeviceStore,
      this.midiRecorder,
      this.songStore,
    )

    this.midiInput.on("midiMessage", (e) => {
      this.midiActivity.onMessage(e)
      this.midiMonitor.onMessage(e)
      this.midiRecorder.onMessage(e)
    })

    this.autoSaveService = new AutoSaveService(this.songStore)

    registerReactions(this)
  }

  async init() {
    await this.synth.setup()
    await this.soundFontStore.init()
    this.setupMetronomeSynth()
    this.autoSaveService.startAutoSave()
    this.bluetoothMIDIDeviceStore.autoConnect()
  }

  private async setupMetronomeSynth() {
    const data = await loadMetronomeSoundFontData()
    await this.metronomeSynth.loadSoundFont(await SoundFont.load(data))
  }
}

async function loadMetronomeSoundFontData() {
  if (isRunningInElectron()) {
    return await window.electronAPI.readFile(
      "./assets/soundfonts/A320U_drums.sf2",
    )
  }
  // Bundled with the build; the CDN is only the fallback for a deployment
  // that did not copy the asset, so a self-hosted MUSE works offline.
  const local = new URL("soundfonts/A320U_drums.sf2", document.baseURI).href
  const response = await fetch(local)
  if (response.ok) return await response.arrayBuffer()

  const fallback = await fetch(
    "https://cdn.jsdelivr.net/gh/ryohey/signal@6959f35/public/A320U_drums.sf2",
  )
  return await fallback.arrayBuffer()
}
