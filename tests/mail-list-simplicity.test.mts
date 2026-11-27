import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
test("mail list has no redundant advanced filters or invisible filter state",()=>{
 assert.doesNotMatch(app,/mail-advanced-filters|advancedFiltersOpen|periodFilter|senderFilter|priorityFilter/);
 assert.match(app,/matchesQuickFilter\(message,quickFilter\)/);
 assert.match(app,/setQuickFilter\("unread"\)/);
});
