import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import {
  expectNewWorkspaceDraft,
  fillNewWorkspaceDraft,
  openNewWorkspaceComposer,
  selectWorkspaceIsolation,
  selectNewWorkspaceProject,
  loadSessionMessageReaders,
} from "../support/helpers/new-workspace";
import {
  composerLocator,
  enterComposerFullscreen,
  exitComposerFullscreen,
  expectComposerFullscreenControls,
  resizeComposerViewport,
} from "../support/helpers/composer";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import {
  expectTerminalLaunchSelected,
  expectTerminalOutputContains,
  expectTerminalPreviewCommand,
  expectWorkspaceOpensWithTerminalTab,
  fillTerminalPrompt,
  launchTrigger,
  selectLaunchOption,
  submitTerminalLaunch,
  terminalLaunchSubmit,
  terminalPromptInput,
  type TerminalProfile,
} from "../support/helpers/new-workspace-launch";

// Someone who wants a terminal agent instead of a chat: they pick a profile
// from the meta-row control, type a prompt, and the daemon actually spawns the
// resolved command with their prompt substituted in — no mocking Paseo's own
// code, the "profile" here is a real, harmless binary the daemon really runs.
//
// The sentinel becomes `$0` (a positional shell parameter, not string
// interpolation into the script source), so the prompt reaches the process
// exactly as typed with no injection risk. `cat` waits for input until project
// cleanup kills the terminal, so attachment does not race a fixed process lifetime.
const PROMPT_PROFILE: TerminalProfile = {
  id: "e2e-echo-prompt",
  name: "Echo Prompt",
  command: "/bin/sh",
  args: ["-c", 'echo captured: "$0"; exec cat', "{{{prompt}}}"],
};

// No sentinel anywhere: takes no prompt, composer goes read-only.
const BARE_PROFILE: TerminalProfile = {
  id: "e2e-echo-bare",
  name: "Bare Echo",
  command: "/bin/sh",
  args: ["-c", "echo bare-launch-static-line; exec cat"],
};

test.use({
  e2eDaemonConfig: { version: 1, daemon: { terminalProfiles: [PROMPT_PROFILE, BARE_PROFILE] } },
});

async function failFirstScriptRequests(page: Page, repoRoot: string): Promise<string[]> {
  const frames = await loadSessionMessageReaders();
  let readFailures = 1;
  let launchFailures = 1;
  const launchWorkspaceIds: string[] = [];
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const request = frames.client(message);
      if (
        request?.type === "read_project_config_request" &&
        request.repoRoot === repoRoot &&
        readFailures-- > 0
      ) {
        ws.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "read_project_config_response",
              payload: {
                requestId: request.requestId,
                repoRoot: request.repoRoot,
                ok: false,
                error: { code: "invalid_project_config" },
              },
            },
          }),
        );
        return;
      }
      if (request?.type === "start_workspace_script_request") {
        launchWorkspaceIds.push(request.workspaceId);
        if (launchFailures-- > 0) {
          ws.send(
            JSON.stringify({
              type: "session",
              message: {
                type: "start_workspace_script_response",
                payload: {
                  requestId: request.requestId,
                  workspaceId: request.workspaceId,
                  scriptName: request.scriptName,
                  terminalId: null,
                  error: "Preview launch failed; retry",
                },
              },
            }),
          );
          return;
        }
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
  return launchWorkspaceIds;
}

