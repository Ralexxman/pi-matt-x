# ADR-0005. Two things the guard cannot decide, so it asks the user

- Status: accepted
- Date: 2026-11-01

## Context

ADR-0004 put the guard at two points: the `SKILL.md` read and the `tool_call`. The first
audit of the implementation showed both points can be walked past in ways that are not
bugs but genuine gaps in knowledge:

1. **A skill with no contract.** `research`, `teach`, `wait-what`, `retro` — the flow has
   no opinion about them. Reading one used to *replace* the open phase, so any such read
   lifted every restriction. That made the whole guard one careless `read` away from
   doing nothing.
2. **A tool this extension has never seen.** `grantFor()` maps Pi's builtins and the
   shell wrappers; an MCP server or a new extension brings a tool it cannot place.
   Allowing it silently is a hole in a phase that denies `bash` — denying it silently
   blocks a legitimate read tool with no recourse.

## Decision

- An uncontracted skill is **readable from anywhere and changes nothing**: the open phase
  and its restrictions stay. Only the user moves the flow, by naming a phase
  (`/skill:name`).
- An unknown tool in a phase that denies `bash` is **the user's call**: `ctx.ui.confirm`
  asks once, the answer is remembered for the pair "phase:tool" until the phase changes.
  Without a UI (headless runs) the call is blocked with a reason — a permission that
  cannot be asked for is not granted.

## Consequences

- The guard no longer fails open on a stray read or an unplaced tool.
- Unknown tools in `implement`, `tdd`, `diagnosing-bugs`, `prototype` go through
  untouched: those phases already grant `bash`, so there is nothing to protect.
- A user who wants an unrelated task mid-phase must name a phase; the model cannot
  declare the flow over.
- The permission memory is per phase and per session, like the phase itself.
