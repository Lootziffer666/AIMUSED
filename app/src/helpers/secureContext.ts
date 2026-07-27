/**
 * Camera and microphone only exist in a secure context.
 *
 * Browsers expose `getUserMedia` over HTTPS and on localhost, and nowhere
 * else. Self-hosting MUSE on a home server and opening it from a phone at
 * `http://192.168.1.42:3000` therefore fails – not because of a bug, and not
 * because permission was denied, but because the API is simply not there.
 *
 * The distinction matters: "no camera found" sends someone looking for a
 * hardware fault, when what they need is HTTPS.
 */

export function isSecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === true
}

export function hasMediaDevices(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.mediaDevices !== undefined &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  )
}

export type MediaAvailability =
  | { available: true }
  | { available: false; reason: "insecure-context" | "unsupported" }

/**
 * Whether camera and microphone can be reached at all – checked *before*
 * asking, so the answer can name the real cause.
 */
export function checkMediaAvailability(): MediaAvailability {
  if (hasMediaDevices()) return { available: true }
  if (!isSecureContext())
    return { available: false, reason: "insecure-context" }
  return { available: false, reason: "unsupported" }
}

/** Localization key describing why media is unavailable. */
export function mediaUnavailableKey(
  reason: "insecure-context" | "unsupported",
): string {
  return reason === "insecure-context"
    ? "media-needs-https"
    : "media-unsupported"
}

/**
 * The host as it would have to be reached for the browser to trust it.
 * Shown in the hint so the fix is a link away, not a search away.
 */
export function secureUrlSuggestion(): string | null {
  if (typeof window === "undefined") return null
  const { protocol, host } = window.location
  if (protocol === "https:") return null
  return `https://${host}${window.location.pathname}`
}

/**
 * Thrown before a `getUserMedia` call that cannot succeed, so callers can tell
 * "your browser will not let me ask" apart from "the user said no".
 */
export class MediaUnavailableError extends Error {
  reason: "insecure-context" | "unsupported"

  constructor(reason: "insecure-context" | "unsupported") {
    super(
      reason === "insecure-context"
        ? "camera and microphone require a secure context (HTTPS or localhost)"
        : "this browser has no getUserMedia",
    )
    this.name = "MediaUnavailableError"
    this.reason = reason
  }
}
