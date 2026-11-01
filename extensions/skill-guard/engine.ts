/**
 * The whole decision logic. Pure: no filesystem, no UI, no Pi. index.ts wires it up.
 */
import { SUB_SKILLS, type Contract, type Grant } from "./contracts.ts";

export interface GuardState {
	/** Skill currently open, or null before the flow starts. */
	phase: string | null;
	/** Phases whose end-condition question the user already answered yes. */
	gatesPassed: string[];
}

export type Request =
	| { kind: "tool"; tool: string; }
	| { kind: "skill"; name: string; };

export type Decision =
	| { allow: true; phase: string | null; }
	| { allow: false; reason: string; };

/** Tools that only read. Everything else that writes or executes is mapped explicitly. */
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls", "ctx_read", "ctx_grep", "ctx_find", "ctx_ls"]);

/** bash, powershell and every wrapper that ultimately runs a command or an agent with tools. */
const EXEC_TOOLS = new Set(["bash", "powershell", "pwsh", "shell", "ctx_shell", "codemode", "subagent", "workflow"]);

/** Pi tool name → the capability it needs. Unknown tools map to null and are always allowed. */
export function grantFor(tool: string): Grant | null {
	if (READ_ONLY_TOOLS.has(tool)) return "read";
	if (tool === "write" || tool === "ctx_edit") return "write";
	if (tool === "edit") return "edit";
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
 * Skill name of a SKILL.md path, or null for any other file.
 * Also matches the `<name>` of a `/<name>` mention, which is how a skill is loaded.
 */
export function skillNameFromPath(path: string): string | null {
	const m = /(?:^|[\\/])([^\\/]+)[\\/]SKILL\.md$/i.exec(path.trim());
	return m ? m[1] : null;
}

export function nextPhases(contracts: readonly Contract[], state: GuardState): string[] {
	const c = contractOf(contracts, state.phase);
	if (!c) return [];
	return c.successors.filter((s) => contractOf(contracts, s) !== undefined || s);
}

function blocked(reason: string): Decision {
	return { allow: false, reason };
}

/** The gate of the phase being entered has to be answered before the move. */
export function needsGate(contracts: readonly Contract[], state: GuardState): Contract["gate"] | undefined {
	const c = contractOf(contracts, state.phase);
	if (!c?.gate) return undefined;
	return state.gatesPassed.includes(c.name) ? undefined : c.gate;
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
		// what the phase grants. With no phase open it is the way in.
		if (SUB_SKILLS.has(req.name)) return { allow: true, phase: c ? state.phase : req.name };
		// A skill without a contract is not a phase: it may be read from anywhere, but
		// it does not lift the restrictions of the phase that is open. Only the user, by
		// naming a phase, can move the flow.
		if (!contractOf(contracts, req.name)) return { allow: true, phase: state.phase };
		if (!c) return { allow: true, phase: req.name };
		if (c.successors.includes(req.name)) return { allow: true, phase: req.name };
		const allowed = c.successors.length ? c.successors.join(", ") : "ничего — эта фаза последняя";
		return blocked(
			`Фаза «${c.name}» не переходит в «${req.name}». Дальше отсюда: ${allowed}.` +
				(c.gate ? `\nСначала закрой текущую фазу: ${c.gate.quote}` : ""),
		);
	}

	const grant = grantFor(req.tool);
	if (grant === null) return { allow: true, phase: state.phase };
	if (!c) return { allow: true, phase: state.phase };
	if (c.grants.includes(grant)) return { allow: true, phase: state.phase };
	return blocked(
		`Фаза «${c.name}» разрешает только: ${c.grants.join(", ")}. Инструмент «${req.tool}» — нет.` +
			`\nДальше отсюда: ${c.successors.join(", ")}.`,
	);
}
