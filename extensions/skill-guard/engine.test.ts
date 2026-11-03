import test from "node:test";
import assert from "node:assert/strict";
import { CONTRACTS } from "./contracts.ts";
import { commandCloses, decide, gateText, grantFor, needsGate, needsPermission, phaseBlock, skillNameFromPath, specCheck, type GuardState } from "./engine.ts";

const at = (phase: string | null, gatesPassed: string[] = []): GuardState => ({ phase, gatesPassed });
const tool = (name: string) => ({ kind: "tool" as const, tool: name });
const skill = (name: string) => ({ kind: "skill" as const, name });

test("cold start is unguarded", () => {
	assert.equal(decide(at(null), tool("bash"), CONTRACTS).allow, true);
	assert.equal(decide(at(null), skill("to-tickets"), CONTRACTS).allow, true);
});

test("grilling grants nothing that touches the repo", () => {
	assert.equal(decide(at("grilling"), tool("write"), CONTRACTS).allow, false);
	assert.equal(decide(at("grilling"), tool("bash"), CONTRACTS).allow, false);
	assert.equal(decide(at("grilling"), tool("read"), CONTRACTS).allow, true);
});

test("the block message names the phase and its next steps", () => {
	const d = decide(at("grilling"), tool("write"), CONTRACTS);
	assert.equal(d.allow, false);
	if (d.allow) return;
	assert.match(d.reason, /grilling/);
	assert.match(d.reason, /grill-with-docs/);
});

test("a sub-skill keeps the open phase and its grants", () => {
	const d = decide(at("grill-with-docs"), skill("grilling"), CONTRACTS);
	assert.equal(d.allow, true);
	if (!d.allow) return;
	assert.equal(d.phase, "grill-with-docs");
	// the whole point: the docs the skill asks for can still be written afterwards
	assert.equal(decide(at(d.phase), tool("write"), CONTRACTS).allow, true);
});

test("an uncontracted sub-skill is never a phase", () => {
	// domain-modeling has no contract, so it cannot arm a phase even on its own
	const d = decide(at(null), skill("domain-modeling"), CONTRACTS);
	assert.equal(d.allow, true);
	if (!d.allow) return;
	assert.equal(d.phase, null);
});

test("a sub-skill with no phase open is the way in", () => {
	const d = decide(at(null), skill("grilling"), CONTRACTS);
	assert.equal(d.allow, true);
	if (!d.allow) return;
	assert.equal(d.phase, "grilling");
});

test("grill-with-docs cannot skip the spec", () => {
	assert.equal(decide(at("grill-with-docs"), skill("implement"), CONTRACTS).allow, false);
	assert.equal(decide(at("grill-with-docs"), skill("to-spec"), CONTRACTS).allow, true);
});

test("a phase cannot be skipped", () => {
	const d = decide(at("grilling"), skill("to-spec"), CONTRACTS);
	assert.equal(d.allow, false);
	if (d.allow) return;
	assert.match(d.reason, /to-spec/);
});

test("a successor can be entered and becomes the phase", () => {
	const d = decide(at("grilling"), skill("grill-with-docs"), CONTRACTS);
	assert.equal(d.allow, true);
	if (!d.allow) return;
	assert.equal(d.phase, "grill-with-docs");
});

test("re-reading the current skill changes nothing", () => {
	const d = decide(at("implement"), skill("implement"), CONTRACTS);
	assert.equal(d.allow, true);
});

test("implement writes; code-review blocks edit but keeps bash", () => {
	assert.equal(decide(at("implement"), tool("edit"), CONTRACTS).allow, true);
	assert.equal(decide(at("code-review"), tool("edit"), CONTRACTS).allow, false);
	assert.equal(decide(at("code-review"), tool("bash"), CONTRACTS).allow, true);
});

test("a skill without a contract stays usable from anywhere", () => {
	assert.equal(decide(at("grilling"), skill("my-own-skill"), CONTRACTS).allow, true);
	assert.equal(decide(at("grilling"), tool("ctx_shell"), CONTRACTS).allow, false);
});

test("a skill without a contract leaves the phase alone", () => {
	const d = decide(at("grilling"), skill("research"), CONTRACTS);
	assert.equal(d.allow, true);
	assert.equal(d.phase, "grilling");
});

test("an unknown tool needs permission only where commands are denied", () => {
	assert.equal(needsPermission(at("grilling"), "mcp_search", CONTRACTS), true);
	assert.equal(needsPermission(at("implement"), "mcp_search", CONTRACTS), false);
	assert.equal(needsPermission(at(null), "mcp_search", CONTRACTS), false);
	assert.equal(needsPermission(at("grilling"), "read", CONTRACTS), false);
});

test("gate is asked once, for the phase that has one", () => {
	assert.ok(needsGate(CONTRACTS, at("grilling")));
	assert.equal(needsGate(CONTRACTS, at("grilling", ["grilling"])), undefined);
	assert.equal(needsGate(CONTRACTS, at("implement")), undefined);
});

test("every successor is a reachable skill or an unknown one", () => {
	for (const c of CONTRACTS) {
		assert.ok(c.successors.length > 0, `${c.name} has no way out`);
		assert.ok(!c.successors.includes(c.name), `${c.name} loops to itself`);
	}
	assert.deepEqual(CONTRACTS.find((c) => c.name === "tdd")?.successors, ["code-review"]);
});

