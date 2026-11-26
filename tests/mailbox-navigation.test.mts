import test from "node:test";
import assert from "node:assert/strict";
import { mailboxMessages,countUnreadByFolder } from "../src/lib/mailbox-navigation.ts";
const items=[{accountId:"a",folder:"Caixa de entrada",isRead:false},{accountId:"b",folder:"Caixa de entrada",isRead:false},{accountId:"b",folder:"Enviados",isRead:true},{accountId:"c",folder:"Caixa de entrada",isRead:false}];
test("account changes never display cached messages from another account",()=>{
  assert.deepEqual(mailboxMessages(items,["a","b"],"a"),[items[0]]);
  assert.deepEqual(mailboxMessages(items,["a","b"],"b"),[items[1],items[2]]);
  assert.deepEqual(mailboxMessages(items,["a","b"]),items.slice(0,3));
  assert.deepEqual(mailboxMessages(items,["a","b"],"c"),[]);
});
test("unread counts are scoped to account and exclude read messages",()=>{
  assert.equal(countUnreadByFolder(items,"b").get("Caixa de entrada"),1);
  assert.equal(countUnreadByFolder(items,"b").get("Enviados"),undefined);
});
