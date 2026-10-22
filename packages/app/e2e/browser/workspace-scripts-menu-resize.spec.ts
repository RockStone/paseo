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
