/**
 * The whole decision logic. Pure: no filesystem, no UI, no Pi. index.ts wires it up.
 */
import { SUB_SKILLS, type Contract, type Gate, type Grant } from "./contracts.ts";

export interface GuardState {
	/** Skill currently open, or null before the flow starts. */
	phase: string | null;
	/** Phases whose end-condition question the user already answered yes. */
	gatesPassed: string[];
	/**
	 * The spec the open phase works on. A phase whose contract asks for it cannot change
	 * files without one: the work would have nowhere to land, and nothing to close.
	 */
	spec?: { ref: string };
	/** Open tickets the tracker last reported, so the block can say how much is left. */
	tickets?: number;
}

export type Request =
	| { kind: "tool"; tool: string; }
	| { kind: "skill"; name: string; };

export type Decision =
	| { allow: true; phase: string | null; }
	| { allow: false; reason: string; };

/**
 * Tools that only read. Taken from the live tool list of this install (pi-lean-ctx
 * extensions/index.ts, pi-lens dist, llm-wiki): a name missing here is not dangerous,
 * it just costs one permission question inside a read-only phase.
 */
const READ_ONLY_TOOLS = new Set([
	"read", "grep", "find", "ls",
	"ctx_read", "ctx_grep", "ctx_find", "ctx_ls", "ctx_tree", "ctx_overview",
	"ctx_search", "ctx_semantic_search", "ctx_graph", "ctx_expand", "lens_diagnostics",
	"symbol_search", "read_symbol", "read_enclosing", "module_report", "project_report",
	"ast_grep_search", "ast_grep_outline", "lsp_navigation",
	"wiki_search", "wiki_recall", "wiki_status",
]);

/** Every tool that runs a command, a CLI or an agent that has tools of its own. */
const EXEC_TOOLS = new Set([
	"bash", "powershell", "pwsh", "shell", "ctx_shell",
	"lean_ctx", "ctx_call", "codemode", "subagent", "workflow",
]);

/** Every tool that changes a file. */
const EDIT_TOOLS = new Set(["edit", "write", "ctx_edit", "ast_grep_replace"]);

/**
 * Pi tool name → the capability it needs. A tool this guard does not know maps to null:
 * allowed when no phase is open; inside one, `needsPermission` asks the user — except in a
 * phase that grants `bash`, where the tool could do nothing the phase cannot already do.
 */
export function grantFor(tool: string): Grant | null {
	if (READ_ONLY_TOOLS.has(tool)) return "read";
	if (EDIT_TOOLS.has(tool)) return "write";
	// Anything that can run arbitrary code or spawn an agent that can is `bash` — otherwise
	// a denied `bash` would be one tool name away from being bypassed.
	if (EXEC_TOOLS.has(tool)) return "bash";
	return null;
}

export function contractOf(contracts: readonly Contract[], name: string | null): Contract | undefined {
	if (!name) return undefined;
	return contracts.find((c) => c.name === name);
}

/**
 * Skill name of a `SKILL.md` path, or null for any other file. `/skill:<name>` mentions
 * are not paths: `index.ts` reads them from the input event, not through here.
 */
export function skillNameFromPath(path: string): string | null {
	const m = /(?:^|[\\/])([^\\/]+)[\\/]SKILL\.md$/i.exec(path.trim());
	return m ? m[1] : null;
}

function blocked(reason: string): Decision {
	return { allow: false, reason };
}

/** The gate of the phase being entered has to be answered before the move. */
export function needsGate(contracts: readonly Contract[], state: GuardState): Gate | undefined {
	const c = contractOf(contracts, state.phase);
	if (!c?.gate) return undefined;
	return state.gatesPassed.includes(c.name) ? undefined : c.gate;
}

/**
 * A `command` gate is closed by the runner's own output, not by the model's word: the
 * tool ran successfully and what it printed is the marker the gate asks for.
 */
export function commandCloses(gate: Gate, isError: boolean, output: string): boolean {
	if (gate.kind !== "command" || isError) return false;
	return new RegExp(gate.must, "m").test(output);
}

/**
 * Whether a shell command proves *this* spec closed. The command is not the model's to
 * choose: a named issue is proved only by reading that issue, and the count route only by
 * the unfiltered open list. Anything else — another issue, `--state closed`, a composite —
 * prints a marker that says nothing about this spec.
 */
