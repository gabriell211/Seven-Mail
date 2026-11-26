import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
const body=readFileSync(new URL("../src/components/SafeMessageBody.tsx",import.meta.url),"utf8");
test("slow mail IPC commands dispatch blocking work off the UI thread",()=>{
  for(const name of ["provider_message_policy","sync_ldap","test_ldap_connection","sync_dav","test_dav_connection","test_smtp_connection","test_imap_connection","sync_inbox","list_mail_folders","sync_mail_folder","flush_mail_actions","list_cached_messages","search_cached_message_ids","flush_outbox","inspect_smime_message","list_message_attachments"]){
    const start=source.indexOf("async fn "+name+"(");
    assert.notEqual(start,-1,name);
    const end=source.indexOf("\n}\n",start);
    assert.ok(source.slice(start,end).includes("spawn_blocking"),name);
  }
});
test("external sender banner is removed without removing remote-content or suspicious-link checks",()=>{
  assert.ok(!body.includes("Remetente externo à sua organização"));
  assert.ok(body.includes("settings.blockRemoteContent"));
  assert.ok(body.includes("settings.warnSuspiciousLinks"));
  assert.ok(body.includes("sanitizeMessageHtml"));
});

test("cache, workspace and queue operations also leave the UI thread",()=>{
  for(const name of ["runtime_info","list_accounts","get_cloud_binding","cache_message","list_queue","queue_operation","message_action","update_message_metadata","prune_message_cache","list_workspace","list_workspace_for_sync","search_workspace","upsert_workspace","delete_workspace","read_message_source","provider_corporate_catalog","provider_capabilities"]){
    const start=source.indexOf("async fn "+name+"(");
    assert.notEqual(start,-1,name);
    assert.ok(source.slice(start,source.indexOf("\n}\n",start)).includes("spawn_blocking"),name);
  }
  assert.ok(source.includes("OUTBOX_DRAIN.try_lock()"));
});
