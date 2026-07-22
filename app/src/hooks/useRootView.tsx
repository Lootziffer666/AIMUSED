import { atom, useAtomValue, useSetAtom } from "jotai"

export function useRootView() {
  return {
    get openHelpDialog() {
      return useAtomValue(openHelpAtom)
    },
    get openSettingDialog() {
      return useAtomValue(openSettingDialogAtom)
    },
    get openControlSettingDialog() {
      return useAtomValue(openControlSettingDialogAtom)
    },
    get openOrchestrationDialog() {
      return useAtomValue(openOrchestrationDialogAtom)
    },
    get initializeError() {
      return useAtomValue(initializeErrorAtom)
    },
    get openInitializeErrorDialog() {
      return useAtomValue(openInitializeErrorDialogAtom)
    },
    setOpenHelpDialog: useSetAtom(openHelpAtom),
    setOpenSettingDialog: useSetAtom(openSettingDialogAtom),
    setOpenControlSettingDialog: useSetAtom(openControlSettingDialogAtom),
    setOpenOrchestrationDialog: useSetAtom(openOrchestrationDialogAtom),
    setInitializeError: useSetAtom(initializeErrorAtom),
    setOpenInitializeErrorDialog: useSetAtom(openInitializeErrorDialogAtom),
  }
}

// atoms
const openHelpAtom = atom<boolean>(false)
const openSettingDialogAtom = atom<boolean>(false)
const openControlSettingDialogAtom = atom<boolean>(false)
const openOrchestrationDialogAtom = atom<boolean>(false)
const initializeErrorAtom = atom<Error | null>(null)
const openInitializeErrorDialogAtom = atom<boolean>(false)
