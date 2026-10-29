const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { chromium } = require("playwright");
const { extractFile } = require("@electron/asar");
const { WebSocket } = require("ws");
const assert = require("node:assert/strict");

const EXECUTABLE_NAME = "Paseo";
const SMOKE_TIMEOUT_MS = 60_000;
const EXIT_TIMEOUT_MS = 10_000;
const TERMINAL_CAPTURE_ATTEMPTS = 20;
const TERMINAL_CAPTURE_INTERVAL_MS = 500;
const REQUIRED_DESKTOP_BRIDGE_KEYS = [
  "platform",
  "invoke",
  "getPendingOpenProject",
  "events",
  "window",
  "dialog",
  "notification",
  "opener",
  "editor",
  "webUtils",
  "menu",
  "browser",
];

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function assertBuiltinPluginsStarted(listen) {
  const { DaemonClient } = await import("@getpaseo/client/internal/daemon-client");
  const { builtinPlugins } =
    await import("../../server/dist/server/server/plugins/builtin/index.js");
  const client = new DaemonClient({
    url: `ws://${listen}/ws`,
    clientId: "packaged-builtin-smoke",
    webSocketFactory: (url, options) =>
      new WebSocket(url, options?.protocols, { headers: options?.headers }),
  });
  try {
    await client.connect();
    const catalog = await client.getPluginCatalog();
    assert.deepEqual(
      catalog.map(({ id }) => id).sort(),
      [...builtinPlugins].sort(),
      "Every built-in plugin must start in the packaged desktop daemon",
    );
  } finally {
    await client.close();
  }
}

function assertExecutable(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} does not exist: ${filePath}`);
  }
  if (process.platform !== "win32") {
    fs.accessSync(filePath, fs.constants.X_OK);
  }
}

function getExecutablePath(appPath) {
  if (process.platform === "darwin") {
    return path.join(appPath, "Contents", "MacOS", EXECUTABLE_NAME);
  }

  if (process.platform === "win32") {
    return path.join(appPath, `${EXECUTABLE_NAME}.exe`);
  }

  return path.join(appPath, EXECUTABLE_NAME);
}

function getCliShimPath(appPath) {
  if (process.platform === "darwin") {
    return path.join(appPath, "Contents", "Resources", "bin", "paseo");
  }

  if (process.platform === "win32") {
    return path.join(appPath, "resources", "bin", "paseo.cmd");
  }

  return path.join(appPath, "resources", "bin", "paseo");
}

function getMacMainExecutablePath(appPath) {
  return path.join(appPath, "Contents", "MacOS", EXECUTABLE_NAME);
}

function getLaunchCommand(executablePath, args) {
  if (process.platform !== "linux") {
    return {
      command: executablePath,
      args,
    };
  }

  return {
    command: "xvfb-run",
    args: ["-a", "--server-args=-screen 0 1280x800x24", executablePath, ...args],
  };
}

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellQuoteCliArg(value) {
  if (process.platform === "win32") {
    return `"${String(value).replace(/"/g, '""')}"`;
  }

  return shellQuote(String(value));
}

function getTerminalHookSmokeCommand(marker) {
  if (process.platform === "win32") {
    const script = [
      "& $env:PASEO_HOOK_CLI hooks codex Stop",
      "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
      `Write-Output '${marker}'`,
    ].join("; ");
    const encodedScript = Buffer.from(script, "utf16le").toString("base64");
    return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encodedScript}`;
  }

  return `"$PASEO_HOOK_CLI" hooks codex Stop && echo ${marker}`;
}

function getShellCommand(script) {
  if (process.platform === "win32") {
    return {
      command: "cmd.exe",
      args: ["/d", "/c", script],
    };
  }

  return {
    command: "/bin/sh",
    args: ["-lc", script],
  };
}

function createDefaultDaemonEnv(extraEnv) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("PASEO_"))),
    ...extraEnv,
  };
}

function createIsolatedDesktopEnv({ home, listen, userData, cdpPort }) {
  return {
    ...createDefaultDaemonEnv({ HOME: home, USERPROFILE: home }),
    PASEO_HOME: home,
    PASEO_LISTEN: listen,
    PASEO_ELECTRON_USER_DATA_DIR: userData,
    PASEO_ELECTRON_FLAGS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${cdpPort}`,
  };
}

function configureIsolatedDaemonHome(home, listen) {
  fs.writeFileSync(
    path.join(home, "config.json"),
    `${JSON.stringify(
      {
        version: 1,
        daemon: {
          listen,
          relay: { enabled: false },
          mcp: { enabled: false, injectIntoAgents: false },
        },
      },
      null,
      2,
    )}\n`,
  );
}

function reserveLocalTcpPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to reserve a TCP port for smoke test")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForFile(filePath, label) {
  const deadline = Date.now() + SMOKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const contents = fs.readFileSync(filePath, "utf8");
      if (contents.trim().length > 0) {
        return contents;
      }
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}: ${filePath}`);
}

async function waitForChildPids(parentPid) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const childPids = listChildPids(parentPid);
    if (childPids.length > 0) {
      return childPids;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for daemon worker child of supervisor PID ${parentPid}`);
}

function listChildPids(parentPid) {
  const result = spawnSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`ps failed while listing child processes: ${result.stderr.trim()}`);
  }

  const children = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const [pidText, ppidText] = line.trim().split(/\s+/);
    const pid = Number(pidText);
    const ppid = Number(ppidText);
    if (Number.isInteger(pid) && ppid === parentPid) {
      children.push(pid);
    }
  }
  return children;
}

function listDarwinTextExecutables(pid) {
  const result = spawnSync("lsof", ["-a", "-p", String(pid), "-d", "txt", "-Fn"], {
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `lsof failed while inspecting PID ${pid}: ${
        result.stderr.trim() || result.stdout.trim() || "<empty>"
      }`,
    );
  }

  return result.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("n"))
    .map((line) => line.slice(1));
}

function assertDarwinProcessDoesNotUseMainAppExecutable({ appPath, pid, label }) {
  const mainExecutablePath = getMacMainExecutablePath(appPath);
  assertExecutable(mainExecutablePath, "Packaged app executable");

  const textExecutables = listDarwinTextExecutables(pid);
  if (textExecutables.includes(mainExecutablePath)) {
    throw new Error(
      `${label} PID ${pid} launched through the main app executable ${mainExecutablePath}.\nText executables:\n${textExecutables.join(
        "\n",
      )}`,
    );
  }
}

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function formatLogs({ stdout, stderr, userData, daemonHome }) {
  const desktopLog = readIfExists(path.join(userData, "logs", "main.log"));
  const daemonLog = readIfExists(path.join(daemonHome, "daemon.log"));
  return [
    `App stdout:\n${stdout.join("").trim() || "<empty>"}`,
    `App stderr:\n${stderr.join("").trim() || "<empty>"}`,
    `Desktop log:\n${desktopLog?.trim() || "<missing>"}`,
    `Daemon log:\n${daemonLog?.trim() || "<missing>"}`,
  ].join("\n\n");
}

async function writeSmokeArtifacts({ page, stdout, stderr, userData, daemonHome, error }) {
  const artifactDir = process.env.PASEO_DESKTOP_SMOKE_ARTIFACT_DIR?.trim();
  if (!artifactDir) {
    return;
  }

  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, error ? "failure.txt" : "success.txt"),
    `${error instanceof Error ? (error.stack ?? error.message) : String(error ?? "Packaged desktop smoke passed")}\n\n${formatLogs(
      {
        stdout,
        stderr,
        userData,
        daemonHome,
      },
    )}\n`,
  );

  const desktopLog = readIfExists(path.join(userData, "logs", "main.log"));
  if (desktopLog !== null) {
    fs.writeFileSync(path.join(artifactDir, "desktop-main.log"), desktopLog);
  }
  const daemonLog = readIfExists(path.join(daemonHome, "daemon.log"));
  if (daemonLog !== null) {
    fs.writeFileSync(path.join(artifactDir, "daemon.log"), daemonLog);
  }

  if (page) {
    const renderer = await page
      .evaluate(() => ({
        url: window.location.href,
        title: document.title,
        rootChildCount: document.querySelector("#root")?.childElementCount ?? 0,
        rootText: document.querySelector("#root")?.textContent?.trim().slice(0, 2_000) ?? "",
        bridgeKeys:
          typeof window.paseoDesktop === "object" && window.paseoDesktop !== null
            ? Object.keys(window.paseoDesktop)
            : [],
      }))
      .catch((evaluationError) => ({ evaluationError: String(evaluationError) }));
    fs.writeFileSync(
      path.join(artifactDir, "renderer.json"),
      `${JSON.stringify(renderer, null, 2)}\n`,
    );
    await page
      .screenshot({ path: path.join(artifactDir, "renderer.png"), fullPage: true })
      .catch(() => undefined);
  }
}

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

function terminateChild(child, signal = "SIGTERM") {
  if (!isRunning(child)) {
    return;
  }

  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }

  if (child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {}
  }

  child.kill(signal);
}

function waitForChildExit(child, timeoutMs = EXIT_TIMEOUT_MS) {
  if (!isRunning(child)) {
    return Promise.resolve(true);
  }

  let onExit;
  const exitPromise = new Promise((resolve) => {
    onExit = () => resolve(true);
    child.once("exit", onExit);
  });

  return Promise.race([exitPromise, delay(timeoutMs, false)]).finally(() => {
    child.off("exit", onExit);
  });
}

