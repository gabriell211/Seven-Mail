import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
const calendar=readFileSync(new URL("../src/components/WorkspaceViews.tsx",import.meta.url),"utf8");
const logo=readFileSync(new URL("../public/integrations/seven-desk.svg",import.meta.url),"utf8");
test("meeting actions use the bundled Seven Desk brand",()=>{
  assert.match(logo,/seven-purple/);
  assert.equal(app.split('src="/integrations/seven-desk.svg"').length-1,2);
  assert.match(app,/onClick=\{\(\)=>startMeeting\(\)\}/);
});
test("meeting draft opens the existing editor rather than saving immediately",()=>{
  const start=app.indexOf("function startMeeting(");
  const end=app.indexOf("async function createTaskFromMessage(",start);
  const source=app.slice(start,end);
  assert.match(source,/setMeetingDraft\(/);
  assert.match(source,/setSection\("calendar"\)/);
  assert.doesNotMatch(source,/upsertWorkspace|pushCloudDocument/);
  assert.match(calendar,/setEditing\(initialMeeting\)/);
});
