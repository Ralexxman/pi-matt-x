# AGENTS.md

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, driven by the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map 1:1 to the same label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Dev loop

`pi` runs the installed clone, not this working tree: `git:github.com/Ralexxman/pi-matt-x` → `C:\Users\ralex\.pi\agent\git\github.com\Ralexxman\pi-matt-x`. A change is live only after commit → push → `pi update --extensions` → `/reload`.

## Read before edit

`edit` needs a prior `read` of the same file in this conversation; `ctx_read` does not satisfy it.