function releaseChildHandles(child) {
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

async function removeTempDir(tempDir) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!["EBUSY", "ENOTEMPTY", "EPERM"].includes(error?.code) || attempt === 4) {
        console.warn(`Packaged desktop smoke: failed to remove temp dir ${tempDir}: ${error}`);
        return;
      }
      await delay(250);
    }
  }
}

function remainingTime(deadline) {
  return Math.max(1, deadline - Date.now());
}

async function connectToPackagedApp({
  child,
  cdpPort,
  stdout,
  stderr,
  userData,
  daemonHome,
  deadline,
}) {
  let lastError = null;

  while (Date.now() < deadline) {
    if (!isRunning(child)) {
      throw new Error(
        `Packaged app exited before opening its debugging endpoint (code ${child.exitCode}, signal ${
          child.signalCode ?? "none"
        }).\n${formatLogs({ stdout, stderr, userData, daemonHome })}`,
      );
    }

    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }

  throw new Error(
    `Timed out connecting to the packaged app over CDP: ${lastError}.\n${formatLogs({
      stdout,
      stderr,
      userData,
      daemonHome,
    })}`,
  );
}

async function waitForPackagedAppPage(browser, deadline) {
  while (Date.now() < deadline) {
    const page = browser
      .contexts()
      .flatMap((context) => context.pages())
      .find((candidate) => candidate.url().startsWith("paseo://app/"));
    if (page) {
      return page;
    }
    await delay(250);
  }
  throw new Error("Timed out waiting for the packaged paseo://app/ renderer");
}

async function assertPackagedRendererLoaded(page, deadline) {
  await page.waitForFunction(
    () => {
      const root = document.querySelector("#root");
      return root instanceof HTMLElement && root.childElementCount > 0;
    },
    undefined,
    { timeout: remainingTime(deadline) },
  );

  const bridgeKeys = await page.evaluate(() =>
    typeof window.paseoDesktop === "object" && window.paseoDesktop !== null
      ? Object.keys(window.paseoDesktop)
      : [],
  );
  const missingBridgeKeys = REQUIRED_DESKTOP_BRIDGE_KEYS.filter((key) => !bridgeKeys.includes(key));
  if (missingBridgeKeys.length > 0) {
    throw new Error(
      `Packaged renderer is missing desktop preload bridge keys: ${missingBridgeKeys.join(", ")}. Present keys: ${bridgeKeys.join(", ") || "<none>"}`,
    );
  }
}

async function waitForRendererStartedDaemon({
  page,
  daemonHome,
  listen,
  stdout,
  stderr,
  userData,
  deadline,
}) {
  let lastStatus = null;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      lastStatus = await page.evaluate(() => window.paseoDesktop.invoke("desktop_daemon_status"));
      if (
        lastStatus?.status === "running" &&
        lastStatus.desktopManaged === true &&
        typeof lastStatus.pid === "number" &&
        typeof lastStatus.serverId === "string" &&
        lastStatus.serverId.length > 0 &&
        lastStatus.listen === listen &&
        path.resolve(lastStatus.home) === path.resolve(daemonHome)
      ) {
        return lastStatus;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  throw new Error(
    `Packaged renderer did not start its desktop-managed daemon. Last status: ${JSON.stringify(lastStatus)}. Last error: ${lastError}.\n${formatLogs({ stdout, stderr, userData, daemonHome })}`,
  );
}

function runShellCommand({ script, env, label }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const shell = getShellCommand(script);
    const child = spawn(shell.command, shell.args, {
      detached: process.platform !== "win32",
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsVerbatimArguments: process.platform === "win32",
    });
    const stdout = [];
    const stderr = [];

    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      releaseChildHandles(child);
      callback(value);
    };

    const timer = setTimeout(() => {
      terminateChild(child);
      finish(
        reject,
        new Error(
          `${label} timed out.\nStdout:\n${stdout.join("").trim() || "<empty>"}\n\nStderr:\n${
            stderr.join("").trim() || "<empty>"
          }`,
        ),
      );
    }, SMOKE_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
    child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
    child.once("error", (error) => finish(reject, error));
    child.once("exit", (code, signal) => {
      if (code === 0) {
        finish(resolve, {
          stdout: stdout.join(""),
          stderr: stderr.join(""),
        });
        return;
      }

      finish(
        reject,
        new Error(
          `${label} failed (code ${code}, signal ${signal ?? "none"}).\nStdout:\n${
            stdout.join("").trim() || "<empty>"
          }\n\nStderr:\n${stderr.join("").trim() || "<empty>"}`,
        ),
      );
    });
  });
}

function getCliShimScript(cliShimPath, args) {
  const commandArgs = args.map(shellQuoteCliArg).join(" ");
  if (process.platform === "win32") {
    return `call "${cliShimPath}" ${commandArgs}`;
  }

  return `${shellQuote(cliShimPath)} ${commandArgs}`;
}