async function failFirstConfigWrite(page: Page) {
  const frames = await loadSessionMessageReaders();
  let fail = true;
  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const request = frames.client(message);
      if (fail && request?.type === "write_project_config_request") {
        fail = false;
        ws.send(
          JSON.stringify({
            type: "session",
            message: {
              type: "write_project_config_response",
              payload: {
                requestId: request.requestId,
                repoRoot: request.repoRoot,
                ok: false,
                error: { code: "write_failed" },
              },
            },
          }),
        );
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
}

test.describe("New workspace: launching a terminal", () => {
  let workspace: SeededWorkspace;

  test.beforeEach(async () => {
    workspace = await seedWorkspace({
      repoPrefix: "launch-terminal-",
      repo: {
        paseoConfig: {
          scripts: {
            preview: { command: "printf 'configured-script-ready '; basename \"$PWD\"; exec cat" },
          },
        },
      },
    });
  });

  test.afterEach(async () => {
    await workspace?.cleanup();
  });

  test("compact Run menu adds a command before a workspace exists and retries failed saves", async ({
    page,
  }) => {
    await failFirstConfigWrite(page);
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await openNewWorkspaceComposer(page, {
      projectKey: workspace.projectKey,
      projectDisplayName: workspace.projectDisplayName,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await launchTrigger(page).click();
    await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
    await page.getByTestId("new-workspace-scripts-trigger").click();
    await page.getByTestId("workspace-scripts-add").click();
    await page.getByTestId("script-edit-name").fill("capture");
    await page.getByTestId("script-edit-command").fill("printf 'new-command-ready\\n'; exec cat");
    await page.getByTestId("script-edit-save").click();
    await expect(page.getByTestId("script-editor-error")).toBeVisible();
    await expect(page.getByTestId("script-edit-command")).toHaveValue(
      "printf 'new-command-ready\\n'; exec cat",
    );
    await page.getByTestId("script-editor-reload").click();
    await expect(page.getByTestId("script-edit-modal")).toHaveCount(0);
    await expect(page.getByText("Project saved", { exact: true })).toBeVisible();
    const workspaces = await workspace.client.fetchWorkspaces({
      filter: { projectId: workspace.projectId },
    });
    expect(workspaces.entries).toHaveLength(1);
    await page.getByTestId("new-workspace-scripts-trigger").click();
    await expect(page.getByTestId("script-edit-trigger-capture")).toBeVisible();
    await page.screenshot({ path: "/tmp/paseoi-r78-compact-command-editor.png" });
    await page.getByRole("menuitem", { name: "capture", exact: true }).click();
    await expect(page.locator('[data-testid="terminal-surface"]:visible').first()).toBeVisible({
      timeout: 30_000,
    });
    await expectTerminalOutputContains(page, "new-command-ready");
  });

  for (const isolation of ["local", "worktree"] as const) {
    test(`runs a configured script in a new ${isolation} workspace without a chat`, async ({
      page,
    }) => {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });
      await selectLaunchOption(page, "chat");
      await expect(page.getByTestId("new-workspace-scripts-trigger")).toHaveCount(0);
      await selectLaunchOption(page, "blank");
      await selectWorkspaceIsolation(page, isolation);
      await fillTerminalPrompt(page, "preserve my separate terminal draft");
      await page.getByTestId("new-workspace-scripts-trigger").click();
      await page.screenshot({ path: `/tmp/paseoi-r77-${isolation}-run.png` });
      await page.getByTestId("new-workspace-script-preview").click();
      await expectWorkspaceOpensWithTerminalTab(page);
      await expectTerminalOutputContains(page, "configured-script-ready");
      const { entries } = await workspace.client.fetchWorkspaces({
        filter: { projectId: workspace.projectId },
      });
      const created = entries.filter((entry) => entry.id !== workspace.workspaceId);
      expect(created).toHaveLength(1);
      expect(created[0].workspaceDirectory === workspace.repoPath).toBe(isolation === "local");
      const directoryName = created[0].workspaceDirectory.split("/").pop();
      await expectTerminalOutputContains(page, `configured-script-ready ${directoryName}`);
      const agents = await workspace.client.fetchAgents({ scope: "active" });
      expect(
        agents.entries.filter((entry) => entry.agent.workspaceId === created[0].id),
      ).toHaveLength(0);
    });
  }

  test("script config and launch failures retain the draft and retry the same workspace", async ({
    page,
  }) => {
    const launchWorkspaceIds = await failFirstScriptRequests(page, workspace.repoPath);
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await openNewWorkspaceComposer(page, {
      projectKey: workspace.projectKey,
      projectDisplayName: workspace.projectDisplayName,
    });
    await selectLaunchOption(page, "blank");
    await selectWorkspaceIsolation(page, "local");
    const trigger = page.getByTestId("new-workspace-scripts-trigger");
    await trigger.click();
    await expect(page.getByText("paseo.json couldn't be parsed", { exact: true })).toBeVisible();
    await page.getByTestId("new-workspace-scripts-retry").click();
    await fillTerminalPrompt(page, "keep this typed command on failure");
    await trigger.click();
    await page.getByTestId("new-workspace-script-preview").click();
    await expect(
      page.getByText("Preview launch failed; retry", { exact: true }).first(),
    ).toBeVisible();
    await expect(terminalPromptInput(page)).toHaveText("keep this typed command on failure");
    await trigger.click();
    await page.getByTestId("new-workspace-script-preview").click();
    await expectWorkspaceOpensWithTerminalTab(page);
    await expectTerminalOutputContains(page, "configured-script-ready");
    expect(launchWorkspaceIds).toHaveLength(2);
    expect(launchWorkspaceIds[1]).toBe(launchWorkspaceIds[0]);
    const workspaces = await workspace.client.fetchWorkspaces({
      filter: { projectId: workspace.projectId },
    });
    expect(workspaces.entries.filter((entry) => entry.id !== workspace.workspaceId)).toHaveLength(
      1,
    );
  });

  test("script choices follow the selected project and stay usable on a compact screen", async ({
    page,
  }) => {
    const other = await seedWorkspace({ repoPrefix: "other-script-project-" });
    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });
      await selectLaunchOption(page, "blank");
      await page.getByTestId("new-workspace-scripts-trigger").click();
      await expect(page.getByTestId("new-workspace-script-preview")).toBeVisible();
      await page.screenshot({ path: "/tmp/paseoi-r77-desktop-run.png" });
      await page.keyboard.press("Escape");
      await selectNewWorkspaceProject(page, {
        projectKey: other.projectKey,
        projectDisplayName: other.projectDisplayName,
      });
      await selectLaunchOption(page, "blank");
      await page.getByTestId("new-workspace-scripts-trigger").click();
      await expect(page.getByTestId("new-workspace-script-preview")).toHaveCount(0);
      await expect(page.getByTestId("workspace-scripts-add")).toBeVisible();
      await page.keyboard.press("Escape");
      await selectNewWorkspaceProject(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });
      await selectLaunchOption(page, "blank");
      await page.setViewportSize({ width: 390, height: 844 });
      await launchTrigger(page).click();
      await page.getByRole("menuitem", { name: "Terminal", exact: true }).click();
      const trigger = page.getByTestId("new-workspace-scripts-trigger");
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click();
      const option = page.getByRole("menuitem", { name: "preview", exact: true });
      await expect(option).toBeVisible();
      await page.screenshot({ path: "/tmp/paseoi-r77-compact-run.png" });
      await option.click();
      await expect(page.locator('[data-testid="terminal-surface"]:visible').first()).toBeVisible({
        timeout: 30_000,
      });
      await expectTerminalOutputContains(page, "configured-script-ready");
    } finally {
      await other.cleanup();
    }
  });

  test("a profile that takes a prompt launches with it as its trailing argument; a profile without the sentinel launches bare from Launch", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await gotoAppShell(page);
    await waitForSidebarHydration(page);

    await test.step("pick a profile that takes a prompt, type one, and submit", async () => {
      await openNewWorkspaceComposer(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });
      await selectLaunchOption(page, PROMPT_PROFILE.id);
      await expectTerminalLaunchSelected(page, PROMPT_PROFILE.name);

      await fillTerminalPrompt(page, "fix the flaky test");
      await submitTerminalLaunch(page);
    });

    await test.step("the workspace opens with a terminal tab, and the profile received the prompt", async () => {
      await expectWorkspaceOpensWithTerminalTab(page);
      await expectTerminalOutputContains(page, "captured: fix the flaky test");
    });

    await test.step("a profile without the sentinel is read-only and shows the resolved command", async () => {
      await openNewWorkspaceComposer(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });
      await selectLaunchOption(page, BARE_PROFILE.id);
      await expect(terminalPromptInput(page)).toHaveCount(0);
      await expectTerminalPreviewCommand(page, "/bin/sh -c echo bare-launch-static-line; exec cat");
      await expect(terminalLaunchSubmit(page)).toHaveText("Launch");
    });

    await test.step("Launch starts the profile bare, with no prompt to send", async () => {
      await submitTerminalLaunch(page);
      await expectWorkspaceOpensWithTerminalTab(page);
      await expectTerminalOutputContains(page, "bare-launch-static-line");
    });
  });

  test("switching terminal profiles restores the prompt and its fullscreen affordance", async ({
    page,
  }) => {
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await openNewWorkspaceComposer(page, {
      projectKey: workspace.projectKey,
      projectDisplayName: workspace.projectDisplayName,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const prompt = "First replacement line\nSecond replacement line\nThird replacement line";
    const selectProfile = async (profile: TerminalProfile) => {
      await launchTrigger(page).click();
      const option = page.getByRole("menuitem").filter({ hasText: profile.name });
      await option.click();
      await expect(option).not.toBeVisible();
    };
    const fullscreen = page.getByRole("button", { name: "Fullscreen", exact: true });

    await test.step("restore a multiline prompt after a read-only profile", async () => {
      await selectProfile(PROMPT_PROFILE);
      await fillTerminalPrompt(page, prompt);
      await expect(fullscreen).toBeVisible();
      await selectProfile(BARE_PROFILE);
      await expect(terminalPromptInput(page)).toHaveCount(0);
      await selectProfile(PROMPT_PROFILE);
      await expect(terminalPromptInput(page)).toHaveAttribute("data-markdown", prompt);
      await expect(fullscreen).toBeVisible();
    });

    await test.step("restore the locally edited prompt and measure subsequent typing", async () => {
      await fillTerminalPrompt(page, "Short draft");
      await expect(fullscreen).toHaveCount(0);
      await selectProfile(BARE_PROFILE);
      await selectProfile(PROMPT_PROFILE);
      await expect(terminalPromptInput(page)).toHaveAttribute("data-markdown", "Short draft");
      await expect(fullscreen).toHaveCount(0);
      await terminalPromptInput(page).press("End");
      await terminalPromptInput(page).press("Shift+Enter");
      await terminalPromptInput(page).pressSequentially("Second");
      await terminalPromptInput(page).press("Shift+Enter");
      await terminalPromptInput(page).pressSequentially("Third");
      await expect(terminalPromptInput(page)).toHaveAttribute(
        "data-markdown",
        "Short draft\nSecond\nThird",
      );
      await expect(fullscreen).toBeVisible();
    });
  });
});

