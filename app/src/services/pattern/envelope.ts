import type {
  MuseBezierEnvelope,
  MuseEnvelopePoint,
  MuseEnvelopePreset,
} from "../../entities/pattern/MusePattern"

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

const PRESET_POINTS: Record<
  Exclude<MuseEnvelopePreset, "custom">,
  { points: MuseEnvelopePoint[]; curve: number }
> = {
  direct: {
    points: [
      { t: 0, v: 1 },
      { t: 1, v: 1 },
    ],
    curve: 0,
  },
  "fade-in": {
    points: [
      { t: 0, v: 0 },
      { t: 1, v: 1 },
    ],
    curve: 0.35,
  },
  "fade-out": {
    points: [
      { t: 0, v: 1 },
      { t: 1, v: 0 },
    ],
    curve: 0.35,
  },
  swell: {
    points: [
      { t: 0, v: 0.15 },
      { t: 0.65, v: 1 },
      { t: 1, v: 0.85 },
    ],
    curve: 0.3,
  },
  decay: {
    points: [
      { t: 0, v: 1 },
      { t: 0.35, v: 0.55 },
      { t: 1, v: 0.15 },
    ],
    curve: -0.3,
  },
  accent: {
    points: [
      { t: 0, v: 0.55 },
      { t: 0.12, v: 1 },
      { t: 0.5, v: 0.6 },
      { t: 1, v: 0.75 },
    ],
    curve: 0,
  },
}

export const ENVELOPE_PRESETS: Exclude<MuseEnvelopePreset, "custom">[] = [
  "direct",
  "fade-in",
  "fade-out",
  "swell",
  "decay",
  "accent",
]

/** Localization key per preset – the UI resolves them, the service does not. */
export const PRESET_LABEL_KEYS = {
  direct: "pattern-preset-direct",
  "fade-in": "pattern-preset-fade-in",
  "fade-out": "pattern-preset-fade-out",
  swell: "pattern-preset-swell",
  decay: "pattern-preset-decay",
  accent: "pattern-preset-accent",
  custom: "pattern-preset-custom",
} as const satisfies Record<MuseEnvelopePreset, string>

export function createEnvelope(
  preset: Exclude<MuseEnvelopePreset, "custom"> = "direct",
): MuseBezierEnvelope {
  const spec = PRESET_POINTS[preset]
  return {
    preset,
    curve: spec.curve,
    points: spec.points.map((p) => ({ ...p })),
  }
}

/** Envelopes are normalized, so an envelope is always valid for any duration. */
export function normalizeEnvelope(
  envelope: MuseBezierEnvelope,
): MuseBezierEnvelope {
  const points = envelope.points
    .map((p) => ({ t: clamp01(p.t), v: clamp01(p.v) }))
    .sort((a, b) => a.t - b.t)
  const withEdges: MuseEnvelopePoint[] =
    points.length === 0 ? [{ t: 0, v: 1 }] : points
  if (withEdges[0].t > 0) withEdges.unshift({ t: 0, v: withEdges[0].v })
  const last = withEdges[withEdges.length - 1]
  if (last.t < 1) withEdges.push({ t: 1, v: last.v })
  return {
    preset: envelope.preset,
    curve: Math.min(1, Math.max(-1, envelope.curve)),
    points: withEdges,
  }
}

/**
 * Samples the envelope at a normalized position. Between two anchors the
 * `curve` value bends the interpolation like the single control point of a
 * quadratic bezier: 0 is linear, positive eases out, negative eases in.
 */
export function sampleEnvelope(
  envelope: MuseBezierEnvelope,
  t: number,
): number {
  const env = normalizeEnvelope(envelope)
  const pos = clamp01(t)
  const pts = env.points
  if (pts.length === 1) return pts[0].v

  let i = 0
  while (i < pts.length - 2 && pts[i + 1].t <= pos) i++
  const a = pts[i]
  const b = pts[i + 1]
  const span = b.t - a.t
  const local = span <= 0 ? 0 : (pos - a.t) / span

  // Quadratic bezier with a control point derived from `curve`
  const control = 0.5 + env.curve * 0.5
  const shaped =
    (1 - local) * (1 - local) * 0 +
    2 * (1 - local) * local * control +
    local * local
  return clamp01(a.v + (b.v - a.v) * shaped)
}

/** Even sampling used by playback scheduling and by the drawer's preview path. */
export function sampleEnvelopeCurve(
  envelope: MuseBezierEnvelope,
  steps: number,
): MuseEnvelopePoint[] {
  const count = Math.max(2, Math.round(steps))
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1)
    return { t, v: sampleEnvelope(envelope, t) }
  })
}

/** Moves a single anchor point; the result stays normalized and ordered. */
export function moveEnvelopePoint(
  envelope: MuseBezierEnvelope,
  index: number,
  t: number,
  v: number,
): MuseBezierEnvelope {
  const points = envelope.points.map((p, i) =>
    i === index ? { t: clamp01(t), v: clamp01(v) } : { ...p },
  )
  // The outer anchors keep their position in time so the event stays covered
  if (index === 0) points[0].t = 0
  if (index === points.length - 1) points[points.length - 1].t = 1
  return normalizeEnvelope({ ...envelope, preset: "custom", points })
}

export function setEnvelopeCurve(
  envelope: MuseBezierEnvelope,
  curve: number,
): MuseBezierEnvelope {
  return normalizeEnvelope({
    ...envelope,
    preset: "custom",
    curve: Math.min(1, Math.max(-1, curve)),
  })
}

/**
 * Peak value of the envelope – used where only one scalar can be applied
 * (drum one-shots, velocity scaling).
 */
export function envelopePeak(envelope: MuseBezierEnvelope): number {
  return sampleEnvelopeCurve(envelope, 17).reduce((m, p) => Math.max(m, p.v), 0)
}
