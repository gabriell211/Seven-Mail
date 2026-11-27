import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type LockedPackage = { version?: string };
const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8")) as {
  packages: Record<string, LockedPackage>;
};
const cargo = readFileSync(new URL("../src-tauri/Cargo.lock", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  dependencies: Record<string, string>;
};
const versions = new Map<string, string[]>();
for (const entry of cargo.split(/^\[\[package\]\]\s*$/m).slice(1)) {
  const name = entry.match(/^name = "([^"]+)"$/m)?.[1];
  const version = entry.match(/^version = "([^"]+)"$/m)?.[1];
  if (name && version) versions.set(name, [...(versions.get(name) ?? []), version]);
}
const majorMinor = (value: string) => value.split(".").slice(0, 2).join(".");
test("Tauri npm and Rust plugin lockfiles agree on major/minor releases", () => {
  const pairs = [
    ["@tauri-apps/api", "tauri"],
    ["@tauri-apps/plugin-autostart", "tauri-plugin-autostart"],
    ["@tauri-apps/plugin-deep-link", "tauri-plugin-deep-link"],
    ["@tauri-apps/plugin-dialog", "tauri-plugin-dialog"],
    ["@tauri-apps/plugin-notification", "tauri-plugin-notification"],
    ["@tauri-apps/plugin-opener", "tauri-plugin-opener"],
    ["@crabnebula/tauri-plugin-drag", "tauri-plugin-drag"],
  ];
  for (const [npm, crate] of pairs) {
    const js = lock.packages["node_modules/" + npm]?.version;
    const rust = versions.get(crate);
    assert.ok(js, npm + " missing from npm lockfile");
    assert.equal(rust?.length, 1, crate + " must have exactly one locked version");
    assert.equal(majorMinor(js), majorMinor(rust![0]), npm + " incompatible with " + crate);
  }
  for (const name of ["@tauri-apps/plugin-deep-link", "@tauri-apps/plugin-opener"]) {
    assert.equal(manifest.dependencies[name], lock.packages["node_modules/" + name]?.version,
      name + " must stay exactly pinned");
  }
  const api = lock.packages["node_modules/@tauri-apps/api"]?.version;
  for (const [path, value] of Object.entries(lock.packages)) {
    if (path.endsWith("/node_modules/@tauri-apps/api")) {
      assert.equal(value.version, api, "Unexpected nested Tauri API: " + path);
    }
  }
});


test("desktop release version agrees across manifests and lockfiles", () => {
  const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  const version = json("../package.json").version;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const npmLock = json("../package-lock.json");
  assert.equal(npmLock.version, version);
  assert.equal(npmLock.packages[""].version, version);
  assert.equal(json("../src-tauri/tauri.conf.json").version, version);
  const cargoManifest = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
  assert.equal(cargoManifest.match(/^version = "([^"]+)"$/m)?.[1], version);
  assert.deepEqual(versions.get("seven-mail"), [version]);
  assert.equal(readFileSync(new URL("../.github/release-trigger", import.meta.url), "utf8").trim(), "v" + version);
});
