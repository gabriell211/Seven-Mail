import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/copilot.rs",import.meta.url),"utf8");
const runner=readFileSync(new URL("../copilot-runtime/runner.mjs",import.meta.url),"utf8");
const panel=readFileSync(new URL("../src/components/CopilotPanel.tsx",import.meta.url),"utf8");
test("copilot has no operating-system or mail mutation tools",()=>{
 assert.match(runner,/mode:"empty"/);
 assert.match(runner,/availableTools:\[\]/);
 assert.match(runner,/kind:"reject"/);
 assert.doesNotMatch(rust,/queue_operation|message_action|delete_workspace|store_secret|flush_outbox/);
});
test("account consent and one-shot proposal approval are mandatory",()=>{
 assert.match(rust,/require_scope\(&token,&account_id\)\?/);
 assert.match(rust,/messages.retain\(\|m\|m.account_id==account_id\)/);
 assert.match(rust,/access.proposal.take\(\)/);
 assert.match(rust,/PROPOSAL_TTL/);
 assert.match(panel,/window.confirm/);
 assert.match(panel,/copilot_approve_draft/);
});
