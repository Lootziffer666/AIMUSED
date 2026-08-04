import React, { useRef, useState, useCallback, useEffect } from "react"
import { HandTracker } from "./HandTracker"
import { useHandTracking } from "../hooks/useHandTracking"
import { HandData, GRADES, ChordGrade } from "../types"
import "../styles.css"

// ─── Sub-components ─────────────────────────────────────────────

const Meter: React.FC<{ label: string; value: number; max?: number }> = ({
  label,
  value,
  max = 4,
}) => (
  <div className="gl-meter">
    <span style={{ fontSize: 9, color: "var(--gl-text-dim)", marginRight: 4 }}>
      {label}
    </span>
    <div style={{ display: "flex", gap: 2 }}>
      {Array.from({ length: max }).map((_, i) => (
        <div key={i} className={`gl-meter-bar${i < value ? " active" : ""}`} />
      ))}
    </div>
  </div>
)

const GradeRow: React.FC<{
  grade: ChordGrade
  active: boolean
  onClick: () => void
}> = ({ grade, active, onClick }) => (
  <div className={`gl-grade-row${active ? " active" : ""}`} onClick={onClick}>
    <div className="gl-grade-num">{String(grade.num).padStart(2, "0")}</div>
    <div className="gl-grade-pose">
      {grade.pose.map((lit, i) => (
        <div key={i} className={`gl-pose-bar${lit ? " lit" : ""}`} />
      ))}
    </div>
    <div className="gl-grade-chord">{grade.degree}</div>
    <div style={{ textAlign: "right" }}>{grade.chord}</div>
  </div>
)

const StepRow: React.FC<{
  label: string
  steps: boolean[]
  onToggle: (i: number) => void
  currentStep?: number
}> = ({ label, steps, onToggle, currentStep = -1 }) => (
  <div className="gl-step-row">
    <div className="gl-step-label">{label}</div>
    <div className="gl-steps">
      {steps.map((on, i) => (
        <div
          key={i}
          className={`gl-step${on ? " on" : ""}${i === currentStep ? " current" : ""}`}
          onClick={() => onToggle(i)}
        />
      ))}
    </div>
  </div>
)

// ─── Main ───────────────────────────────────────────────────────

