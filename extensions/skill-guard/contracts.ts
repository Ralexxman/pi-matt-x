/**
 * What each phase of the Matt Pocock skill flow is allowed to do.
 *
 * One contract per skill that needs one. A skill with no contract is readable from
 * any phase and adds no rule of its own, but it does not lift the open phase either
 * — only a contract, or the user naming one, moves the flow.
 *
 * `quote` fields are copied verbatim from the skill's own SKILL.md and are checked
 * against the installed skills by contracts.test.ts. Edit a quote only together
 * with the skill it came from.
 */

export type Grant = "read" | "write" | "bash";

/**
 * How a phase is proved finished. `user` is a question only a person can answer;
 * `command` is the tracker's own output, which the model can neither fake nor skip.
 */
export type Gate =
	| { kind: "user"; quote: string; question: string; source?: string }
	| { kind: "command"; must: string; hint: string };

/**
 * Skills the flow runs *inside* another phase rather than moving to it. Entering one
 * is not a phase boundary: the open phase, its grants and its gate question stay as
 * they are.
 */
export const SUB_SKILLS: ReadonlySet<string> = new Set(["grilling", "domain-modeling"]);

export interface Contract {
	/** Skill name: the directory name of its SKILL.md. */
	name: string;
	/** Tools the model may call while this phase is open. */
	grants: Grant[];
	/** Skills the flow may move to from here. */
	successors: string[];
	/**
	 * The phase works on an external object (a spec), so entering it asks for the spec and
	 * no file changes until the user names one.
	 */
	needsSpec?: boolean;
	/**
	 * End condition of the phase, asked of the user before moving on. `quote` is the
	 * skill's own wording of what "done" means, shown as evidence; `source` names the
	 * skill whose SKILL.md holds that wording when it is not this one.
	 */
	gate?: Gate;
}

export const CONTRACTS: readonly Contract[] = [
	{
		name: "grilling",
		// Reads code to answer its own questions; writes nothing.
		grants: ["read"],
		successors: ["grill-me", "grill-with-docs", "domain-modeling"],
		gate: {
			kind: "user",
			quote: "The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed.",
			question: "Интервью закончено? Что осталось нерешённым?",
		},
	},
	{
		// Stateless interview: no repo under it, so no writes at all.
		name: "grill-me",
		grants: ["read"],
		successors: ["grilling", "grill-with-docs", "to-spec", "to-tickets", "implement"],
		gate: {
			// grill-me delegates the interview itself (`grill-me/SKILL.md:7`), so the end
			// condition is grilling's.
			kind: "user",
			source: "grilling",
			quote: "The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed.",
			question: "План выяснен? Что осталось нерешённым?",
		},
	},
	{
		// Runs the same interview as grill-me but leaves a paper trail: docs only,
		// so all write tools are granted.
		name: "grill-with-docs",
		grants: ["read", "write"],
		// `grilling` is not a next phase but the interview this one runs: the skill
		// says to call it. Listed first so it reads as the step it is.
		successors: ["grilling", "to-spec", "domain-modeling", "prototype"],
		gate: {
			kind: "user",
			source: "grilling",
			quote: "The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed.",
			question: "GLOSSARY.md и ADR записаны, решения приняты? Пора в спеку?",
		},
	},
	{
		name: "to-spec",
		grants: ["read", "bash"],
		successors: ["to-tickets"],
		gate: {
			kind: "user",
			quote: "Check with the user that these seams match their expectations.",
			question: "Швы (seams) в спеке проверены с тобой и совпадают с ожиданиями?",
		},
	},
	{
		// Writes one file per ticket under `.scratch/<feature>/issues/`.
		name: "to-tickets",
		grants: ["read", "write", "bash"],
		successors: ["implement", "implement-spec"],
		gate: {
			kind: "user",
			quote: "Each slice is sized to fit in a single fresh context window",
			question: "Тикеты нарезаны так, что каждый влезает в свежее окно?",
		},
	},
	{
		name: "implement",
		grants: ["read", "write", "bash"],
		successors: ["tdd", "code-review", "diagnosing-bugs", "retro", "pr", "handoff"],
	},
	{
		name: "implement-spec",
		grants: ["read", "write", "bash"],
		// Nine steps against one spec: without the spec there is nothing to close.
		needsSpec: true,
		successors: ["tdd", "code-review", "diagnosing-bugs", "retro", "pr", "handoff"],
		// The one gate a model cannot talk its way through: no open children under the spec
		// map, as the tracker reports them. `gh issue list --state open` prints 0 when done,
		// `gh issue view <n> --json state -q .state` prints CLOSED.
		gate: {
			kind: "command",
			must: "^(0|CLOSED|closed|DONE|done)$",
			hint: "прогони проверку спеки (gh: открытые под-тикеты → 0, или state → CLOSED) и покажи вывод",
		},
	},
	{
		name: "tdd",
		grants: ["read", "write", "bash"],
		successors: ["code-review"],
	},
	{
		// Reports, not fixes — but `bash` is a whole shell, so this phase can still write
		// through it. Narrowing that needs a command allowlist, not a grant (D14).
		name: "code-review",
		grants: ["read", "bash"],
		successors: ["retro", "pr", "handoff", "implement"],
	},
	{
		// Fixes the bug, so it writes; entered only once the flow reached it.
		name: "diagnosing-bugs",
		grants: ["read", "write", "bash"],
		successors: ["tdd", "code-review", "retro"],
	},
	{
		name: "prototype",
		grants: ["read", "write", "bash"],
		successors: ["grill-with-docs", "to-spec", "implement"],
	},
];
