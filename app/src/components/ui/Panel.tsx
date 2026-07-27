import styled from "@emotion/styled"

/**
 * Surfaces shared by the MUSE workspaces (pattern editor, jam room, tone map).
 *
 * They are deliberately thin: the same tokens, radii and type scale the rest
 * of Signal uses, just named once instead of repeated in every view.
 */

/** Full-height workspace root – sits between the navigation and the transport. */
export const Workspace = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: var(--color-editor-background);
`

/** Toolbar-height header row. Mirrors `Toolbar` but wraps on narrow windows. */
export const WorkspaceHeader = styled.header`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem 1rem;
  min-height: 3rem;
  box-sizing: border-box;
  flex-shrink: 0;
  background: var(--color-background);
  border-bottom: 1px solid var(--color-divider);
`

export const WorkspaceTitle = styled.h1`
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--color-text);
`

export const WorkspaceSubtitle = styled.p`
  margin: 0.1rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-secondary);
`

export const Spacer = styled.div`
  flex-grow: 1;
`

export const Panel = styled.section`
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-divider);
  border-radius: 0.5rem;
  background: var(--color-background);
  overflow: hidden;
`

export const PanelHeader = styled.header`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--color-divider);
`

export const PanelTitle = styled.h2`
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-text);
`

export const PanelBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  min-height: 0;
  overflow-y: auto;
`

/** Secondary text: units, counts, provenance. */
export const Meta = styled.div`
  font-size: 0.7rem;
  color: var(--color-text-secondary);
`

/** Labelled control group in a header row, e.g. "Steps [16]". */
export const FieldGroup = styled.label`
  display: flex;
  align-items: center;
  gap: 0.4rem;
  height: 2rem;
  padding: 0 0.5rem;
  border-radius: 0.2rem;
  background: var(--color-background-dark);
  font-size: 0.7rem;
  color: var(--color-text-secondary);
  flex-shrink: 0;
`

export const NumberField = styled.input`
  width: 3.2rem;
  height: 1.5rem;
  box-sizing: border-box;
  padding: 0 0.3rem;
  border: 1px solid var(--color-divider);
  border-radius: 0.2rem;
  background: var(--color-background);
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  text-align: center;
  outline: none;

  &:focus {
    border-color: var(--color-theme);
  }
`

/** Toolbar-sized select. `ui/Select` is the dialog-sized one. */
export const InlineSelect = styled.select`
  height: 1.5rem;
  padding: 0 0.3rem;
  border: 1px solid var(--color-divider);
  border-radius: 0.2rem;
  background: var(--color-background);
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.7rem;
  outline: none;
  cursor: pointer;

  &:focus {
    border-color: var(--color-theme);
  }

  option {
    color: var(--color-text);
    background: var(--color-background);
  }
`

/** Toolbar-sized text input. `ui/TextField` is the dialog-sized one. */
export const InlineInput = styled.input`
  height: 2rem;
  box-sizing: border-box;
  padding: 0 0.5rem;
  border: 1px solid transparent;
  border-radius: 0.2rem;
  background: var(--color-background-dark);
  color: var(--color-text);
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  outline: none;

  &:focus {
    border-color: var(--color-theme);
  }
`

/**
 * Small state toggle. `data-selected` follows the same convention as
 * `ToolbarButton` and `TrackListItem`, so selected states look alike
 * everywhere.
 */
export const Chip = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: 1.4rem;
  padding: 0 0.5rem;
  border: 1px solid var(--color-divider);
  border-radius: 999px;
  background: transparent;
  color: var(--color-text-secondary);
  font-family: inherit;
  font-size: 0.7rem;
  cursor: pointer;
  outline: none;

  &:hover {
    background: var(--color-highlight);
  }

  &[data-selected="true"] {
    border-color: var(--color-theme);
    background: var(--color-theme);
    color: var(--color-on-surface);
  }

  &[data-tone="danger"][data-selected="true"] {
    border-color: var(--color-red);
    background: var(--color-red);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`

/**
 * Confidence badge. Low confidence has to stay visible – it is coloured, not
 * hidden, and always shows the number it is based on.
 */
export const ConfidenceBadge = styled.span`
  display: inline-flex;
  align-items: center;
  height: 1.2rem;
  padding: 0 0.4rem;
  border-radius: 0.2rem;
  font-family: var(--font-mono);
  font-size: 0.65rem;
  color: var(--color-on-surface);
  background: var(--color-text-tertiary);
  white-space: nowrap;

  &[data-level="high"] {
    background: var(--color-green);
    color: var(--color-background-dark);
  }

  &[data-level="medium"] {
    background: var(--color-yellow);
    color: var(--color-background-dark);
  }

  &[data-level="low"] {
    background: var(--color-red);
  }
`

export const EmptyState = styled.div`
  padding: 2rem 1rem;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  line-height: 1.7;
  text-align: center;
`
