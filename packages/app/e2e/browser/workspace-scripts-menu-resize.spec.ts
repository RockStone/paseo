import { gotoAppShell } from "../support/helpers/app";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import { loadSessionMessageReaders } from "../support/helpers/new-workspace";
import { openNewWorkspaceComposer } from "../support/helpers/new-workspace";
import { launchTrigger } from "../support/helpers/new-workspace-launch";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { test, expect } from "../support/fixtures";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { seedWorkspace } from "../support/helpers/seed-client";
import { expectTerminalOutputContains } from "../support/helpers/new-workspace-launch";
import { createTempGitRepo } from "../support/helpers/workspace";
import {
  connectWorkspaceSetupClient,
  createWorkspaceThroughDaemon,
  openWorkspaceScriptsMenu,
  seedProjectForWorkspaceSetup,
  startWorkspaceScriptFromMenu,
  waitForWorkspaceSetupProgress,
} from "../support/helpers/workspace-setup";
import { waitForWorkspaceTabsVisible } from "../support/helpers/workspace-tabs";
import { getServerId } from "../support/helpers/server-id";
import { buildHostWorkspaceRoute } from "../../src/utils/host-routes";

for (const kind of ["local", "worktree"] as const) {
  test(`Run menu edits and runs the ${kind} config, preserving unrelated fields`, async ({
    page,
  }) => {
    const original = "printf 'original-command\\n'; exec cat";
    const edited = "printf 'edited-command-ready\\n'; exec cat";
    const seeded = await seedWorkspace({
      repoPrefix: "script-edit-",
      repo: {
        paseoConfig: {
          custom: { keep: true },
          scripts: { capture: { command: original, custom: 7 }, other: { command: "echo other" } },
        },
      },
    });
    try {
      let target = { id: seeded.workspaceId, workspaceDirectory: seeded.workspaceDirectory };
      if (kind === "worktree") {
        const created = await seeded.client.createWorkspace({
          source: {
            kind: "worktree",
            cwd: seeded.repoPath,
            projectId: seeded.projectId,
            worktreeSlug: "script-edit-worktree",
          },
        });
        if (!created.workspace) throw new Error(created.error ?? "Workspace creation failed");
        target = created.workspace;
      }
      await page.goto(buildHostWorkspaceRoute(getServerId(), target.id));
      await waitForWorkspaceTabsVisible(page);
      await openWorkspaceScriptsMenu(page);
      const edit = page.getByTestId("script-edit-trigger-capture");
      await edit.hover();
      await page.screenshot({ path: `/tmp/paseoi-r78-${kind}-edit-hover.png` });
      await edit.click();
      await expect(page.getByTestId("script-edit-modal")).toBeVisible();
      await page.getByTestId("script-edit-command").fill(edited);
      await page.getByTestId("script-edit-save").click();
      await expect(page.getByTestId("script-edit-modal")).toHaveCount(0);
      await expect(page.getByText("Project saved", { exact: true })).toBeVisible();
      const actual = JSON.parse(
        await readFile(join(target.workspaceDirectory, "paseo.json"), "utf8"),
      );
      expect(actual).toEqual({
        custom: { keep: true },
        scripts: { capture: { command: edited, custom: 7 }, other: { command: "echo other" } },
      });
      const source = JSON.parse(await readFile(join(seeded.repoPath, "paseo.json"), "utf8"));
      expect(source.scripts.capture.command).toBe(kind === "local" ? edited : original);
      const terminals = await seeded.client.listTerminals(undefined, undefined, {
        workspaceId: target.id,
      });
      expect(terminals.terminals).toHaveLength(0);
      await openWorkspaceScriptsMenu(page);
      await page.getByTestId("workspace-scripts-start-capture").click();
      await expect(page.getByText("Started capture", { exact: true })).toBeVisible();
      await expectTerminalOutputContains(page, "edited-command-ready");
    } finally {
      await seeded.cleanup();
    }
  });
}

