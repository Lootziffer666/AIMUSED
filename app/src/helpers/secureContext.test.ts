import { afterEach, describe, expect, it, vi } from "vitest"
import {
  checkMediaAvailability,
  hasMediaDevices,
  isSecureContext,
  MediaUnavailableError,
  mediaUnavailableKey,
  secureUrlSuggestion,
} from "./secureContext"

/**
 * The distinction this file exists for: "the browser will not let me ask" is
 * not the same failure as "the user said no", and only the first one is fixed
 * by putting the server behind HTTPS.
 */

const originalDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "isSecureContext",
)

function setSecureContext(value: boolean) {
  Object.defineProperty(window, "isSecureContext", {
    value,
    configurable: true,
  })
}

function setMediaDevices(value: unknown) {
  Object.defineProperty(navigator, "mediaDevices", {
    value,
    configurable: true,
  })
}

afterEach(() => {
  if (originalDescriptor) {
    Object.defineProperty(window, "isSecureContext", originalDescriptor)
  }
  vi.unstubAllGlobals()
})

describe("checkMediaAvailability", () => {
  it("is available when getUserMedia exists", () => {
    setMediaDevices({ getUserMedia: () => {} })
    expect(hasMediaDevices()).toBe(true)
    expect(checkMediaAvailability()).toEqual({ available: true })
  })

  it("blames the insecure context, not the hardware", () => {
    setMediaDevices(undefined)
    setSecureContext(false)
    expect(isSecureContext()).toBe(false)
    expect(checkMediaAvailability()).toEqual({
      available: false,
      reason: "insecure-context",
    })
  })

  it("blames the browser when the context is already secure", () => {
    setMediaDevices(undefined)
    setSecureContext(true)
    expect(checkMediaAvailability()).toEqual({
      available: false,
      reason: "unsupported",
    })
  })
})

describe("mediaUnavailableKey", () => {
  it("points at HTTPS for an insecure context", () => {
    expect(mediaUnavailableKey("insecure-context")).toBe("media-needs-https")
    expect(mediaUnavailableKey("unsupported")).toBe("media-unsupported")
  })
})

describe("MediaUnavailableError", () => {
  it("keeps the reason so callers can localize it", () => {
    const error = new MediaUnavailableError("insecure-context")
    expect(error).toBeInstanceOf(Error)
    expect(error.reason).toBe("insecure-context")
    expect(error.message).toContain("HTTPS")
  })
})

describe("secureUrlSuggestion", () => {
  it("offers the https twin of the current address", () => {
    expect(secureUrlSuggestion()).toMatch(/^https:\/\//)
  })
})
