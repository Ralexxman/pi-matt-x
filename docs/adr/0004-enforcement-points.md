# ADR-0004. The flow is enforced at two points: the SKILL.md read and the tool call

- Status: accepted
- Date: 2026-11-01

## Context

ADR-0002 chose hard blocking. Implementing it raised the question of *where* the guard
stands in the flow. A design that mirrored the flow with its own commands (`/flow
grill`, `/flow implement`) would have to re-enter every phase itself, and Pi only lets
a command handler start a new session (`newSession()` exists on
`ExtensionCommandContext`, not on the `ExtensionContext` a `tool_call` handler gets).

Reading Pi 1.4.0 also settled a second question: Pi already hides any skill with
`disable-model-invocation: true` from the model — `formatSkillsForPrompt` filters those
out, so 23 of the flow's 33 skills (including `grill-with-docs`, `implement`, `to-spec`,
`to-tickets`, `to-questionnaire`, `wayfinder`) can only be started by the user typing
`/skill:<name>`. The model cannot start them at all.

## Decision

A phase is entered the normal way — the model reads that skill's `SKILL.md` — and the
extension treats that read as the transition. There are exactly two enforcement points:

1. `tool_call` — the current phase's capability list decides whether a tool runs.
2. `read` of a `*/SKILL.md` — the current phase's exit list decides whether that skill
   may be entered. A declared `gate` question is asked here, through `ctx.ui.editor`,
   because this is the moment the flow moves on and the model cannot answer it.

No `/flow` commands, no mirrored state machine, no session creation. A skill with no
contract is unguarded, so unrelated skills keep working and the guard can ship with
eight contracts instead of thirty-three.

## Consequences

- The guard is a strict addition: with no contract for a phase, nothing is blocked.
- Headless runs (`json`/`print`, where `ctx.hasUI` is false) cannot ask the gate
  question, so the transition is allowed and announced instead of deadlocking.
- Project extensions only load in a trusted project (`docs/security.md`), so the guard
  is absent in an untrusted checkout.
- The phase lives in memory: `/reload` or resume starts unguarded until the next
  `SKILL.md` read. Accepted for now, recorded as a `shortcut:` in `index.ts`.
- A phase that should demand a failing command before touching code (`diagnosing-bugs`)
  cannot yet be expressed; the contract field for it does not exist.