test("script editing detects disk conflicts, preserves the draft and supports explicit reload", async ({
  page,
}) => {
  const seeded = await seedWorkspace({
    repoPrefix: "script-conflict-",
    repo: { paseoConfig: { scripts: { capture: { command: "echo original" } } } },
  });
  try {
    await page.goto(buildHostWorkspaceRoute(getServerId(), seeded.workspaceId));
    await waitForWorkspaceTabsVisible(page);
    await openWorkspaceScriptsMenu(page);
    await page.getByTestId("script-edit-trigger-capture").click();
    await page.getByTestId("script-edit-command").fill("echo my draft");
    await writeFile(
      join(seeded.repoPath, "paseo.json"),
      JSON.stringify({
        external: true,
        scripts: { capture: { command: "echo externally changed" } },
      }),
    );
    await page.getByTestId("script-edit-save").click();
    await expect(page.getByTestId("script-editor-error")).toContainText(
      "Reload to fetch the latest",
    );
    await expect(page.getByTestId("script-edit-command")).toHaveValue("echo my draft");
    await expect(page.getByTestId("script-edit-save")).toBeDisabled();
    await page.getByTestId("script-editor-reload").click();
    await expect(page.getByTestId("script-edit-command")).toHaveValue("echo externally changed");
    await page.getByTestId("script-edit-command").fill("echo canceled edit");
    await page.getByTestId("script-edit-cancel").click();
    const config = JSON.parse(await readFile(join(seeded.repoPath, "paseo.json"), "utf8"));
    expect(config).toEqual({
      external: true,
      scripts: { capture: { command: "echo externally changed" } },
    });
  } finally {
    await seeded.cleanup();
  }
});

test("scripts menu resizes when a service row grows after launch", async ({ page }) => {
  const client = await connectWorkspaceSetupClient();
  const repo = await createTempGitRepo("script-menu-resize-", {
    paseoConfig: {
      worktree: {
        setup: ["sh -c 'echo setup complete'"],
      },
      scripts: {
        web: {
          type: "service",
          command:
            "node -e \"const http = require('http'); const s = http.createServer((q,r) => r.end('ok')); s.listen(process.env.PORT || 3000, () => console.log('listening on ' + s.address().port))\"",
        },
      },
    },
  });

  try {
    await seedProjectForWorkspaceSetup(client, repo.path);
    const completed = waitForWorkspaceSetupProgress(
      client,
      (payload) => payload.status === "completed" && payload.detail.log.includes("setup complete"),
    );
    const workspace = await createWorkspaceThroughDaemon(client, {
      cwd: repo.path,
      worktreeSlug: `script-menu-resize-${Date.now()}`,
    });
    await completed;

    await page.goto(buildHostWorkspaceRoute(getServerId(), workspace.id));
    await waitForWorkspaceTabsVisible(page);
    await openWorkspaceScriptsMenu(page);

    const menu = page.getByTestId("workspace-scripts-menu");
    const before = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: rect.height,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      };
    });

    await startWorkspaceScriptFromMenu(page, "web");
    await expect(menu).toContainText("localhost:", { timeout: 15_000 });

    const after = await menu.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const firstChild = element.firstElementChild;
      const childRect = firstChild?.getBoundingClientRect();
      return {
        height: rect.height,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        childHeight: childRect?.height ?? 0,
      };
    });

    expect(after.height).toBeGreaterThan(before.height);
    expect(after.scrollHeight).toBeLessThanOrEqual(after.clientHeight + 1);
    expect(after.childHeight).toBeGreaterThan(before.height);
  } finally {
    await client.close();
    await repo.cleanup();
  }
});

