import { action, makeObservable, observable } from "mobx"
import { makePersistable } from "mobx-persist-store"
import type { MusePattern } from "../entities/pattern/MusePattern"
import type { PatternTrackBinding } from "../services/pattern/patternSongAdapter"

/**
 * Persistent home of the pattern library.
 *
 * Only the musical data lives here. Editor state (selection, active layer,
 * zoom, open drawers) stays inside the editor component and is deliberately
 * kept out of the stored pattern model.
 */
export class PatternStore {
  patterns: MusePattern[] = []
  /** patternId -> layerId -> song track id, so re-export updates tracks */
  bindings: Record<string, PatternTrackBinding> = {}
  /** id of the pattern currently open in the editor, null = library view */
  openPatternId: string | null = null

  constructor() {
    makeObservable(this, {
      patterns: observable.deep,
      bindings: observable.deep,
      openPatternId: observable,
      save: action,
      remove: action,
      open: action,
      close: action,
      setBinding: action,
    })

    makePersistable(this, {
      name: "MusePatternStore",
      properties: ["patterns", "bindings"],
      storage: window.localStorage,
    })
  }

  get(id: string): MusePattern | undefined {
    return this.patterns.find((p) => p.id === id)
  }

  get openPattern(): MusePattern | undefined {
    return this.openPatternId === null
      ? undefined
      : this.get(this.openPatternId)
  }

  /** Insert or update in place – saving the same pattern twice never duplicates. */
  save(pattern: MusePattern) {
    const index = this.patterns.findIndex((p) => p.id === pattern.id)
    if (index === -1) {
      this.patterns = [...this.patterns, pattern]
    } else {
      const next = [...this.patterns]
      next[index] = pattern
      this.patterns = next
    }
  }

  remove(id: string) {
    this.patterns = this.patterns.filter((p) => p.id !== id)
    const { [id]: _removed, ...rest } = this.bindings
    this.bindings = rest
    if (this.openPatternId === id) this.openPatternId = null
  }

  open(id: string) {
    this.openPatternId = id
  }

  close() {
    this.openPatternId = null
  }

  getBinding(patternId: string): PatternTrackBinding {
    return this.bindings[patternId] ?? {}
  }

  setBinding(patternId: string, binding: PatternTrackBinding) {
    this.bindings = { ...this.bindings, [patternId]: binding }
  }
}