async function expectNewWorkspaceHeaderHidden(page: Page): Promise<void> {
  await expect(page.getByTestId("menu-button").filter({ visible: true })).toHaveCount(0);
}

async function expectNewWorkspaceHeaderVisible(page: Page): Promise<void> {
  await expect(page.getByTestId("menu-button").filter({ visible: true }).first()).toBeVisible();
}

/**
 * Fullscreen fills the content area top to bottom and out to the right edge (a pinned
 * sidebar keeps its column), covers the form, and shows only exit and the mode's submit.
 */
async function expectNewWorkspaceFullscreen(page: Page, submitLabel: string): Promise<void> {
  const frame = page.getByTestId("composer-fullscreen");
  await expect(page.getByRole("button", { name: "Exit fullscreen", exact: true })).toBeVisible();
  await expect(frame.getByRole("button")).toHaveCount(2);
  await expect(frame.getByRole("button", { name: submitLabel })).toBeVisible();
  await expectNewWorkspaceHeaderHidden(page);
  const picker = (await page.getByRole("button", { name: "Workspace project" }).boundingBox())!;
  await expect
    .poll(() =>
      frame.evaluate(
        (element, point) => {
          const viewport = window.visualViewport!;
          const box = element.getBoundingClientRect();
          const covering = document.elementFromPoint(point.x, point.y);
          return {
            fillsHeight:
              Math.abs(box.top - viewport.offsetTop) < 1 &&
              Math.abs(box.height - viewport.height) < 1,
            reachesRightEdge:
              Math.abs(box.right - (viewport.offsetLeft + viewport.width)) < 1 &&
              box.left >= viewport.offsetLeft,
            coversForm: element.contains(covering),
          };
        },
        { x: picker.x + picker.width / 2, y: picker.y + picker.height / 2 },
      ),
    )
    .toEqual({ fillsHeight: true, reachesRightEdge: true, coversForm: true });
}