test("shared commands span projects and sequential commands share one terminal which closes immediately", async ({
  page,
}) => {
  const first = await seedWorkspace({ repoPrefix: "shared-commands-first-" });
  const second = await seedWorkspace({ repoPrefix: "shared-commands-second-" });
  let sharedRoot: string | undefined;
  try {
    await page.goto(buildHostWorkspaceRoute(getServerId(), first.workspaceId));
    await waitForWorkspaceTabsVisible(page);
    for (const [name, command] of [
      ["android-capture", "cd /; export CAPTURE_TEST=android; printf 'android-captured\\n'"],
      [
        "iphone-capture",
        'printf \'iphone-captured %s %s\\n\' "$PWD" "${CAPTURE_TEST:-clean}"; sleep 60',
      ],
    ]) {
      await openWorkspaceScriptsMenu(page);
      await expect(page.getByTestId("workspace-scripts-add-shared")).toHaveCount(0);
      await page.getByTestId("workspace-scripts-add").click();
      await page.getByTestId("script-edit-name").fill(name!);
      await page.getByTestId("script-edit-command").fill(command!);
      await page.getByTestId("script-edit-shared-toggle").click();
      await expect(page.getByText("All projects on this host", { exact: true })).toBeVisible();
      await expect(page.getByTestId("script-edit-name")).toHaveValue(name!);
      await expect(page.getByTestId("script-edit-command")).toHaveValue(command!);
      await expect(page.getByTestId("script-edit-save")).toBeEnabled();
      await page.screenshot({ path: `/tmp/paseoi-r85-shared-${name}.png` });
      await page.getByTestId("script-edit-save").click();
      await expect(page.getByTestId("script-edit-modal")).toHaveCount(0);
    }
    const project = await first.client.readProjectConfig(first.repoPath);
    expect(project.ok).toBe(true);
    if (!project.ok) throw new Error("Project config unavailable");
    sharedRoot = project.sharedScriptsRoot;
    expect(project.config?.scripts).toBeUndefined();
    expect(sharedRoot).toBeDefined();
    await page.goto(buildHostWorkspaceRoute(getServerId(), second.workspaceId));
    await waitForWorkspaceTabsVisible(page);
    await openWorkspaceScriptsMenu(page);
    await page.getByTestId("script-edit-trigger-android-capture").click();
    await expect(page.getByText("All projects on this host", { exact: true })).toBeVisible();
    await page.getByTestId("script-edit-cancel").click();
    await page.reload();
    await waitForWorkspaceTabsVisible(page);
    await openWorkspaceScriptsMenu(page);
    await page.getByTestId("workspace-scripts-start-android-capture").click();
    await expectTerminalOutputContains(page, "android-captured");
    await expect
      .poll(
        async () =>
          (await second.client.listWorkspaceScripts(second.workspaceId)).scripts?.find(
            (script) => script.scriptName === "android-capture",
          )?.lifecycle,
      )
      .toBe("stopped");
    const terminals = await second.client.listTerminals(undefined, undefined, {
      workspaceId: second.workspaceId,
    });
    expect(terminals.terminals).toHaveLength(1);
    const terminalId = terminals.terminals[0]!.id;
    await page.keyboard.press("Escape");
    await openWorkspaceScriptsMenu(page);
    await page.getByTestId("workspace-scripts-start-iphone-capture").click();
    await expectTerminalOutputContains(page, `iphone-captured ${second.workspaceDirectory} clean`);
    expect(
      (
        await second.client.listTerminals(undefined, undefined, { workspaceId: second.workspaceId })
      ).terminals.map((terminal) => terminal.id),
    ).toEqual([terminalId]);
    await page.keyboard.press("Escape");
    const tab = page
      .getByTestId(`workspace-tab-terminal_${terminalId}`)
      .filter({ visible: true })
      .first();
    await tab.hover();
    await page
      .getByTestId(`workspace-terminal-close-${terminalId}`)
      .filter({ visible: true })
      .first()
      .click();
    await expect(tab).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (
            await second.client.listTerminals(undefined, undefined, {
              workspaceId: second.workspaceId,
            })
          ).terminals.length,
      )
      .toBe(0);
    await expect(
      page.getByText("Any running process in this terminal will be stopped immediately."),
    ).toHaveCount(0);
  } finally {
    if (sharedRoot) {
      const snapshot = await first.client.readProjectConfig(sharedRoot);
      if (snapshot.ok) {
        const scripts = { ...snapshot.config?.scripts };
        delete scripts["android-capture"];
        delete scripts["iphone-capture"];
        await first.client.writeProjectConfig({
          repoRoot: sharedRoot,
          config: { ...snapshot.config, scripts },
          expectedRevision: snapshot.revision,
        });
      }
    }
    await first.cleanup();
    await second.cleanup();
  }
});

