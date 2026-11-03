/**
 * The phase file is the only thing that survives `/reload`, so it has to fail loudly
 * nowhere and silently to "no phase" only when the file really says nothing usable.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRoot, readState, statePath, writeState } from "./state.ts";

const tempRoot = () => mkdtempSync(join(tmpdir(), "skill-guard-"));

/** A file at a session path, with the directories it needs. */
function writeRaw(dir: string, name: string, text: string): string {
	mkdirSync(join(dir, ".pi", "skills-guard", "sessions"), { recursive: true });
	const path = statePath(dir, name);
	writeFileSync(path, text);
	return path;
}

test("a written phase reads back the same", () => {
	const path = statePath(tempRoot(), "abc");
	writeState(path, { phase: "to-spec", gatesPassed: ["grilling"] });
	assert.deepEqual(readState(path), { phase: "to-spec", gatesPassed: ["grilling"] });
});

test("no file, broken json and a missing phase all restore nothing", () => {
	const dir = tempRoot();
	assert.equal(readState(statePath(dir, "missing")), null, "no file is not an error");

	assert.equal(readState(writeRaw(dir, "broken", "{not json")), null, "a half-written file must not throw");
	assert.equal(readState(writeRaw(dir, "empty", JSON.stringify({ phase: 42, gatesPassed: "x" }))), null, "a phase that is not a name is not a phase");
});

test("a stray gatesPassed value does not reach the state", () => {
	const path = writeRaw(tempRoot(), "gates", JSON.stringify({ phase: "grilling", gatesPassed: ["ok", 7, null] }));
	assert.deepEqual(readState(path), { phase: "grilling", gatesPassed: ["ok"] });
});

test("the session id cannot walk out of the sessions directory", () => {
	const path = statePath("/repo", "../../etc/passwd");
	assert.equal(path, join("/repo", ".pi", "skills-guard", "sessions", ".._.._etc_passwd.json"));
});

test("the root is the nearest directory with .pi or .git", () => {
	const root = tempRoot();
	mkdirSync(join(root, ".pi"));
	const nested = join(root, "a", "b");
	mkdirSync(nested, { recursive: true });
	assert.equal(findRoot(nested), root);
});
