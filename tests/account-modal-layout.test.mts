import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../src/styles.css",import.meta.url),"utf8");
test("account dialog keeps header and actions outside scrollable body",()=>{
 const dialog=app.slice(app.indexOf('className="modal account-modal"'),app.indexOf("function ComposeModal("));
 assert.match(dialog,/aria-labelledby="connect-account-title"/);
 assert.match(dialog,/<div className="account-modal-body">[\s\S]*<ConnectionError[\s\S]*<\/div>\s*<footer className="modal-footer">/);
 assert.match(css,/\.account-modal\{[^}]*max-height:calc\(100vh \/ var\(--ui-scale,1\) - 40px\)[^}]*grid-template-rows:auto minmax\(0,1fr\) auto/);
 assert.match(css,/\.account-modal-body\{[^}]*overflow-y:auto/);
 assert.equal((dialog.match(/className="account-server-security"/g)||[]).length,3);
});