test("Save replaces its label with a spinner without moving the script dialog footer", async ({
  page,
}) => {
  const seeded = await seedWorkspace({ repoPrefix: "script-save-geometry-" });
  const gate = await installDaemonWebSocketGate(page);
  try {
    await page.goto(buildHostWorkspaceRoute(getServerId(), seeded.workspaceId));
    await waitForWorkspaceTabsVisible(page);
    await openWorkspaceScriptsMenu(page);
    await page.getByTestId("workspace-scripts-add").click();
    await page.getByTestId("script-edit-name").fill("geometry-check");
    await page.getByTestId("script-edit-command").fill("echo done");
    const save = page.getByTestId("script-edit-save");
    const cancel = page.getByTestId("script-edit-cancel");
    const saveRect = await save.boundingBox();
    const cancelRect = await cancel.boundingBox();
    if (!saveRect || !cancelRect) throw new Error("Missing script footer geometry");
    const checkPending = async (phase: string) => {
      await gate.waitForHeldClientRequest();
      await expect(save.getByRole("progressbar")).toBeVisible();
      await expect(save.locator('[aria-hidden="true"]')).toHaveCSS("opacity", "0");
      await expect(save).toHaveAccessibleName("Save");
      await expect(save).toBeDisabled();
      expect(await save.boundingBox()).toEqual(saveRect);
      expect(await cancel.boundingBox()).toEqual(cancelRect);
      await page.screenshot({ path: `/tmp/paseoi-r86-save-${phase}.png` });
      gate.releaseHeldClientRequest();
      await expect(save.getByRole("progressbar")).toHaveCount(0);
    };
    gate.holdNextClientRequest("read_project_config_request");
    await page.getByTestId("script-edit-shared-toggle").click();
    await checkPending("scope");
    await expect(save).toBeEnabled();
    await page.getByTestId("script-edit-shared-toggle").click();
    await expect(save).toBeEnabled();
    gate.holdNextClientRequest("write_project_config_request");
    await save.click();
    await checkPending("writing");
    await expect(page.getByTestId("script-edit-modal")).toHaveCount(0);
    const written = await seeded.client.readProjectConfig(seeded.repoPath);
    expect(written).toMatchObject({
      ok: true,
      config: { scripts: { "geometry-check": { command: "echo done" } } },
    });
  } finally {
    await seeded.cleanup();
  }
});

function scriptEditNames(elements: Element[]) {
  return elements.map((element) =>
    element.getAttribute("data-testid")?.replace("script-edit-trigger-", ""),
  );
}

