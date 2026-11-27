import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
const rust=readFileSync(new URL("../src-tauri/src/gemini.rs",import.meta.url),"utf8");
const panel=readFileSync(new URL("../src/components/GeminiPanel.tsx",import.meta.url),"utf8");
test("Gemini uses native HTTPS, scoped vault and no external runtime or mutation tools",()=>{
 assert.match(rust,/generativelanguage\.googleapis\.com/);
 assert.match(rust,/header\("x-goog-api-key",key\)/);
 assert.match(rust,/credentials::store_scoped/);
 assert.match(rust,/Policy::none/);
 assert.doesNotMatch(rust,/Command::new|node_modules|queue_operation|message_action|delete_workspace|flush_outbox/);
 assert.equal(existsSync(new URL("../copilot-runtime",import.meta.url)),false);
});
test("consent and one-time draft approval remain mandatory",()=>{
 assert.match(rust,/require_scope\(&token,&account_id\)\?/);
 assert.match(rust,/messages.retain\(\|m\|m.account_id==account_id\)/);
 assert.match(rust,/access.proposal.take\(\)/);
 assert.match(panel,/window.confirm/);
 assert.match(panel,/gemini_approve_draft/);
 assert.doesNotMatch(panel,/GitHub|Copilot|Node\.js/i);
});
