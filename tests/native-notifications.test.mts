import test from "node:test";
import assert from "node:assert/strict";
import {freshNotificationMessages,notificationPayloads} from "../src/lib/notification-policy.ts";
import {readFileSync} from "node:fs";
const msg=(id:string,accountId="a")=>({id,accountId,folder:"Caixa de entrada",isRead:false,isMuted:false,from:{email:"sender@example.com"},subject:"Assunto"});
test("only unread unmuted inbox mail is notified",()=>{
 assert.equal(notificationPayloads([msg("1"),{...msg("2"),isRead:true},{...msg("3"),isMuted:true},{...msg("4"),folder:"Spam"}]).length,1);
});
test("deduplication is scoped to account and summaries count only unread arrivals",()=>{
 const seen=new Set<string>();
 assert.equal(freshNotificationMessages([msg("1"),msg("1"),msg("1","b")],seen).length,2);
 assert.equal(freshNotificationMessages([msg("1")],seen).length,0);
 const payloads=notificationPayloads([msg("1"),msg("2"),msg("3"),msg("4"),{...msg("5"),isRead:true}]);
 assert.equal(payloads.length,4);
 assert.equal(payloads[3].body,"+1 nova mensagem");
});
test("native transport is registered and has no test button or redundant in-app notification",()=>{
 const native=readFileSync(new URL("../src-tauri/src/lib.rs",import.meta.url),"utf8");
 const app=readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
 const transport=readFileSync(new URL("../src/lib/notifications.ts",import.meta.url),"utf8");
 assert.ok(native.includes("show_native_notification,"));
 assert.ok(native.includes("app.notification().builder().title(title).body(body).show()"));
 assert.ok(transport.includes('invoke("show_native_notification"'));
 assert.ok(!app.includes("ensureNotificationPermission"));
 assert.ok(app.includes("if(await notifyNewMessages(visible))return;"));
 assert.ok(!app.includes("Testar notificação nativa"));
});