test.describe("New workspace: fullscreen composer across the compact breakpoint", () => {
  let workspace: SeededWorkspace;

  test.beforeEach(async () => {
    workspace = await seedWorkspace({ repoPrefix: "launch-fullscreen-" });
  });

  test.afterEach(async () => {
    await workspace?.cleanup();
  });

  test("chat fullscreen survives widening and terminal fullscreen fills the phone", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await gotoAppShell(page);
    await waitForSidebarHydration(page);
    await openNewWorkspaceComposer(page, {
      projectKey: workspace.projectKey,
      projectDisplayName: workspace.projectDisplayName,
    });
    const projectPicker = page.getByRole("button", { name: "Workspace project" });

    await test.step("chat: fullscreen covers the centered form and exits back into it", async () => {
      await resizeComposerViewport(page, "portrait");
      const draft = "Chat first line\nChat second line\nChat third line";
      await fillNewWorkspaceDraft(page, draft);
      await enterComposerFullscreen(page);
      await expectComposerFullscreenControls(page);
      await expectNewWorkspaceHeaderHidden(page);
      await resizeComposerViewport(page, "landscape");
      await expectComposerFullscreenControls(page);
      await expectNewWorkspaceFullscreen(page, "Create");
      // The desktop form's own import button is dropped from the fullscreen slot.
      await expect(
        page.getByTestId("new-workspace-import-session").filter({ visible: true }),
      ).toHaveCount(0);
      await composerLocator(page).press("End");
      await composerLocator(page).pressSequentially(" wide");
      await exitComposerFullscreen(page);
      await expectNewWorkspaceHeaderVisible(page);
      await expect(projectPicker).toBeVisible();
      await expect(
        page.getByTestId("new-workspace-import-session").filter({ visible: true }),
      ).toBeVisible();
      await expectNewWorkspaceDraft(page, `${draft} wide`);
    });

    // Exercise the terminal prompt's fullscreen and compact launch sheet on the phone.
    await test.step("terminal: the prompt's fullscreen shows only exit and Launch", async () => {
      await resizeComposerViewport(page, "portrait");
      // The compact launch control opens a sheet, not the desktop menu.
      await launchTrigger(page).click();
      const option = page.getByRole("menuitem").filter({ hasText: PROMPT_PROFILE.name });
      await option.click();
      await expect(option).not.toBeVisible();
      await expectTerminalLaunchSelected(page, PROMPT_PROFILE.name);
      const prompt = "Prompt first line\nPrompt second line\nPrompt third line";
      await fillTerminalPrompt(page, prompt);
      await enterComposerFullscreen(page);
      await expect(terminalPromptInput(page)).toBeVisible();
      await expectNewWorkspaceFullscreen(page, "Launch");
      await exitComposerFullscreen(page);
      await expectNewWorkspaceHeaderVisible(page);
      await expect(projectPicker).toBeVisible();
      await expect(terminalPromptInput(page)).toHaveAttribute("data-markdown", prompt);
    });
  });
});
