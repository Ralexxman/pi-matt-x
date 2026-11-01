/**
 * What each phase of the Matt Pocock skill flow is allowed to do.
 *
 * One contract per skill that needs one. A skill with no contract is unguarded:
 * every tool is allowed and it can be entered from anywhere, so unknown or
 * unrelated skills keep working.
 *
 * `quote` fields are copied verbatim from the skill's own SKILL.md and are checked
 * against the installed skills by contracts.test.ts. Edit a quote only together
 * with the skill it came from.
 */

export type Grant = "read" | "write" | "edit" | "bash";

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
	 * End condition of the phase, asked of the user before moving on. `quote` is the
	 * skill's own wording of what "done" means, shown as evidence; `source` names the
	 * skill whose SKILL.md holds that wording when it is not this one.
	 */
	gate?: { quote: string; question: string; source?: string };
}

export const CONTRACTS: readonly Contract[] = [
	{
		name: "grilling",
		// Reads code to answer its own questions; writes nothing.
		grants: ["read"],
		successors: ["grill-me", "grill-with-docs", "domain-modeling"],
		gate: {
			quote: "Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet.",
			question: "Интервью закончено? Что осталось нерешённым?",
		},
	},
	{
		// Stateless interview: no repo under it, so no writes at all.
		name: "grill-me",
		grants: ["read"],
		successors: ["grilling", "grill-with-docs", "to-spec", "to-tickets", "implement"],
		gate: {
			// grill-me inherits its own process from the router's description of it.
			source: "ask-matt",
			quote: "the same relentless interview as `/grill-with-docs`, but **stateless**: it saves nothing locally and builds no `GLOSSARY.md`.",
			question: "План выяснен? Что осталось нерешённым?",
		},
	},
	{
		// Runs the same interview as grill-me but leaves a paper trail: docs only,
		// so all write tools are granted.
		name: "grill-with-docs",
		grants: ["read", "write", "edit"],
		// `grilling` is not a next phase but the interview this one runs: the skill
		// says to call it. Listed first so it reads as the step it is.
		successors: ["grilling", "to-spec", "domain-modeling", "prototype"],
		gate: {
			quote: 'Skill tool twice, for "grilling" and "domain-modeling"',
			question: "GLOSSARY.md и ADR записаны, решения приняты? Пора в спеку?",
		},
	},
	{
		name: "to-spec",
		grants: ["read", "bash"],
		successors: ["to-tickets"],
		gate: {
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
			quote: "Each slice is sized to fit in a single fresh context window",
			question: "Тикеты нарезаны так, что каждый влезает в свежее окно?",
		},
	},
	{
		name: "implement",
		grants: ["read", "write", "edit", "bash"],
		successors: ["tdd", "code-review", "diagnosing-bugs", "retro", "pr", "handoff"],
	},
	{
		name: "implement-spec",
		grants: ["read", "write", "edit", "bash"],
		successors: ["tdd", "code-review", "diagnosing-bugs", "retro", "pr", "handoff"],
	},
	{
		name: "tdd",
		grants: ["read", "write", "edit", "bash"],
		successors: ["code-review"],
	},
	{
		// Read-only on purpose: review reports, it does not fix.
		name: "code-review",
		grants: ["read", "bash"],
		successors: ["retro", "pr", "handoff", "implement"],
	},
	{
		// Fixes the bug, so it writes; entered only once the flow reached it.
		name: "diagnosing-bugs",
		grants: ["read", "write", "edit", "bash"],
		successors: ["tdd", "code-review", "retro"],
	},
	{
		name: "prototype",
		grants: ["read", "write", "edit", "bash"],
		successors: ["grill-with-docs", "to-spec", "implement"],
	},
];
