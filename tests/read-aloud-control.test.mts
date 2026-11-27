import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const reader=readFileSync(new URL("../src/components/ReadingAssist.tsx",import.meta.url),"utf8");
const app=readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
test("read aloud is directly accessible and uses a single speech toggle",()=>{
 assert.match(app,/<ReadingAssist key=\{selected.id\} message=\{selected\}/);
 assert.doesNotMatch(app,/readingToolsOpen&&<ReadingAssist/);
 assert.match(reader,/name="speaking"/);
 assert.match(reader,/aria-pressed=\{speaking\}/);
 assert.match(reader,/current.current=null;\s*speech.cancel\(\)/);
 assert.match(reader,/speaking\?"Parar leitura":"Ler em voz alta"/);
 assert.match(app,/setImmersiveOpen\(true\)/);
});