export function trackerProof(command: string, ref: string | undefined): boolean {
	const c = command.replace(/\s+/g, " ").trim();
	if (!c || /[;&|<>`]|\$\(/.test(c)) return false;
	const issue = /^#?(\d+)$/.exec((ref ?? "").trim());
	if (issue && new RegExp(`^gh issue view ${issue[1]} --json state( -q \\.state)?$`).test(c)) return true;
	return /^gh issue list --state open( --json number)? -q length$/.test(c);
}

/** What a gate asks for, in one line: the question for a person, the check for a command. */
export function gateText(gate: Gate): string {
	return gate.kind === "user" ? gate.quote : gate.hint;
}

/**
 * The command that proves a spec closed, derived from the anchor the user named: an issue
 * number has a tracker state, a path has none (nothing to ask, only a person can say).
 */
export function specCheck(ref: string): string | undefined {
	const issue = /^#?(\d+)$/.exec(ref.trim());
	return issue ? `gh issue view ${issue[1]} --json state -q .state` : undefined;
}

/**
 * What the model has to still see after a compaction: the phase, its spec, how much is left
 * and the next step. Built fresh on every request, because a message written once lands
 * behind the compaction point and is gone.
 */
export function phaseBlock(contracts: readonly Contract[], state: GuardState): string | null {
	const c = contractOf(contracts, state.phase);
	if (!c) return null;
	const gate = needsGate(contracts, state);
	const check = state.spec ? specCheck(state.spec.ref) : undefined;
	const left = state.tickets === undefined ? "неизвестно — прогони проверку" : `${state.tickets} открытых тикетов`;
	let closing = "гейт закрыт";
	if (gate?.kind === "user") closing = `гейт открыт: ${gate.question}`;
	if (gate?.kind === "command") closing = `гейт открыт: ${gate.hint}${check ? ` — ${check}` : ""}`;
	return [
		`[skill-guard] фаза: ${c.name}${state.spec ? ` · спека: ${state.spec.ref}` : ""}`,
		`осталось: ${left}`,
		closing,
		`следующий шаг: ${c.successors.join(" | ") || "—"}`,
	].join("\n");
}

/**
 * A tool this extension knows nothing about, called in a phase that cannot run commands.
 * It could do anything, so the user decides — the alternative is a guard that any
 * extension's tool walks past.
 */
export function needsPermission(state: GuardState, tool: string, contracts: readonly Contract[]): boolean {
	const c = contractOf(contracts, state.phase);
	if (!c || c.grants.includes("bash")) return false;
	return grantFor(tool) === null;
}

export function decide(state: GuardState, req: Request, contracts: readonly Contract[]): Decision {
	const c = contractOf(contracts, state.phase);

	if (req.kind === "skill") {
		if (req.name === state.phase) return { allow: true, phase: state.phase };
		// A sub-skill runs inside the open phase: it neither moves the flow nor narrows
		// what the phase grants. With no phase open, only a contracted one is the way in.
		if (SUB_SKILLS.has(req.name)) return { allow: true, phase: state.phase ?? contractOf(contracts, req.name)?.name ?? null };
		// A declared successor is a phase even before it has a contract of its own: the
		// declaration is the flow's statement about order. Answering «no contract» first made
		// `pr`, `retro` and `handoff` readable but never open — declared and unreachable.
		if (c?.successors.includes(req.name)) return { allow: true, phase: req.name };
		// A skill without a contract is not a phase: it may be read from anywhere, but
		// it does not lift the restrictions of the phase that is open. Only the user, by
		// naming a phase, can move the flow.
		if (!contractOf(contracts, req.name)) return { allow: true, phase: state.phase };
		if (!c) return { allow: true, phase: req.name };
		const allowed = c.successors.length ? c.successors.join(", ") : "ничего — эта фаза последняя";
		return blocked(
			`Фаза «${c.name}» не переходит в «${req.name}». Дальше отсюда: ${allowed}.` +
				(c.gate ? `\nСначала закрой текущую фазу: ${gateText(c.gate)}` : ""),
		);
	}

	const grant = grantFor(req.tool);
	if (grant === null) return { allow: true, phase: state.phase };
	if (!c) return { allow: true, phase: state.phase };
	if (c.grants.includes(grant)) {
		// Reading is how the model finds out what the spec says; only a change needs an anchor.
		if (c.needsSpec && grant !== "read" && !state.spec?.ref) {
			return blocked(
				`Фаза «${c.name}» работает по спеке, а спека не названа.` +
					`\nНазови её: /matt spec <#issue|путь>.`,
			);
		}
		return { allow: true, phase: state.phase };
	}
	return blocked(
		`Фаза «${c.name}» разрешает только: ${c.grants.join(", ")}. Инструмент «${req.tool}» — нет.` +
			`\nДальше отсюда: ${c.successors.join(", ")}.`,
	);
}
