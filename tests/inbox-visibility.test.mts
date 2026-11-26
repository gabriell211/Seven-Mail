import test from "node:test";
import assert from "node:assert/strict";
import { matchesInboxTab } from "../src/lib/mail-search.ts";

const common={from:{email:"sender@example.com"},isImportant:false,isFlagged:false,isPinned:false};
test("the default all inbox tab includes ordinary and important messages",()=>{
  assert.equal(matchesInboxTab(common,"all"),true);
  assert.equal(matchesInboxTab({...common,isImportant:true},"all"),true);
});
test("focused and other remain explicit complementary filters",()=>{
  assert.equal(matchesInboxTab(common,"focused"),false);
  assert.equal(matchesInboxTab(common,"other"),true);
  assert.equal(matchesInboxTab({...common,isFlagged:true},"focused"),true);
  assert.equal(matchesInboxTab({...common,isPinned:true},"other"),false);
  assert.equal(matchesInboxTab(common,"focused",["sender@example.com"]),true);
});