async function runCliShimCommand({ appPath, env, args, label }) {
  const cliShimPath = getCliShimPath(appPath);
  assertExecutable(cliShimPath, "Bundled CLI shim");

  return await runShellCommand({
    script: getCliShimScript(cliShimPath, args),
    env,
    label,
  });
}

async function runCliShimJsonCommand({ appPath, env, args, label }) {
  const result = await runCliShimCommand({
    appPath,
    env,
    args: [...args, "--json"],
    label,
  });
  const output = result.stdout.trim();
  if (!output) {
    throw new Error(`${label} produced empty JSON output`);
  }

  try {
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`${label} produced invalid JSON: ${output}`, { cause: error });
  }
}

async function smokeCliShim({ appPath, env }) {
  console.log("Packaged desktop smoke: running bundled CLI shim daemon status");
  const result = await runCliShimCommand({
    appPath,
    env,
    args: ["daemon", "status"],
    label: "Bundled CLI shim daemon status",
  });
  assertCleanDaemonStatusOutput(`${result.stdout}\n${result.stderr}`);
}

async function smokeColdCliDaemonStart({ appPath }) {
  const home = createTempDir("paseo-smoke-cli-daemon-home-");
  const pidPath = path.join(home, "paseo.pid");
  const port = await reserveLocalTcpPort();
  const listen = `127.0.0.1:${port}`;
  const env = createDefaultDaemonEnv({ HOME: home, USERPROFILE: home });
  configureIsolatedDaemonHome(home, listen);

  try {
    console.log("Packaged desktop smoke: cold-starting daemon through bundled CLI shim");
    await runCliShimCommand({
      appPath,
      env,
      args: ["daemon", "start", "--home", home],
      label: "Bundled CLI shim cold daemon start",
    });

    const pidInfo = JSON.parse(await waitForFile(pidPath, "cold CLI daemon pid file"));
    if (!pidInfo || typeof pidInfo.pid !== "number") {
      throw new Error(`Cold CLI daemon wrote invalid pid file: ${JSON.stringify(pidInfo)}`);
    }

    if (process.platform === "darwin") {
      assertDarwinProcessDoesNotUseMainAppExecutable({
        appPath,
        pid: pidInfo.pid,
        label: "Cold CLI daemon supervisor",
      });
      const childPids = await waitForChildPids(pidInfo.pid);
      for (const childPid of childPids) {
        assertDarwinProcessDoesNotUseMainAppExecutable({
          appPath,
          pid: childPid,
          label: "Cold CLI daemon worker",
        });
      }
    }
  } finally {
    if (fs.existsSync(pidPath)) {
      await runCliShimCommand({
        appPath,
        env,
        args: ["daemon", "stop", "--home", home, "--force"],
        label: "Bundled CLI shim cold daemon stop",
      }).catch((error) => {
        console.warn(`Packaged desktop smoke: failed to stop cold CLI daemon: ${error}`);
      });
    }
    await removeTempDir(home);
  }
}

function assertCleanDaemonStatusOutput(output) {
  const failureNeedles = [
    "Get-CimInstance",
    "Get-Process :",
    "Cannot bind parameter",
    "wmic failed",
  ];
  const failure = failureNeedles.find((needle) => output.includes(needle));
  if (failure) {
    throw new Error(`Bundled CLI shim daemon status included process lookup failure: ${failure}`);
  }
}

async function smokeCliTerminal({ appPath, env }) {
  const cwd = createTempDir("paseo-smoke-terminal-cwd-");
  const marker = `paseo-packaged-terminal-smoke-${Date.now()}`;
  const name = `packaged-smoke-${process.pid}-${Date.now()}`;
  let terminalId = null;

  try {
    console.log("Packaged desktop smoke: creating terminal through bundled CLI shim");
    const created = await runCliShimJsonCommand({
      appPath,
      env,
      args: ["terminal", "create", "--cwd", cwd, "--name", name],
      label: "Bundled CLI shim terminal create",
    });
    if (!created || typeof created.id !== "string" || created.id.length === 0) {
      throw new Error(`Terminal create returned unexpected payload: ${JSON.stringify(created)}`);
    }
    terminalId = created.id;

    const terminals = await runCliShimJsonCommand({
      appPath,
      env,
      args: ["terminal", "ls", "--all"],
      label: "Bundled CLI shim terminal ls",
    });
    if (!Array.isArray(terminals) || !terminals.some((terminal) => terminal.id === terminalId)) {
      throw new Error(`Terminal ${terminalId} was not listed after create`);
    }

    await runCliShimJsonCommand({
      appPath,
      env,
      args: ["terminal", "send-keys", terminalId, getTerminalHookSmokeCommand(marker), "Enter"],
      label: "Bundled CLI shim terminal hook command",
    });

    for (let attempt = 1; attempt <= TERMINAL_CAPTURE_ATTEMPTS; attempt += 1) {
      const capture = await runCliShimJsonCommand({
        appPath,
        env,
        args: ["terminal", "capture", terminalId, "--scrollback"],
        label: "Bundled CLI shim terminal capture",
      });
      const lines = Array.isArray(capture?.lines) ? capture.lines : [];
      if (lines.join("\n").includes(marker)) {
        console.log("Packaged desktop smoke: terminal hook command completed");
        return;
      }

      if (attempt < TERMINAL_CAPTURE_ATTEMPTS) {
        await delay(TERMINAL_CAPTURE_INTERVAL_MS);
      }
    }

    throw new Error(`Timed out waiting for terminal capture marker ${marker}`);
  } finally {
    if (terminalId) {
      await runCliShimJsonCommand({
        appPath,
        env,
        args: ["terminal", "kill", terminalId],
        label: "Bundled CLI shim terminal kill",
      }).catch((error) => {
        console.warn(`Packaged desktop smoke: failed to kill terminal ${terminalId}: ${error}`);
      });
    }
    await removeTempDir(cwd);
  }
}

