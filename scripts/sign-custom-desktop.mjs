import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../packages/desktop/package.json", import.meta.url));
const { signAsync } = require("@electron/osx-sign");
const identityFile = path.join(root, ".dev/paseoi-signing-identity");
const identity = (
  process.env.PASEO_MAC_SIGNING_IDENTITY ??
  (existsSync(identityFile) ? readFileSync(identityFile, "utf8") : "")
)
  .trim()
  .toUpperCase();

// Pin the certificate, rather than accepting whichever developer identity Keychain lists first.
if (!/^[\dA-F]{40}$/i.test(identity)) {
  throw new Error(
    `Set PASEO_MAC_SIGNING_IDENTITY or ${identityFile} to a certificate SHA-1 fingerprint.`,
  );
}
const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
  encoding: "utf8",
});
if (!identities.toUpperCase().includes(identity.toUpperCase())) {
  throw new Error(
    "The configured Paseoi signing identity is unavailable. Refusing ad-hoc signing.",
  );
}

const app = process.argv[2];
if (app === "--check") {
  console.log("Configured Paseoi signing identity is available.");
} else {
  if (!app || !path.isAbsolute(app) || !app.endsWith("/Paseoi.app")) {
    throw new Error("Usage: node scripts/sign-custom-desktop.mjs /absolute/path/Paseoi.app");
  }
  await signAsync({
    app,
    identity,
    platform: "darwin",
    type: "development",
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile: (file) => ({
      entitlements: path.join(
        root,
        "packages/desktop/build",
        file === app ? "entitlements.mac.plist" : "entitlements.mac.inherit.plist",
      ),
      hardenedRuntime: true,
      timestamp: "none",
    }),
  });
  execFileSync("codesign", [
    "--verify",
    "--strict",
    "-R",
    `=identifier "sh.rockstone.paseo" and certificate leaf = H"${identity}"`,
    app,
  ]);
  console.log("Paseoi and nested code signed and verified with the configured certificate.");
}
