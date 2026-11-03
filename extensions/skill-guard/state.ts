/**
 * Phase state on disk: `<root>/.pi/skills-guard/sessions/<sessionId>.json`.
 *
 * The phase has to outlive `/reload` and a resumed session; an in-memory value cannot.
 * Writes are temp + rename so a crash mid-write never leaves a half file, and a half file
 * never reads as "no phase" either — it reads as null, which restores nothing.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GuardState } from "./engine.ts";

/** Nearest directory that looks like a project root, or null outside one. */
export function findRoot(from: string): string | null {
	let dir = from;
	for (;;) {
		if (existsSync(join(dir, ".pi")) || existsSync(join(dir, ".git"))) return dir;
		const up = dirname(dir);
		if (up === dir) return null;
		dir = up;
	}
}

export function statePath(root: string, sessionId: string): string {
	// A session id is a uuid in practice; anything else must not walk out of the directory.
	return join(root, ".pi", "skills-guard", "sessions", `${sessionId.replace(/[^\w.-]/g, "_")}.json`);
}

/** The saved state, or null when there is none or it cannot be trusted. */
export function readState(path: string): GuardState | null {
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
	if (!raw || typeof raw !== "object") return null;
	const saved = raw as Partial<GuardState>;
	if (typeof saved.phase !== "string" || !saved.phase) return null;
	const spec = saved.spec;
	return {
		phase: saved.phase,
		gatesPassed: Array.isArray(saved.gatesPassed) ? saved.gatesPassed.filter((p): p is string => typeof p === "string") : [],
		...(spec && typeof spec.ref === "string" && spec.ref ? { spec } : {}),
	};
}

export function writeState(path: string, state: GuardState): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(state, null, "\t")}\n`);
	renameSync(tmp, path);
}
