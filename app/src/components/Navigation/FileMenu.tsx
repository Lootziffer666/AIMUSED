import { FC } from "react"
import {
  useOpenProjectFile,
  useSaveProjectFileAs,
} from "../../actions/projectFile"
import { useSong } from "../../hooks/useSong"
import { useSongFile } from "../../hooks/useSongFile"
import { envString } from "../../localize/envString"
import { Localized } from "../../localize/useLocalization"
import { MenuHotKey as HotKey, MenuDivider, MenuItem } from "../ui/Menu"

export const FileMenu: FC<{ close: () => void }> = ({ close }) => {
  const { fileHandle, getSong } = useSong()
  const { createNewSong, openSong, saveSong, saveAsSong, downloadSong } =
    useSongFile()
  const openProjectFile = useOpenProjectFile()
  const saveProjectFileAs = useSaveProjectFileAs()

  const onClickNew = async () => {
    close()
    await createNewSong()
  }

  const onClickOpen = async () => {
    close()
    await openSong()
  }

  const onClickSave = async () => {
    close()
    await saveSong()
  }

  const onClickSaveAs = async () => {
    close()
    await saveAsSong()
  }

  const onClickDownload = async () => {
    close()
    await downloadSong()
  }

  const onClickOpenProject = async () => {
    close()
    await openProjectFile()
  }

  const onClickSaveProjectAs = async () => {
    close()
    await saveProjectFileAs(getSong())
  }

  return (
    <>
      <MenuItem onClick={onClickNew}>
        <Localized name="new-song" />
        <HotKey>{envString.altOrOption}+N</HotKey>
      </MenuItem>

      <MenuDivider />

      <MenuItem onClick={onClickOpen}>
        <Localized name="open-song" />
        <HotKey>{envString.cmdOrCtrl}+O</HotKey>
      </MenuItem>

      <MenuItem onClick={onClickSave} disabled={fileHandle === null}>
        <Localized name="save-song" />
        <HotKey>{envString.cmdOrCtrl}+S</HotKey>
      </MenuItem>

      <MenuItem onClick={onClickSaveAs}>
        <Localized name="save-as" />
        <HotKey>{envString.cmdOrCtrl}+Shift+S</HotKey>
      </MenuItem>

      <MenuItem onClick={onClickDownload}>
        <Localized name="download-midi" />
      </MenuItem>

      <MenuDivider />

      <MenuItem onClick={onClickOpenProject}>
        <Localized name="open-project-file" />
      </MenuItem>

      <MenuItem onClick={onClickSaveProjectAs}>
        <Localized name="save-project-file-as" />
      </MenuItem>
    </>
  )
}