async function stopCliDaemon({ appPath, env }) {
  console.log("Packaged desktop smoke: stopping daemon through bundled CLI shim");
  await runCliShimCommand({
    appPath,
    env,
    args: ["daemon", "stop", "--force"],
    label: "Bundled CLI shim daemon stop",
  });
}

async function assertClipboardAttachment({ page, text, shortcut, prefix }) {
  const input = page.getByRole("textbox", { name: "Message agent..." });
  await input.fill(prefix);
  await input.press(shortcut);
  await input.locator(".composer-reference").filter({ hasText: "@File 1" }).waitFor();
  const pill = page.getByTestId("composer-file-attachment-pill");
  const fileName = (await pill.textContent()).match(/paste-[\da-f-]+\.txt/)?.[0];
  assert.ok(fileName, "Pasted text has a random file name");
  const directory = fs
    .readdirSync(os.tmpdir())
    .find(
      (name) =>
        name.startsWith("paseo-pasted-text-") &&
        fs.existsSync(path.join(os.tmpdir(), name, fileName)),
    );
  assert.ok(directory, "Clipboard file is stored in the host temporary directory");
  const uploadDirectory = path.join(os.tmpdir(), directory);
  try {
    assert.equal(fs.readFileSync(path.join(uploadDirectory, fileName), "utf8"), text);
    assert.ok((await input.getAttribute("data-markdown")).startsWith(`${prefix}[@File 1]`));
    await pill.hover();
    await page.getByRole("button", { name: "Remove file attachment" }).click();
    await input.fill("");
  } finally {
    fs.rmSync(uploadDirectory, { recursive: true, force: true });
  }
}

async function openPasteShortcutSettings(page) {
  await page.getByTestId("sidebar-settings").click();
  await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
  await page.getByTestId("shortcut-actions-paste-as-file").click();
}

async function returnToNewWorkspace(page) {
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/settings"));
  await page.getByTestId("sidebar-global-new-workspace").click();
  await page.waitForURL((url) => url.pathname === "/new");
}

async function assertPasteTextAsFile(page) {
  const text = "  Packaged clipboard fixture 中文 👋\r\nsecond line\n";
  // Stub only this isolated renderer's read; keep the user's system clipboard intact.
  await page.evaluate((value) => {
    if (Object.hasOwn(navigator.clipboard, "readText")) {
      throw new Error("Unexpected clipboard read override");
    }
    Object.defineProperty(navigator.clipboard, "readText", {
      configurable: true,
      value: async () => value,
    });
  }, text);
  try {
    await assertClipboardAttachment({
      page,
      text,
      shortcut: "Meta+Shift+v",
      prefix: "Inspect this ",
    });
    await openPasteShortcutSettings(page);
    await page.getByTestId("shortcut-bind-paste-as-file").click();
    await page.keyboard.press("Meta+Alt+v");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await returnToNewWorkspace(page);
    await assertClipboardAttachment({ page, text, shortcut: "Meta+Alt+v", prefix: "Rebound " });
    await openPasteShortcutSettings(page);
    await page.getByTestId("shortcut-clear-paste-as-file").click();
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("@paseo:keyboard-shortcut-overrides"))[
          "message-input-paste-as-file"
        ] === null,
    );
    await returnToNewWorkspace(page);
    const input = page.getByRole("textbox", { name: "Message agent..." });
    await input.fill("Cleared shortcut");
    await input.press("Meta+Alt+v");
    assert.equal(await page.getByTestId("composer-file-attachment-pill").count(), 0);
    assert.equal(await input.getAttribute("data-markdown"), "Cleared shortcut");
    await input.fill("");
    console.log(
      "Packaged desktop smoke: Cmd+Shift+V attaches exact text as a temporary file; Settings rebind and clear work",
    );
  } finally {
    await page.evaluate(() => {
      delete navigator.clipboard.readText;
    });
  }
}

