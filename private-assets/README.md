# Private reference material

This directory is **gitignored** (only this README is tracked). Put local
reference recordings and hand-reconstructed MIDI files here:

```
private-assets/
  curse-of-monkey-island/
    theme.flac      # original recording — never committed
    theme.mid       # hand-reconstructed MIDI — never committed
    pair.json       # paired-source manifest — may be committed if you want
```

Register a pair (from the repository root):

```bash
node --experimental-strip-types packages/tonemap-core/src/cli/main.ts pair \
  --id coMI-theme \
  --midi private-assets/curse-of-monkey-island/theme.mid \
  --audio private-assets/curse-of-monkey-island/theme.flac \
  --out private-assets/curse-of-monkey-island/pair.json
```

`validate` warns whenever a referenced file lives outside the private
directories (`private-assets/`, `reference-audio/`, `reference-midi/`,
`analysis-cache/`, `render-cache/`) unless the manifest explicitly marks the
material as redistributable.

Note: only a WAV decoder ships with MUSE. For FLAC/MP3/OGG either convert the
file locally or register a decoder — see `docs/tonemap/workflows.md`.
