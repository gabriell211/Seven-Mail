import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("every frontend bridge command is registered by Tauri", async () => {
  const [bridge, rust] = await Promise.all([
    readFile(new URL("../src/lib/bridge.ts", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
  ]);

  const bridgeCommands = new Set(
    [...bridge.matchAll(/command(?:<[^>]+>)?\(\s*["']([^"']+)["']/g)].map((match) => match[1]),
  );

  const handler = rust.match(/invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/);
  assert.ok(handler, "Tauri invoke_handler registration block was not found");

  const registered = new Set(
    handler[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  );

  const missing = [...bridgeCommands].filter((name) => !registered.has(name)).sort();
  assert.deepEqual(missing, [], `Frontend invokes unregistered Tauri commands: ${missing.join(", ")}`);
});
