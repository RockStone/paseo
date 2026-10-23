import { expect, test } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import {
  withAcpStreamingMarkdown,
  requestAcpMarkdown,
  expectAcpMarkdown,
  reloadAcpMarkdown,
} from "../support/helpers/acp-streaming-markdown";
import {
  expectFinishedMarkdown,
  expectReloadedMarkdown,
  expectUnfinishedBold,
  expectUnfinishedLink,
  requestStreamingMarkdown,
  withStreamingMarkdown,
} from "../support/helpers/streaming-markdown";

test("user code blocks stay within the conversation width", async ({ page }, testInfo) => {
  const message = [
    "A quoted Markdown example:",
    "```markdown",
    "My fork has carried a fix for this since August; it changes setupFinishNotification.",
    `https://github.com/example/paseo/blob/${"a".repeat(40)}/packages/server/src/server/agent/agent-prompt.ts#L558-L566`,
    "```",
  ].join("\n");
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "user-code-width-",
    title: "User code width",
    initialPrompt: message,
  });
  try {
    await openAgentRoute(page, agent);
    const row = page.getByTestId("user-message").filter({ hasText: "A quoted Markdown example:" });
    const bubble = row.getByTestId("user-message-bubble");
    await expect(bubble).toBeVisible();
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await expect
        .poll(() =>
          row.evaluate((element) => {
            const rowBounds = element.getBoundingClientRect();
            const bubbleElement = element.querySelector('[data-testid="user-message-bubble"]')!;
            const bounds = bubbleElement.getBoundingClientRect();
            return (
              bounds.left >= rowBounds.left - 1 &&
              bounds.right <= rowBounds.right + 1 &&
              bubbleElement.scrollWidth <= bubbleElement.clientWidth + 1
            );
          }),
        )
        .toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`user-code-width-${width}.png`) });
    }
  } finally {
    await agent.cleanup();
  }
});

test("formats unfinished Markdown while streaming and preserves the completed rendering", async ({
  page,
}, testInfo) => {
  await withStreamingMarkdown(page, testInfo, async (agent) => {
    await requestStreamingMarkdown(agent);
    await expectUnfinishedBold(page);
    await expectUnfinishedLink(page, agent, testInfo);
    await expectFinishedMarkdown(page, agent, testInfo);
    await expectReloadedMarkdown(page);
  });
});

for (const width of [1100, 390]) {
  test(`ACP plugin chunks preserve Markdown and separate turns at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await withAcpStreamingMarkdown(page, async (agent) => {
      await requestAcpMarkdown(agent);
      await expectAcpMarkdown(page, 1);
      await requestAcpMarkdown(agent);
      await expectAcpMarkdown(page, 2);
      await reloadAcpMarkdown(page, testInfo);
    });
  });
}