for (const layout of ["desktop", "compact"] as const) {
  for (const surface of ["workspace", "new-workspace"] as const) {
    test(`groups shared commands above workspace commands (${surface}, ${layout})`, async ({
      page,
    }) => {
      const seeded = await seedWorkspace({
        repoPrefix: "script-scope-order-",
        repo: {
          paseoConfig: {
            scripts: {
              app: { command: "echo local app" },
              daemon: { command: "echo local daemon" },
            },
          },
        },
      });
      const project = await seeded.client.readProjectConfig(seeded.repoPath);
      if (!project.ok || !project.sharedScriptsRoot) throw new Error("Missing shared command root");
      const sharedRoot = project.sharedScriptsRoot;
      const original = await seeded.client.readProjectConfig(sharedRoot);
      if (!original.ok) throw new Error("Cannot read shared commands");
      try {
        const saved = await seeded.client.writeProjectConfig({
          repoRoot: sharedRoot,
          expectedRevision: original.revision,
          config: {
            ...original.config,
            scripts: {
              ...original.config?.scripts,
              "Android Screenshot": { command: "echo android" },
              "iPhone Screenshot": { command: "echo iphone" },
              app: { command: "echo shared app shadowed by project" },
            },
          },
        });
        expect(saved.ok).toBe(true);
        if (layout === "compact" && surface === "workspace")
          await page.setViewportSize({ width: 430, height: 932 });
        if (surface === "workspace") {
          await page.goto(buildHostWorkspaceRoute(getServerId(), seeded.workspaceId));
          if (layout === "desktop") {
            await waitForWorkspaceTabsVisible(page);
            await openWorkspaceScriptsMenu(page);
          } else {
            await page.getByTestId("workspace-header-menu-trigger").click();
            await page.getByTestId("workspace-header-scripts").click();
          }
        } else {
          await gotoAppShell(page);
          await waitForSidebarHydration(page);
          await openNewWorkspaceComposer(page, {
            projectKey: seeded.projectKey,
            projectDisplayName: seeded.projectDisplayName,
          });
          if (layout === "compact") await page.setViewportSize({ width: 430, height: 932 });
          await launchTrigger(page).click();
          await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
          await page.getByTestId("new-workspace-scripts-trigger").click();
        }
        const rows = page
          .locator('[data-testid^="script-edit-trigger-"]')
          .filter({ visible: true });
        await expect
          .poll(() => rows.evaluateAll(scriptEditNames))
          .toEqual(["Android Screenshot", "iPhone Screenshot", "app", "daemon"]);
        const divider = page
          .getByTestId("workspace-scripts-scope-divider")
          .filter({ visible: true });
        await expect(divider).toHaveCount(1);
        const shared = await page
          .getByTestId("script-edit-trigger-iPhone Screenshot")
          .filter({ visible: true })
          .boundingBox();
        const local = await page
          .getByTestId("script-edit-trigger-app")
          .filter({ visible: true })
          .boundingBox();
        const split = await divider.boundingBox();
        if (!shared || !local || !split) throw new Error("Missing scope group geometry");
        expect(split.y).toBeGreaterThan(shared.y);
        expect(split.y).toBeLessThan(local.y);
        await page.screenshot({ path: `/tmp/paseoi-r86-grouped-${surface}-${layout}.png` });
      } finally {
        const current = await seeded.client.readProjectConfig(sharedRoot);
        if (current.ok)
          await seeded.client.writeProjectConfig({
            repoRoot: sharedRoot,
            expectedRevision: current.revision,
            config: original.config ?? {},
          });
        await seeded.cleanup();
      }
    });
  }
}

test("Run menu retries a failed scope read without closing", async ({ page }) => {
  const seeded = await seedWorkspace({
    repoPrefix: "script-scope-retry-",
    repo: { paseoConfig: { scripts: { recovered: { command: "echo recovered" } } } },
  });
  const project = await seeded.client.readProjectConfig(seeded.repoPath);
  if (!project.ok || !project.sharedScriptsRoot) throw new Error("Missing shared command root");
  const sharedRoot = project.sharedScriptsRoot;
  const frames = await loadSessionMessageReaders();
  let fail = true;
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((raw) => {
      const request = frames.client(raw);
      if (
        fail &&
        request?.type === "read_project_config_request" &&
        request.repoRoot === sharedRoot
      ) {
        fail = false;
        ws.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "read_project_config_response",
              payload: {
                requestId: request.requestId,
                repoRoot: request.repoRoot,
                ok: false,
                error: { code: "read_failed" },
              },
            },
          }),
        );
        return;
      }
      server.send(raw);
    });
    server.onMessage((raw) => ws.send(raw));
  });
  try {
    await page.goto(buildHostWorkspaceRoute(getServerId(), seeded.workspaceId));
    await waitForWorkspaceTabsVisible(page);
    await openWorkspaceScriptsMenu(page);
    await expect(page.getByTestId("workspace-script-groups-retry")).toBeVisible();
    await page.getByTestId("workspace-script-groups-retry").click();
    await expect(page.getByTestId("script-edit-trigger-recovered")).toBeVisible();
    await expect(page.getByTestId("workspace-script-groups-retry")).toHaveCount(0);
    await expect(page.getByTestId("workspace-scripts-scope-divider")).toHaveCount(0);
  } finally {
    await seeded.cleanup();
  }
});
