import test from "node:test";
import assert from "node:assert/strict";
import { mailboxMessages,countUnreadByFolder,isUnreadMessage } from "../src/lib/mailbox-navigation.ts";
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


test("unread predicate is explicit and shared with account counters",()=>{
 assert.equal(isUnreadMessage({isRead:false}),true);
 assert.equal(isUnreadMessage({isRead:true}),false);
 const mailbox=mailboxMessages(items,["a","b"],"b");
 assert.equal(mailbox.filter(isUnreadMessage).length,countUnreadByFolder(mailbox,"b").get("Caixa de entrada"));
 assert.equal(countUnreadByFolder(mailbox.map(item=>({...item,isRead:true})),"b").size,0);
});