async function openSmokeWorkspace({ appPath, env, page, daemonHome }) {
  const projectPath = path.join(daemonHome, "sandbox-smoke-project");
  fs.mkdirSync(projectPath);
  fs.writeFileSync(path.join(projectPath, "README.md"), "Packaged Linux sandbox smoke\n");
  for (const extension of ["mp3", "mp4"]) {
    const name = `preview.${extension}`;
    fs.copyFileSync(
      path.resolve(__dirname, "../../app/e2e/support/fixtures", name),
      path.join(projectPath, name),
    );
  }
  const workspace = await runCliShimJsonCommand({
    appPath,
    env,
    args: [
      "workspace",
      "create",
      "--isolation",
      "local",
      "--path",
      projectPath,
      "--title",
      "Sandbox smoke workspace",
    ],
    label: "Create packaged smoke workspace",
  });
  await page.getByRole("button", { name: "Sandbox smoke workspace", exact: true }).click();
  await page.waitForURL((url) => url.pathname.endsWith(`/workspace/${workspace.workspaceId}`));
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page.getByRole("textbox", { name: "Message agent..." }).click();
  console.log(`Packaged desktop smoke: renderer opened workspace ${workspace.workspaceId}`);
}

async function assertMacSidebarLayout(options) {
  const { page } = options;
  await openSmokeWorkspace(options);
  const width = await page.evaluate(() => window.innerWidth);
  await page.mouse.click(width - 40, 100);
  const assertAligned = () =>
    page.waitForFunction(() => {
      const footer = document.querySelector('[data-testid="sidebar-footer"]');
      const navigation = document.querySelector('[data-testid="sidebar-global-new-workspace"]');
      return (
        footer &&
        navigation &&
        Math.abs(footer.getBoundingClientRect().bottom - window.innerHeight) <= 1 &&
        navigation.getBoundingClientRect().top >= 36
      );
    });
  await assertAligned();
  await page.keyboard.press("Meta+b");
  const edge = page.getByTestId("sidebar-edge-trigger");
  await edge.waitFor({ state: "visible" });
  await edge.hover();
  await page.getByTestId("sidebar-edge-preview").waitFor({ state: "visible" });
  await assertAligned();
  await page.mouse.move(width - 40, 400);
  await page.getByTestId("sidebar-edge-preview").waitFor({ state: "detached" });
  await page.keyboard.press("Meta+b");
  await assertAligned();
  await page.getByTestId("sidebar-global-new-workspace").click();
  await page.waitForURL((url) => url.pathname === "/new");
  await assertPasteTextAsFile(page);
  const backgroundDragRegions = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll("*")).filter((node) => {
        const rect = node.getBoundingClientRect();
        return (
          getComputedStyle(node).getPropertyValue("-webkit-app-region") === "drag" &&
          rect.width > window.innerWidth / 2 &&
          rect.height > 100
        );
      }).length,
  );
  if (backgroundDragRegions !== 0) {
    throw new Error(
      "New workspace background has a window-drag region underneath the sidebar preview",
    );
  }
  await page.keyboard.press("Meta+b");
  await edge.waitFor({ state: "visible" });
  const edgeRegion = await edge.evaluate((node) =>
    getComputedStyle(node).getPropertyValue("-webkit-app-region"),
  );
  if (edgeRegion !== "no-drag") {
    throw new Error(`New workspace sidebar edge belongs to the window drag region: ${edgeRegion}`);
  }
  await edge.hover();
  await page.getByTestId("sidebar-edge-preview").waitFor({ state: "visible" });
  await assertAligned();
  await page.getByTestId("sidebar-schedules").click();
  await page.waitForURL((url) => url.pathname === "/schedules");
  await page.mouse.move(width - 40, 400);
  await edge.hover();
  await page.getByTestId("sidebar-edge-preview").waitFor({ state: "visible" });
  await page.getByTestId("sidebar-global-new-workspace").click();
  await page.waitForURL((url) => url.pathname === "/new");
  await page.mouse.move(width - 40, 400);
  await page.getByTestId("sidebar-edge-preview").waitFor({ state: "detached" });
  await edge.hover();
  await page.getByTestId("sidebar-edge-preview").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Sandbox smoke workspace", exact: true }).click();
  await page.waitForURL((url) => url.pathname.includes("/workspace/"));
  console.log(
    "Packaged desktop smoke: sidebars fill the window and New workspace preview supports navigation without background drag regions",
  );
}

