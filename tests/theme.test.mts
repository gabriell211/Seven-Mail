import test from "node:test";
import assert from "node:assert/strict";
import {normalizeTheme,resolveTheme,nextTheme} from "../src/lib/theme.ts";
import {readFileSync} from "node:fs";
test("theme resolves system preference and shortcut toggles effective mode",()=>{
 assert.equal(resolveTheme("system",true),"dark");
 assert.equal(resolveTheme("system",false),"light");
 assert.equal(resolveTheme("light",true),"light");
 assert.equal(resolveTheme("dark",false),"dark");
 assert.equal(nextTheme("system",true),"light");
 assert.equal(nextTheme("system",false),"dark");
 assert.equal(nextTheme("dark",false),"light");
 assert.equal(nextTheme("light",true),"dark");
 assert.equal(normalizeTheme(null),"system");
 assert.equal(normalizeTheme("invalid"),"system");
});
test("theme is persisted through existing settings and applied before render",()=>{
 const app=readFileSync(new URL("../src/App.tsx",import.meta.url),"utf8");
 const main=readFileSync(new URL("../src/main.tsx",import.meta.url),"utf8");
 const css=readFileSync(new URL("../src/styles.css",import.meta.url),"utf8");
 assert.ok(app.includes('onClick={toggleTheme}'));
 assert.ok(app.includes('aria-pressed={effectiveTheme==="dark"}'));
 assert.ok(app.includes('media.addEventListener("change",update)'));
 assert.ok(app.includes('localStorage.setItem("seven-mail:settings",JSON.stringify(settings))'));
 assert.ok(main.indexOf("applyTheme(savedTheme()")<main.indexOf("ReactDOM.createRoot("));
 assert.ok(css.includes("color-scheme:dark"));
 assert.ok(css.includes("--action:#6247c5"));
 assert.ok(css.includes('signature-preview,:root[data-theme="dark"] .gemini-signature-preview'));
});


test("settings uses a cog outline distinct from the sun and moon",()=>{
 const icons=readFileSync(new URL("../src/icons.tsx",import.meta.url),"utf8");
 assert.match(icons,/settings:\["M9\.4 3h5\.2/);
 assert.match(icons,/sun:\["M12 7a5 5/);
 assert.match(icons,/moon:\["M20 15a8 8/);
});
