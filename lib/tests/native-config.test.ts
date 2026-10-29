import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, it } from "vitest";

for (const app of ["participant", "management"]) {
  it(`${app} uses compatible Expo native packages and starts in Expo Go`, () => {
    const path = resolve(`apps/${app}/package.json`);
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    const require = createRequire(path);
    const bundled = require("expo/bundledNativeModules.json");
    for (const [name, version] of Object.entries(manifest.dependencies)) {
      if (name in bundled) expect(version, name).toBe(bundled[name]);
    }
    expect(manifest.scripts.start).toBe("expo start --go");
    expect(manifest.scripts["start:dev-client"]).toBe("expo start --dev-client");
  });
}
