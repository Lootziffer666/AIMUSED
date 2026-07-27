/**
 * Guard rails for private reference material.
 *
 * Reference recordings are usually not ours to redistribute. Every path that
 * enters the pipeline is checked against the directories the repository
 * ignores, and anything else is reported loudly *before* it can be committed.
 */

export const PRIVATE_ASSET_DIRECTORIES = [
  "private-assets",
  "reference-audio",
  "reference-midi",
  "analysis-cache",
  "render-cache",
] as const

export interface AssetLocationCheck {
  path: string
  isPrivateLocation: boolean
  message?: string
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "")
}

/** True when the path lives in one of the gitignored private directories. */
export function isPrivateAssetPath(path: string): boolean {
  const normalized = normalize(path)
  return PRIVATE_ASSET_DIRECTORIES.some(
    (directory) =>
      normalized === directory ||
      normalized.startsWith(`${directory}/`) ||
      normalized.includes(`/${directory}/`),
  )
}

export function checkAssetLocation(path: string): AssetLocationCheck {
  if (isPrivateAssetPath(path)) return { path, isPrivateLocation: true }
  return {
    path,
    isPrivateLocation: false,
    message: `"${path}" is outside the private asset directories (${PRIVATE_ASSET_DIRECTORIES.join(", ")}). Reference recordings must not be committed.`,
  }
}

/** Convenience for the CLI: collects every referenced path of a manifest. */
export function checkManifestAssets(manifest: {
  midi: { path: string }
  audio?: { path: string }
  rights?: { publiclyRedistributable?: boolean }
}): AssetLocationCheck[] {
  const checks = [checkAssetLocation(manifest.midi.path)]
  if (manifest.audio) checks.push(checkAssetLocation(manifest.audio.path))
  if (manifest.rights?.publiclyRedistributable === true) {
    // explicitly cleared material may live anywhere
    return checks.map((check) => ({
      ...check,
      message: undefined,
      isPrivateLocation: true,
    }))
  }
  return checks
}