test("SKILL.md paths are recognised and nothing else is", () => {
	assert.equal(skillNameFromPath("C:\\Users\\x\\.agents\\skills\\grilling\\SKILL.md"), "grilling");
	assert.equal(skillNameFromPath("/home/x/skills/tdd/SKILL.md"), "tdd");
	assert.equal(skillNameFromPath("./extensions/skill-guard/index.ts"), null);
	assert.equal(skillNameFromPath("C:\\x\\SKILL.md"), "x");
	assert.equal(skillNameFromPath("SKILL.md"), null);
});

test("capability mapping covers Pi's own tool names", () => {
	assert.equal(grantFor("read"), "read");
	assert.equal(grantFor("ctx_shell"), "bash");
	assert.equal(grantFor("Write"), null);
	// every tool that can run a command or an agent is bash, so a denied bash cannot be
	// bypassed by picking another one
	for (const t of ["bash", "powershell", "pwsh", "shell", "ctx_shell", "codemode", "subagent", "workflow"]) {
		assert.equal(grantFor(t), "bash", t);
	}
});

test("a tool that writes or executes is never mapped as read", () => {
	for (const t of ["write", "edit", "ctx_edit", "ast_grep_replace"]) assert.notEqual(grantFor(t), "read", t);
	for (const t of ["lean_ctx", "ctx_call"]) assert.equal(grantFor(t), "bash", t);
});

test("read-only tools of the installed extensions need no permission", () => {
	for (const t of ["ctx_search", "ctx_tree", "symbol_search", "module_report", "lens_diagnostics", "wiki_search"]) {
		assert.equal(grantFor(t), "read", t);
		assert.equal(needsPermission(at("grilling"), t, CONTRACTS), false, t);
	}
});

test("implement-spec cannot change files before a spec is named", () => {
	const d = decide(at("implement-spec"), tool("write"), CONTRACTS);
	assert.equal(d.allow, false);
	if (d.allow) return;
	assert.match(d.reason, /спек/);
	assert.match(d.reason, /\/matt spec/);
	// bash writes too, so it is held to the same anchor
	assert.equal(decide(at("implement-spec"), tool("bash"), CONTRACTS).allow, false);
	// reading is how the model finds out what the spec says
	assert.equal(decide(at("implement-spec"), tool("read"), CONTRACTS).allow, true);
});

test("a named spec lets implement-spec work", () => {
	const withSpec: GuardState = { phase: "implement-spec", gatesPassed: [], spec: { ref: "#42" } };
	assert.equal(decide(withSpec, tool("write"), CONTRACTS).allow, true);
	assert.equal(decide(withSpec, tool("bash"), CONTRACTS).allow, true);
});

test("only a phase whose contract asks for a spec needs one", () => {
	assert.equal(decide(at("implement"), tool("write"), CONTRACTS).allow, true);
	assert.equal(CONTRACTS.filter((c) => c.needsSpec).length, 1);
});

const exitGate = CONTRACTS.find((c) => c.name === "implement-spec")?.gate;

test("implement-spec ends on the tracker's word, not the model's", () => {
	assert.equal(exitGate?.kind, "command");
	if (exitGate?.kind !== "command") return;
	assert.equal(commandCloses(exitGate, false, "0"), true, "no open sub-issues");
	assert.equal(commandCloses(exitGate, false, "CLOSED"), true, "the spec itself is closed");
	assert.equal(commandCloses(exitGate, false, "3"), false, "open tickets keep the phase open");
	assert.equal(commandCloses(exitGate, false, "10"), false, "10 is not 0");
	assert.equal(commandCloses(exitGate, true, "0"), false, "a failed command proves nothing");
});

test("a command gate reads as its check, a user gate as its question", () => {
	if (!exitGate) throw new Error("implement-spec has an exit gate");
	assert.match(gateText(exitGate), /gh|проверк/);
	const ask = needsGate(CONTRACTS, at("to-tickets"));
	assert.ok(ask && gateText(ask).length > 0);
});

test("the check command is derived from an issue anchor only", () => {
	assert.equal(specCheck("#42"), "gh issue view 42 --json state -q .state");
	assert.equal(specCheck("42"), "gh issue view 42 --json state -q .state");
	assert.equal(specCheck(".scratch/feat/"), undefined, "a path has no tracker state");
});

test("the phase block says what has to survive a compaction", () => {
	assert.equal(phaseBlock(CONTRACTS, at(null)), null, "no phase, no block");

	const block = phaseBlock(CONTRACTS, { phase: "implement-spec", gatesPassed: [], spec: { ref: "#42" }, tickets: 3 }) ?? "";
	assert.match(block, /фаза: implement-spec/);
	assert.match(block, /спека: #42/);
	assert.match(block, /3 открытых тикетов/);
	assert.match(block, /gh issue view 42/);
	assert.match(block, /code-review/);

	const closed = phaseBlock(CONTRACTS, { phase: "implement-spec", gatesPassed: ["implement-spec"], spec: { ref: "#42" } }) ?? "";
	assert.match(closed, /гейт закрыт/);
	assert.match(closed, /осталось: неизвестно/);
});
