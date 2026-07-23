import { TrackId } from "@signal-app/core"
import { render } from "@testing-library/react"
import { screen } from "@testing-library/dom"
import { vi } from "vitest"
import { TickTransform } from "../../entities/transform/TickTransform"
import { InstrumentMark } from "./InstrumentMark"

const trackOrchestrationOriginMock = vi.fn()

vi.mock("../../hooks/usePianoRoll", () => ({
  usePianoRoll: () => ({ selectedTrackId: 1 as TrackId }),
}))
vi.mock("../../hooks/useTrack", () => ({
  useTrack: () => ({ removeEvent: vi.fn(), updateEvent: vi.fn() }),
}))
vi.mock("../../hooks/useHistory", () => ({
  useHistory: () => ({ pushHistory: vi.fn() }),
}))
vi.mock("../../hooks/useQuantizer", () => ({
  useQuantizer: () => ({ quantizeRound: (tick: number) => tick }),
}))
vi.mock("../../hooks/useOrchestration", () => ({
  useTrackOrchestrationOrigin: () => trackOrchestrationOriginMock(),
}))
// InstrumentBrowser pulls in its own store-dependent hooks; it's irrelevant
// to the badge behavior under test here, so it's stubbed out entirely.
vi.mock("../InstrumentBrowser/InstrumentBrowser", () => ({
  InstrumentBrowser: () => null,
}))

function buildEvent(programNumber: number) {
  return {
    id: 1,
    type: "channel" as const,
    subtype: "programChange" as const,
    tick: 0,
    value: programNumber,
  }
}

const transform = new TickTransform(1)

describe("InstrumentMark origin badge", () => {
  beforeEach(() => {
    trackOrchestrationOriginMock.mockReset()
  })

  it("renders no badge when the track has no orchestration decision", () => {
    trackOrchestrationOriginMock.mockReturnValue(undefined)

    render(<InstrumentMark event={buildEvent(0)} transform={transform} />)

    expect(screen.queryByText("R")).not.toBeInTheDocument()
    expect(screen.queryByText("A")).not.toBeInTheDocument()
  })

  it("renders the recipe badge when the track's instrument assignment came from a recipe", () => {
    trackOrchestrationOriginMock.mockReturnValue({
      origin: "recipe",
      reason: "Cinematic Adventure recipe prefers strings for melody.",
      role: "melody",
    })

    render(<InstrumentMark event={buildEvent(0)} transform={transform} />)

    expect(screen.getByText("R")).toBeInTheDocument()
  })

  it("renders the agent badge with its abbreviated label", () => {
    trackOrchestrationOriginMock.mockReturnValue({
      origin: "agent",
      reason: "Assigned by an automation agent.",
      role: "bass",
    })

    render(<InstrumentMark event={buildEvent(0)} transform={transform} />)

    expect(screen.getByText("Ag")).toBeInTheDocument()
  })
})