async function assertMediaFilePreviews(page) {
  let explorer = page.getByTestId("workspace-explorer-sidebar").filter({ visible: true }).first();
  if ((await explorer.count()) === 0) {
    await page.getByTestId("workspace-explorer-toggle").first().click();
    explorer = page.getByTestId("workspace-explorer-sidebar").filter({ visible: true }).first();
  }
  await explorer.getByTestId("workspace-tab-files").click({ position: { x: 12, y: 13 } });
  const tree = page.getByTestId("file-explorer-tree-scroll").filter({ visible: true }).first();
  await tree.waitFor({ state: "visible" });
  for (const kind of ["audio", "video"]) {
    const extension = kind === "audio" ? "mp3" : "mp4";
    await tree.getByText(`preview.${extension}`, { exact: true }).first().click();
    const testId = `file-${kind}-preview`;
    const player = page.getByTestId(testId);
    await page.waitForFunction((id) => {
      const media = document.querySelector(`[data-testid="${id}"]`);
      return media && media.readyState >= 1 && media.duration > 0;
    }, testId);
    assert.equal(await player.evaluate((media) => media.paused && media.controls), true);
    const handle = await player.elementHandle();
    const box = await player.boundingBox();
    assert.ok(box, `Missing ${kind} player bounds`);
    await player.click({ position: { x: 25, y: box.height - (kind === "video" ? 48 : 25) } });
    await page.waitForFunction((id) => {
      const media = document.querySelector(`[data-testid="${id}"]`);
      return media && !media.paused && media.currentTime > 0;
    }, testId);
    await player.evaluate((media) => {
      media.currentTime = 2;
    });
    await page.waitForFunction((id) => {
      const media = document.querySelector(`[data-testid="${id}"]`);
      return media && !media.seeking && media.currentTime >= 2;
    }, testId);
    const artifactDir = process.env.PASEO_DESKTOP_SMOKE_ARTIFACT_DIR?.trim();
    if (artifactDir) {
      fs.mkdirSync(artifactDir, { recursive: true });
      await page.screenshot({ path: path.join(artifactDir, `${extension}-preview.png`) });
    }
    await tree.getByText("README.md", { exact: true }).first().click();
    await player.waitFor({ state: "detached" });
    assert.equal(await handle.evaluate((media) => media.paused), true);
    console.log(
      `Packaged desktop smoke: ${extension} decoded, played, sought, and paused on tab change`,
    );
  }
}

async function assertSandboxState({ browser, page, expectedSandbox, stdout, stderr }) {
  const diagnostics = await page.evaluate(() =>
    window.paseoDesktop.invoke("desktop_sandbox_diagnostics"),
  );
  if (diagnostics.enabled !== expectedSandbox) {
    throw new Error(
      `Unexpected sandbox decision: ${JSON.stringify(diagnostics)}; expected enabled=${expectedSandbox}`,
    );
  }
  if (!stdout.join("").includes("[desktop] app startup")) {
    throw new Error("Missing production app startup log");
  }
  const session = await browser.newBrowserCDPSession();
  const { processInfo } = await session.send("SystemInfo.getProcessInfo");
  await session.detach();
  const renderers = processInfo.filter((info) => info.type === "renderer");
  if (renderers.length === 0) throw new Error("No renderer process found");
  for (const renderer of renderers) {
    const status = fs.readFileSync(`/proc/${renderer.id}/status`, "utf8");
    const security = status
      .split("\n")
      .filter((line) => /^(NoNewPrivs|Seccomp|Uid|Gid):/.test(line))
      .join("; ");
    const report = `Sandbox evidence: enabled=${expectedSandbox}; ${diagnostics.reason}; renderer ${renderer.id}: ${security}`;
    console.log(report);
    stdout.push(`${report}\n`);
    if (
      expectedSandbox &&
      (!/^NoNewPrivs:\s+1$/m.test(status) || !/^Seccomp:\s+2$/m.test(status))
    ) {
      throw new Error(`Renderer lacks OS sandbox: ${report}\n${stderr.join("")}`);
    }
  }
}

function assertLinuxDesktopIdentity(appPath) {
  if (process.platform === "linux") {
    assert.deepEqual(
      fs.readFileSync(path.join(appPath, "resources", "icon.png")),
      fs.readFileSync(path.join(__dirname, "..", "assets", "icon.png")),
      "Packaged Linux windows must have the Paseo icon at their runtime lookup path",
    );
    const metadata = JSON.parse(
      extractFile(path.join(appPath, "resources", "app.asar"), "package.json").toString(),
    );
    if (metadata.desktopName !== `${EXECUTABLE_NAME}.desktop`) {
      throw new Error(
        `Packaged Linux desktop identity ${JSON.stringify(metadata.desktopName)} does not match ${EXECUTABLE_NAME}.desktop`,
      );
    }
  }
}

