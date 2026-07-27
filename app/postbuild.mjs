import { copyFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"

/**
 * The app is built from `edit.html`, which means a plain web server has
 * nothing to serve at `/`. Self-hosting should not require a rewrite rule for
 * that, so the entry is copied to `index.html` – every static server picks
 * that up on its own.
 */
const dist = resolve(import.meta.dirname, "dist")
const entry = resolve(dist, "edit.html")

if (!existsSync(entry)) {
  console.error("postbuild: dist/edit.html is missing, was the build run?")
  process.exit(1)
}

copyFileSync(entry, resolve(dist, "index.html"))
console.log("postbuild: dist/index.html written from edit.html")
