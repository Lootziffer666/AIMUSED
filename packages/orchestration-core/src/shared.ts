/**
 * Narrow, dependency-free entry point exposing only the small leaf utilities
 * (id generation, seeded PRNG, base64 helpers) that `@signal-app/midi-project`
 * needs at runtime.
 *
 * `@signal-app/midi-project` is itself a dependency of this package's main
 * entry point (`.`) — `orchestration/render-project.ts` and
 * `commands/reducer.ts` import real MIDI-file functionality from it. If
 * midi-project imported these leaf helpers from the main "." entry point
 * instead, loading either package would transitively require loading the
 * other package's full barrel, forming a genuine runtime ESM import cycle.
 * Importing from this subpath instead keeps the dependency graph
 * one-directional: orchestration-core (".") -> midi-project (".") ->
 * orchestration-core ("/shared", which has no further dependencies).
 */
export * from "./id";
export * from "./seed-random";
export * from "./bytes";