async function smokePackagedDesktopApp({
  appPath,
  executablePath = getExecutablePath(appPath),
  launchArgs = [],
  expectedSandbox,
  customDefaults = false,
}) {
  assertExecutable(executablePath, "Packaged app executable");
  assertLinuxDesktopIdentity(appPath);
  await smokeColdCliDaemonStart({ appPath });

  const userData = createTempDir("paseo-smoke-user-data-");
  const daemonHome = createTempDir("paseo-smoke-daemon-home-");
  const daemonPort = customDefaults ? 6770 : await reserveLocalTcpPort();
  let cdpPort = await reserveLocalTcpPort();
  for (let attempt = 0; cdpPort === daemonPort && attempt < 10; attempt += 1) {
    cdpPort = await reserveLocalTcpPort();
  }
  if (cdpPort === daemonPort) {
    throw new Error("Failed to reserve distinct TCP ports for the daemon and CDP");
  }
  const listen = `127.0.0.1:${daemonPort}`;
  if (!customDefaults) configureIsolatedDaemonHome(daemonHome, listen);
  const env = createIsolatedDesktopEnv({
    home: daemonHome,
    listen,
    userData,
    cdpPort,
  });
  if (customDefaults) delete env.PASEO_LISTEN;

  const stdout = [];
  const stderr = [];
  const launch = getLaunchCommand(executablePath, launchArgs);
  console.log(`Packaged desktop smoke: launching ${launch.command} ${launch.args.join(" ")}`);
  const child = spawn(launch.command, launch.args, {
    detached: process.platform !== "win32",
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
  child.once("error", (error) =>
    stderr.push(`Packaged app launch error: ${error.stack ?? error}\n`),
  );
  const deadline = Date.now() + SMOKE_TIMEOUT_MS;

  let browser = null;
  let page = null;
  let daemonStopped = false;

  const stopDaemonForCleanup = async () => {
    if (daemonStopped) {
      return;
    }

    await stopCliDaemon({ appPath, env });
    daemonStopped = true;
  };

  try {
    browser = await connectToPackagedApp({
      child,
      cdpPort,
      stdout,
      stderr,
      userData,
      daemonHome,
      deadline,
    });
    page = await waitForPackagedAppPage(browser, deadline);
    await assertPackagedRendererLoaded(page, deadline);
    console.log("Packaged desktop smoke: real app renderer and preload bridge loaded");
    const status = await waitForRendererStartedDaemon({
      page,
      daemonHome,
      listen,
      stdout,
      stderr,
      userData,
      deadline,
    });
    console.log("Packaged desktop smoke: renderer-started desktop daemon reported running");
    await assertBuiltinPluginsStarted(listen);
    console.log("Packaged desktop smoke: every built-in plugin started");
    await smokeCliShim({ appPath, env });
    await smokeCliTerminal({ appPath, env });
    if (process.platform === "darwin") {
      await assertMacSidebarLayout({ appPath, env, page, daemonHome });
      await assertMediaFilePreviews(page);
    }
    if (expectedSandbox !== undefined) {
      await assertSandboxState({ browser, page, expectedSandbox, stdout, stderr });
      await openSmokeWorkspace({ appPath, env, page, daemonHome });
    }
    await writeSmokeArtifacts({ page, stdout, stderr, userData, daemonHome });
    await stopDaemonForCleanup();
    console.log(
      `Packaged desktop smoke passed: real renderer and preload loaded; renderer-started desktop daemon pid ${status.pid}, listen ${status.listen}; CLI shim daemon status and terminal smoke succeeded`,
    );
  } catch (error) {
    await writeSmokeArtifacts({ page, stdout, stderr, userData, daemonHome, error }).catch(
      (artifactError) => {
        console.warn(`Packaged desktop smoke: failed to write failure artifacts: ${artifactError}`);
      },
    );
    if (!daemonStopped) {
      try {
        await stopDaemonForCleanup();
      } catch {}
    }
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
    if (isRunning(child)) {
      terminateChild(child);
      if (!(await waitForChildExit(child))) {
        terminateChild(child, "SIGKILL");
        await waitForChildExit(child);
      }
    }
    releaseChildHandles(child);
    await removeTempDir(userData);
    await removeTempDir(daemonHome);
  }
}

module.exports = {
  smokePackagedDesktopApp,
};

if (require.main === module) {
  const appIndex = process.argv.indexOf("--app");
  const appPath = appIndex >= 0 ? process.argv[appIndex + 1] : null;
  if (!appPath) {
    process.stderr.write("Usage: node smoke-packaged-desktop-app.js --app <Paseo.app>\n");
    process.exit(2);
  }

  smokePackagedDesktopApp({
    appPath,
    customDefaults: process.argv.includes("--custom-defaults"),
  }).catch((error) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