export const GestureLive: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [leftHand, setLeftHand] = useState<HandData | null>(null)
  const [rightHand, setRightHand] = useState<HandData | null>(null)
  const [activeGrade, setActiveGrade] = useState(0)
  const [is7th, setIs7th] = useState(false)
  const [palmFwd, setPalmFwd] = useState(true)
  const [rightMode, setRightMode] = useState<
    "drums" | "bass" | "melody" | "fx"
  >("drums")
  const [bar, setBar] = useState(42)
  const [isPlaying, setIsPlaying] = useState(true)
  const [wristRoll, setWristRoll] = useState(35)
  const [cutoff, setCutoff] = useState(42)
  const [noteLen, setNoteLen] = useState(60)

  // Drum patterns (16 steps)
  const [drums, setDrums] = useState([
    [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    [
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
    ],
    [
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
      true,
      false,
    ],
    [
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
    [
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
    ],
  ])

  const [currentStep, setCurrentStep] = useState(0)

  const handleResults = useCallback(
    (left: HandData | null, right: HandData | null) => {
      setLeftHand(left)
      setRightHand(right)

      // Simple gesture mapping: left hand Y position selects chord grade
      if (left) {
        const y = left.landmarks[9].y // middle finger MCP
        const idx = Math.min(6, Math.max(0, Math.floor(y * 7)))
        setActiveGrade(idx)
      }
    },
    [],
  )

  const { isReady, error } = useHandTracking({
    videoRef,
    onResults: handleResults,
    enabled: true,
  })

  // Transport loop
  useEffect(() => {
    if (!isPlaying) return
    const iv = setInterval(
      () => {
        setCurrentStep((s) => (s + 1) % 16)
        setBar((b) => b + (currentStep === 15 ? 1 : 0))
      },
      60000 / 122 / 4,
    ) // 16th notes at 122 BPM
    return () => clearInterval(iv)
  }, [isPlaying, currentStep])

  const grade = GRADES[activeGrade]
  const displayChord = is7th ? grade.chord + "7" : grade.chord
  const displayNotes = is7th ? grade.notes + " B4" : grade.notes

  const toggleDrum = (track: number, step: number) => {
    setDrums((prev) => {
      const next = prev.map((t) => [...t])
      next[track][step] = !next[track][step]
      return next
    })
  }

  const drumLabels = ["OPEN HATS", "16THS", "HATS", "CLAP", "KICK"]
  const modeTitles = {
    drums: "DRUM MACHINE",
    bass: "BASS",
    melody: "MELODY",
    fx: "FX / DJ",
  }

  return (
    <div className="gesture-live">
      {/* Hidden video element */}
      <video
        ref={videoRef}
        style={{
          position: "absolute",
          opacity: 0,
          pointerEvents: "none",
          width: 1,
          height: 1,
        }}
        playsInline
        muted
      />

      {/* TOP BAR */}
      <div className="gl-topbar">
        <div className="gl-topbar-left">
          <div className="gl-logo">
            <span className="gl-dot" />
            GESTURE.LIVE
          </div>
          <div style={{ color: "var(--gl-text-dim)" }}>
            BAR <span className="gl-bpm-display">{bar}</span> &nbsp; 2/4 &nbsp;{" "}
            {isPlaying ? "RUN" : "STOP"}
          </div>
          <Meter label="L.ROLL" value={leftHand ? 3 : 0} />
          <Meter label="R.ROLL" value={rightHand ? 2 : 0} />
          <Meter label="CUTOFF" value={Math.round(cutoff / 25)} />
          <Meter label="ENERGY" value={Math.round((wristRoll + cutoff) / 50)} />
        </div>
        <div className="gl-topbar-right">
          <div>A MINOR</div>
          <div>122 BPM</div>
          <div>SWING 66</div>
          <div>v1.0</div>
        </div>
      </div>

      {/* MAIN */}
      <div className="gl-main">
        {/* LEFT: CHORD PANEL */}
        <div className="gl-panel">
          <div className="gl-panel-title">
            L / CHORD INSTRUMENT
            <span className="gl-panel-sub">
              {palmFwd ? "PALM FWD" : "FLIPPED"}
            </span>
          </div>

          <div className="gl-grade-list">
            {GRADES.map((g, i) => (
              <GradeRow
                key={i}
                grade={g}
                active={i === activeGrade}
                onClick={() => setActiveGrade(i)}
              />
            ))}
          </div>

          <div className="gl-control-group">
            <div className="gl-control-label">Quality — Turn hand over</div>
            <div className="gl-control-btns">
              <button
                type="button"
                className={`gl-btn${palmFwd ? " active" : ""}`}
                onClick={() => setPalmFwd(true)}
              >
                palm {grade.degree.toLowerCase()}
              </button>
              <button
                type="button"
                className={`gl-btn${!palmFwd ? " active" : ""}`}
                onClick={() => setPalmFwd(false)}
              >
                back {grade.degree.toLowerCase()}
              </button>
            </div>
          </div>

          <div className="gl-control-group">
            <div className="gl-control-label">Root — Point fingers down</div>
            <div className="gl-control-btns">
              <button type="button" className="gl-btn active">
                up {grade.degree.toLowerCase()}
              </button>
              <button type="button" className="gl-btn">
                down {grade.degree.toLowerCase()}
              </button>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 4,
            }}
          >
            <div className="gl-control-label" style={{ margin: 0 }}>
              7TH
            </div>
            <button
              type="button"
              className={`gl-btn${is7th ? " active" : ""}`}
              style={{ width: 36, padding: "3px", fontSize: 9 }}
              onClick={() => setIs7th((v) => !v)}
            >
              {is7th ? "ON" : "OFF"}
            </button>
          </div>

          <div className="gl-slider-wrap">
            <div className="gl-slider-label">WRIST ROLL</div>
            <input
              type="range"
              className="gl-slider"
              min={0}
              max={100}
              value={wristRoll}
              onChange={(e) => setWristRoll(+e.target.value)}
            />
          </div>
          <div className="gl-slider-wrap">
            <div className="gl-slider-label">CUTOFF</div>
            <input
              type="range"
              className="gl-slider"
              min={0}
              max={100}
              value={cutoff}
              onChange={(e) => setCutoff(+e.target.value)}
            />
          </div>
          <div className="gl-slider-wrap">
            <div className="gl-slider-label">NOTE LEN</div>
            <input
              type="range"
              className="gl-slider"
              min={0}
              max={100}
              value={noteLen}
              onChange={(e) => setNoteLen(+e.target.value)}
            />
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "auto",
              paddingTop: 6,
              borderTop: "1px solid var(--gl-border)",
            }}
          >
            <div style={{ fontSize: 10, color: "var(--gl-text-dim)" }}>
              TRIAD
            </div>
            <div
              style={{
                width: 20,
                height: 10,
                border: "1px solid var(--gl-border)",
                borderRadius: 5,
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  right: 2,
                  top: 2,
                  bottom: 2,
                  width: 8,
                  background: "var(--gl-accent)",
                  borderRadius: 4,
                }}
              />
            </div>
            <div style={{ fontSize: 10, color: "var(--gl-accent)" }}>7TH</div>
          </div>
          <div
            style={{
              fontSize: 9,
              color: "var(--gl-text-dim)",
              textAlign: "center",
              marginTop: 2,
            }}
          >
            MASTER OUT
          </div>
        </div>

        {/* CENTER: CAMERA + HANDS */}
        <div className="gl-center">
          <div className="gl-camera-bg" />
          <div className="gl-grid-overlay" />

          {/* Wave Grid */}
          <div className="gl-wave-grid">
            <svg
              aria-hidden="true"
              viewBox="0 0 400 100"
              preserveAspectRatio="none"
            >
              <path
                d="M0,50 Q20,30 40,50 T80,50 T120,50 T160,50 T200,50 T240,50 T280,50 T320,50 T360,50 T400,50"
                fill="none"
                stroke="rgba(255,107,74,0.4)"
                strokeWidth={1}
              />
              <path
                d="M0,55 Q20,75 40,55 T80,55 T120,55 T160,55 T200,55 T240,55 T280,55 T320,55 T360,55 T400,55"
                fill="none"
                stroke="rgba(255,107,74,0.2)"
                strokeWidth={1}
              />
              <path
                d="M0,45 Q20,25 40,45 T80,45 T120,45 T160,45 T200,45 T240,45 T280,45 T320,45 T360,45 T400,45"
                fill="none"
                stroke="rgba(255,107,74,0.2)"
                strokeWidth={1}
              />
            </svg>
          </div>

          {/* Big Chord */}
          <div className="gl-chord-big">{displayChord}</div>
          <div className="gl-chord-notes">{displayNotes}</div>

          {/* Hand Skeleton Overlay */}
          <HandTracker
            videoRef={videoRef}
            leftHand={leftHand}
            rightHand={rightHand}
          />

          {/* Fallback hand visuals when tracking not ready */}
          {!isReady && (
            <>
              <div className="gl-hand-left">
                <svg
                  aria-hidden="true"
                  className="gl-hand-svg"
                  viewBox="0 0 100 120"
                >
                  <circle
                    cx="50"
                    cy="55"
                    r="3"
                    fill="none"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                  />
                  <line
                    x1="50"
                    y1="55"
                    x2="35"
                    y2="40"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                    opacity="0.6"
                  />
                  <line
                    x1="50"
                    y1="55"
                    x2="65"
                    y2="40"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                    opacity="0.6"
                  />
                  <line
                    x1="50"
                    y1="55"
                    x2="30"
                    y2="70"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                    opacity="0.6"
                  />
                  <line
                    x1="50"
                    y1="55"
                    x2="70"
                    y2="70"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                    opacity="0.6"
                  />
                  <line
                    x1="50"
                    y1="55"
                    x2="50"
                    y2="85"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                    opacity="0.6"
                  />
                  <circle
                    cx="35"
                    cy="40"
                    r="2.5"
                    fill="none"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                  />
                  <circle
                    cx="65"
                    cy="40"
                    r="2.5"
                    fill="none"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                  />
                  <circle
                    cx="30"
                    cy="70"
                    r="2.5"
                    fill="none"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                  />
                  <circle
                    cx="70"
                    cy="70"
                    r="2.5"
                    fill="none"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                  />
                  <circle
                    cx="50"
                    cy="85"
                    r="2.5"
                    fill="none"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                  />
                  <text
                    x="50"
                    y="105"
                    textAnchor="middle"
                    fill="var(--gl-text-dim)"
                    fontSize="8"
                  >
                    L
                  </text>
                </svg>
              </div>
              <div className="gl-hand-right">
                <svg
                  aria-hidden="true"
                  className="gl-hand-svg"
                  viewBox="0 0 100 120"
                >
                  <circle
                    cx="50"
                    cy="55"
                    r="3"
                    fill="none"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                  />
                  <line
                    x1="50"
                    y1="55"
                    x2="35"
                    y2="40"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                    opacity="0.6"
                  />
                  <line
                    x1="50"
                    y1="55"
                    x2="65"
                    y2="40"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                    opacity="0.6"
                  />
                  <line
                    x1="50"
                    y1="55"
                    x2="30"
                    y2="70"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                    opacity="0.6"
                  />
                  <line
                    x1="50"
                    y1="55"
                    x2="70"
                    y2="70"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                    opacity="0.6"
                  />
                  <line
                    x1="50"
                    y1="55"
                    x2="50"
                    y2="85"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                    opacity="0.6"
                  />
                  <circle
                    cx="35"
                    cy="40"
                    r="2.5"
                    fill="none"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                  />
                  <circle
                    cx="65"
                    cy="40"
                    r="2.5"
                    fill="none"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                  />
                  <circle
                    cx="30"
                    cy="70"
                    r="2.5"
                    fill="none"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                  />
                  <circle
                    cx="70"
                    cy="70"
                    r="2.5"
                    fill="none"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                  />
                  <circle
                    cx="50"
                    cy="85"
                    r="2.5"
                    fill="none"
                    stroke="var(--gl-accent)"
                    strokeWidth="1"
                  />
                  <text
                    x="50"
                    y="105"
                    textAnchor="middle"
                    fill="var(--gl-text-dim)"
                    fontSize="8"
                  >
                    R
                  </text>
                </svg>
              </div>
            </>
          )}

          {/* Status indicator */}
          {!isReady && (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%,-50%)",
                zIndex: 10,
                background: "rgba(10,10,15,0.9)",
                padding: "12px 20px",
                borderRadius: 8,
                border: "1px solid var(--gl-border)",
                fontSize: 12,
                textAlign: "center",
              }}
            >
              <div style={{ color: "var(--gl-accent)", marginBottom: 4 }}>
                {error ? "⚠ Camera Error" : "⌛ Initializing camera..."}
              </div>
              <div style={{ color: "var(--gl-text-dim)", fontSize: 10 }}>
                {error || "Please allow camera access"}
              </div>
            </div>
          )}

          {/* Bottom Bar */}
          <div className="gl-bottom-bar">
            {[
              "COUNT",
              "HAND",
              "MAJ",
              "FING",
              "FLAT",
              "HGT",
              "ROLL",
              "FIST",
            ].map((k, i) => (
              <div className="gl-bottom-param" key={k}>
                <span
                  style={{
                    color: i < 2 ? "var(--gl-accent)" : "var(--gl-text-dim)",
                    fontSize: 10,
                  }}
                >
                  {k}
                </span>
                <span>
                  {
                    [
                      "chord",
                      "over",
                      "min",
                      "down",
                      "—",
                      "spice",
                      "cutoff",
                      "cut",
                    ][i]
                  }
                </span>
              </div>
            ))}

            <div className="gl-scope">
              <svg
                aria-hidden="true"
                viewBox="0 0 200 30"
                preserveAspectRatio="none"
              >
                <path
                  d="M0,15 Q10,10 20,15 T40,12 T60,18 T80,14 T100,16 T120,13 T140,17 T160,14 T180,15 T200,15"
                  fill="none"
                  stroke="var(--gl-accent)"
                  strokeWidth="1"
                  opacity="0.7"
                />
              </svg>
            </div>
            <div style={{ fontSize: 9, color: "var(--gl-text-dim)" }}>
              CUTOFF
            </div>

            <div className="gl-scope">
              <svg
                aria-hidden="true"
                viewBox="0 0 200 30"
                preserveAspectRatio="none"
              >
                <path
                  d="M0,20 Q15,18 30,12 T60,22 T90,8 T120,20 T150,10 T180,18 T200,15"
                  fill="none"
                  stroke="var(--gl-accent)"
                  strokeWidth="1"
                  opacity="0.5"
                />
              </svg>
            </div>
            <div style={{ fontSize: 9, color: "var(--gl-text-dim)" }}>
              ENERGY
            </div>

            <div
              style={{
                marginLeft: "auto",
                fontSize: 9,
                color: "var(--gl-text-dim)",
              }}
            >
              KICK PICKUP
            </div>
          </div>
        </div>

        {/* RIGHT: MODULE PANEL */}
        <div
          className="gl-panel"
          style={{
            borderLeft: "1px solid var(--gl-border)",
            borderRight: "none",
          }}
        >
          <div className="gl-panel-title">
            R / {modeTitles[rightMode]}
            <span className="gl-panel-sub">
              {rightMode === "drums" ? "ALL BANKS" : "ACTIVE"}
            </span>
          </div>

          {/* Mode Selector */}
          <div className="gl-mode-sel">
            {(["drums", "bass", "melody", "fx"] as const).map((m) => (
              <button
                type="button"
                key={m}
                className={`gl-mode-btn${rightMode === m ? " active" : ""}`}
                onClick={() => setRightMode(m)}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>

          {/* DRUMS */}
          {rightMode === "drums" && (
            <div className="gl-right-module">
              {drums.map((track, ti) => (
                <StepRow
                  key={ti}
                  label={drumLabels[ti]}
                  steps={track}
                  currentStep={currentStep}
                  onToggle={(si) => toggleDrum(ti, si)}
                />
              ))}
            </div>
          )}

          {/* BASS */}
          {rightMode === "bass" && (
            <div className="gl-right-module">
              <StepRow
                label="OCTAVE"
                steps={[false, false, false, false, true, false, false, false]}
                onToggle={() => {}}
              />
              <StepRow
                label="OFFBEAT"
                steps={[false, true, false, true, false, true, false, true]}
                onToggle={() => {}}
              />
              <StepRow
                label="8THS"
                steps={[true, false, true, false, true, false, true, false]}
                onToggle={() => {}}
              />
              <StepRow
                label="SUB"
                steps={[true, false, false, false, true, false, false, false]}
                onToggle={() => {}}
              />
            </div>
          )}

          {/* MELODY */}
          {rightMode === "melody" && (
            <div className="gl-right-module">
              <div
                style={{
                  fontSize: 9,
                  color: "var(--gl-text-dim)",
                  marginBottom: 4,
                }}
              >
                PINCH → VOICE
              </div>
              {["SAW", "SQUARE", "FLUTE", "ACID"].map((v, i) => (
                <div className="gl-melody-voice" key={v}>
                  <span>{["INDEX", "MIDDLE", "RING", "PINKY"][i]}</span>
                  <span className={i === 0 ? "active" : ""}>{v}</span>
                </div>
              ))}
              <div
                style={{
                  marginTop: 6,
                  fontSize: 9,
                  color: "var(--gl-text-dim)",
                }}
              >
                NOTES: chord{" "}
                <span style={{ color: "var(--gl-accent)" }}>{grade.chord}</span>
              </div>
              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 20,
                    color: "var(--gl-accent)",
                    fontWeight: 500,
                  }}
                >
                  A5
                </div>
                <div
                  style={{
                    flex: 1,
                    height: 40,
                    borderLeft: "1px solid var(--gl-border)",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: "50%",
                      height: 1,
                      background: "var(--gl-border)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: -3,
                      top: "45%",
                      width: 6,
                      height: 6,
                      background: "var(--gl-accent)",
                      borderRadius: "50%",
                    }}
                  />
                </div>
              </div>
              <div className="gl-slider-wrap" style={{ marginTop: 8 }}>
                <div className="gl-slider-label">CUTOFF</div>
                <input
                  type="range"
                  className="gl-slider"
                  min={0}
                  max={100}
                  defaultValue={30}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 9,
                  color: "var(--gl-text-dim)",
                  marginTop: 4,
                }}
              >
                <span>SPACE</span>
                <span>ROOM</span>
              </div>
            </div>
          )}

          {/* FX/DJ */}
          {rightMode === "fx" && (
            <div className="gl-right-module">
              <div
                style={{
                  fontSize: 9,
                  color: "var(--gl-text-dim)",
                  marginBottom: 4,
                }}
              >
                PINCH → FX
              </div>
              {[
                "INDEX — LP ↔ HP FILTER",
                "MIDDLE — DELAY + VERB WASH",
                "RING — STUTTER GATE",
                "PINKY — BIT CRUSH",
                "FIST — CLEAR ALL FX",
              ].map((fx, i) => (
                <div className={`gl-fx-btn${i === 0 ? " active" : ""}`} key={i}>
                  {fx}
                </div>
              ))}
              <div
                style={{
                  marginTop: 8,
                  fontSize: 9,
                  color: "var(--gl-text-dim)",
                }}
              >
                CHOP RATE
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                {["1/4", "1/8", "1/16", "1/32"].map((r, i) => (
                  <button
                    type="button"
                    key={r}
                    className={`gl-btn${i === 1 ? " active" : ""}`}
                    style={{ flex: 1, fontSize: 9 }}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 9,
                  color: "var(--gl-text-dim)",
                }}
              >
                BIT CRUSH
              </div>
              <div
                style={{
                  height: 6,
                  background: "var(--gl-border)",
                  borderRadius: 3,
                  marginTop: 4,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: "35%",
                    height: "100%",
                    background: "var(--gl-accent)",
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: 9,
                  color: "var(--gl-text-dim)",
                  marginTop: 2,
                }}
              >
                8.2 bits
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
