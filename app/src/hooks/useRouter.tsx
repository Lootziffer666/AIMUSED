import { atom, useAtomValue, useSetAtom } from "jotai"

export type RoutePath =
  | "/track"
  | "/arrange"
  | "/tempo"
  | "/jam"
  | "/jam-grid"
  | "/jam-scan"
  | "/tonemap"

export function useRouter() {
  return {
    get path() {
      return useAtomValue(pathAtom)
    },
    setPath: useSetAtom(pathAtom),
  }
}

// atoms
const pathAtom = atom<RoutePath>("/track")
