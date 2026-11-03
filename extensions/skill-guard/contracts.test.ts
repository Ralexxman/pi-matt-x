/**
 * Every quote in CONTRACTS must exist verbatim in the skill it came from: the quotes
 * are the evidence shown to the user at a gate, so a drifting skill file must fail here
 * instead of quietly asking the wrong question.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONTRACTS } from "./contracts.ts";

const SKILLS_DIR = process.env["SKILLS_DIR"] ?? join(homedir(), ".agents", "skills");

const readSkill = (name: string) => readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

test("skills directory holds the flow skills", () => {
	for (const c of CONTRACTS) {
		assert.doesNotThrow(() => readSkill(c.name), `missing skill: ${c.name}`);
	}
});

test("every successor is an installed skill", () => {
	for (const c of CONTRACTS) {
		for (const s of c.successors) {
			assert.doesNotThrow(() => readSkill(s), `missing successor of ${c.name}: ${s}`);
		}
	}
});

test("every gate quote is verbatim in its skill", () => {
	for (const c of CONTRACTS) {
		if (c.gate?.kind !== "user") continue;
		const source = readSkill(c.gate.source ?? c.name);
		assert.ok(
			squash(source).includes(squash(c.gate.quote)),
			`quote drifted in ${c.name} (source: ${c.gate.source ?? c.name}):\n${c.gate.quote}`,
		);
	}
});
