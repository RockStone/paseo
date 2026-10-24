import { waitForTimelineGeometryToSettle } from "../support/helpers/timeline-pagination";
import { composerLocator } from "../support/helpers/composer";
import type { BrowserContext, Locator } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { openAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

const CROSS_STRUCTURE_MARKDOWN = [
  "# P1 — High-value UI behavior",
  "",
  "5. Claude model and thinking preferences",
  "",
  "   - Switch Claude models and confirm each model retains its own thinking choice.",
  "   - Cover new-workspace drafts, queued launches, schedules, and editing existing schedules.",
  "   - Confirm Opus 5 exposes the Fast toggle.",
  "   - Smoke with an older saved Fabel/model alias and with daemon/client version drift.",
  "",
  "6. Chat, composer, and timeline stability",
].join("\n");

const ASSISTANT_MARKDOWN = [
  CROSS_STRUCTURE_MARKDOWN,
  "",
  "Direct matches:",
  "",
  "Formatted **strong prose**, _emphasized prose_, and ~~struck prose~~.",
  "",
  "- **[First issue](https://example.com/issues/1)**: exact `apply_patch` failure.",
  "- [Second issue](https://example.com/issues/2): repeated sandbox setup.",
  "",
  "5. Fifth item",
  "6. Sixth item",
  "7. Seventh item",
  "8. Eighth item",
  "",
  "Nested list:",
  "",
  "3. Outer three",
  "",
  "   7. Inner seven",
  "   8. Inner eight",
  "   9. Inner nine",
  "",
  "A hard break  ",
  "stays hard.",
  "",
  "www.example.com stays plain Markdown text.",
  "",
  '[docs](https://docs.example.com "Reference") and <https://autolink.example.com>.',
  "",
  "[workspace file](file:///tmp/paseo%20notes.md#L4)",
  "",
  "`https://example.com/generated` stays code, not a generated link.",
  "",
  "```typescript",
  'const answer = "yes";',
  "  return answer;",
  "```",
  "",
  "After code.",
  "",
  "```bash",
  "echo trailing",
  "",
  "```",
  "",
  "````text",
  "before",
  "```",
  "after",
  "````",
  "",
  "| Left | Right | Center |",
  "| :-- | --: | :-: |",
  "| Current \\| active | ~~obsolete~~ | ready |",
].join("\n");

const EXPECTED_WHOLE_SELECTION_MARKDOWN = ASSISTANT_MARKDOWN.replace(
  "www.example.com stays",
  "[www.example.com](http://www.example.com) stays",
)
  .replace(
    "`https://example.com/generated` stays",
    "[`https://example.com/generated`](https://example.com/generated) stays",
  )
  .replace(`${CROSS_STRUCTURE_MARKDOWN}\n\n`, "")
  .replace(
    "<https://autolink.example.com>",
    "[https://autolink.example.com](https://autolink.example.com)",
  )
  .replace(
    "3. Outer three\n\n   7. Inner seven\n   8. Inner eight\n   9. Inner nine",
    "3. Outer three\n    7. Inner seven\n    8. Inner eight\n    9. Inner nine",
  )
  // Rendering drops the blank line before a closing fence, so copying cannot bring it
  // back. The fence is here to cover a body that ends in more than one newline.
  .replace("```bash\necho trailing\n\n```", "```bash\necho trailing\n```");

interface ClipboardContent {
  html: string;
  plainText: string;
}

async function allowRichClipboard(context: BrowserContext): Promise<void> {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
}

/**
 * Locate assistant rows by source-message identity.
 */
function assistantMessageBlocks(page: Page): Locator {
  return page.locator("[data-message-id]").filter({ has: page.getByTestId("assistant-message") });
}

async function selectStructuredClipboardFixture(page: Page): Promise<void> {
  await selectAssistantTextRange(page, "Direct matches:", "ready");
}

async function selectAssistantElement(page: Page, selector: string): Promise<void> {
  const assistantMessage = assistantMessageBlocks(page);
  await assistantMessage.locator(selector).evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
}

/**
 * Select an element from the end of the text before it. A drag that starts in the gap
 * above a block anchors there, so nothing outside the element is highlighted.
 */
async function selectAssistantElementFromEndOf(
  page: Page,
  startText: string,
  selector: string,
): Promise<void> {
  await assistantMessageBlocks(page).evaluateAll(
    (blocks, selected) => {
      let startNode: Text | null = null;
      for (const block of blocks) {
        const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (walker.currentNode.textContent?.endsWith(selected.startText)) {
            startNode = walker.currentNode as Text;
          }
        }
      }
      const end = blocks.map((block) => block.querySelector(selected.selector)).find(Boolean);
      if (!startNode || !end) {
        throw new Error(`Could not find ${selected.startText} — ${selected.selector}`);
      }
      const range = document.createRange();
      range.setStart(startNode, startNode.length);
      range.setEnd(end, end.childNodes.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    { startText, selector },
  );
}

/** A drag over an image alone selects it inside its rendered frame. */
async function selectAssistantImage(page: Page): Promise<void> {
  await assistantMessageBlocks(page)
    .locator("img")
    .evaluate((element) => {
      const range = document.createRange();
      range.selectNode(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
}

/** Press in the gap below the image and drag to the end of `text` in the block after it. */
async function dragFromBelowImageTo(page: Page, text: string): Promise<void> {
  const blocks = assistantMessageBlocks(page);
  const target = blocks.getByText(text);
  await target.scrollIntoViewIfNeeded();
  const frame = await blocks.locator("img").boundingBox();
  const end = await target.evaluate((element, selectedText) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const offset = node.textContent?.indexOf(selectedText) ?? -1;
      if (offset >= 0) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + selectedText.length);
        const box = range.getBoundingClientRect();
        return { x: box.right - 1, y: box.top + box.height / 2, left: box.left };
      }
    }
    throw new Error(`Could not find ${selectedText}`);
  }, text);
  if (!frame) {
    throw new Error("Expected a rendered image");
  }
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.mouse.move(end.left + 1, end.y - 14);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
}

async function selectAssistantText(page: Page, text: string): Promise<void> {
  await selectAssistantTextRange(page, text, text);
}

async function selectAssistantListItemFromMarker(
  page: Page,
  listTag: "ol" | "ul",
  itemText: string,
  endText: string,
): Promise<void> {
  const assistantMessage = assistantMessageBlocks(page);
  const item = assistantMessage
    .locator(listTag)
    .filter({ hasText: itemText })
    .locator(":scope > li")
    .filter({ hasText: itemText });

  await item.evaluate((element, selectedEndText) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let endNode: Text | null = null;
    let endOffset = -1;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const offset = node.textContent?.indexOf(selectedEndText) ?? -1;
      if (node instanceof Text && offset >= 0) {
        endNode = node;
        endOffset = offset + selectedEndText.length;
        break;
      }
    }
    if (!endNode) {
      throw new Error(`Could not find list item selection end: ${selectedEndText}`);
    }

    const range = document.createRange();
    range.setStart(element, 0);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, endText);
}

async function doubleClickAssistantMarkdownText(
  page: Page,
  tag: "code" | "strong",
  text: string,
): Promise<void> {
  const assistantMessage = assistantMessageBlocks(page);
  await assistantMessage
    .locator(tag)
    .filter({ hasText: text })
    .dblclick({ position: { x: 5, y: 5 } });
}

async function selectAssistantTextRange(
  page: Page,
  startText: string,
  endText: string,
): Promise<void> {
  await assistantMessageBlocks(page).evaluateAll(
    (blocks, selectedRange) => {
      // The message's text nodes in reading order, across every block row.
      const nodes: Text[] = [];
      for (const block of blocks) {
        const blockWalker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let found = blockWalker.nextNode();
        while (found) {
          nodes.push(found as Text);
          found = blockWalker.nextNode();
        }
      }
      const text = nodes.map((node) => node.data).join("");
      const start = text.indexOf(selectedRange.startText);
      const end = text.indexOf(selectedRange.endText, start);
      if (start < 0 || end < 0)
        throw new Error(
          `Could not find assistant text range: ${selectedRange.startText} — ${selectedRange.endText}`,
        );
      const boundary = (offset: number, isEnd = false): [Text, number] => {
        for (const node of nodes) {
          if (offset < node.length || (isEnd && offset === node.length)) return [node, offset];
          offset -= node.length;
        }
        throw new Error("Selection extends beyond message");
      };
      const range = document.createRange();
      range.setStart(...boundary(start));
      range.setEnd(...boundary(end + selectedRange.endText.length, true));
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    { startText, endText },
  );
}

/**
 * Select from `startText` into the middle of the next rendered code line.
 *
 * Highlighted code splits a line across one text node per syntax token and puts the
 * newline in a node of its own, so this is a partial selection that crosses a line
 * break — the shape whose whitespace Turndown would collapse.
 */
async function selectAssistantAcrossCodeLines(
  page: Page,
  startText: string,
  endText: string,
): Promise<void> {
  await assistantMessageBlocks(page).evaluateAll(
    (blocks, selectedRange) => {
      // The message's text nodes in reading order, across every block row.
      const nodes: Text[] = [];
      for (const block of blocks) {
        const blockWalker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
        let found = blockWalker.nextNode();
        while (found) {
          nodes.push(found as Text);
          found = blockWalker.nextNode();
        }
      }
      let cursor = 0;
      const walker = { nextNode: () => nodes[cursor++] ?? null };
      let startNode: Node | null = null;
      let startOffset = -1;
      let textNode = walker.nextNode();
      while (textNode) {
        if (!startNode) {
          const offset = textNode.textContent?.indexOf(selectedRange.startText) ?? -1;
          if (offset >= 0) {
            startNode = textNode;
            startOffset = offset;
          }
          textNode = walker.nextNode();
          continue;
        }
        const endOffset = textNode.textContent?.indexOf(selectedRange.endText) ?? -1;
        if (endOffset >= 0) {
          const range = document.createRange();
          range.setStart(startNode, startOffset);
          range.setEnd(textNode, endOffset + selectedRange.endText.length);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          return;
        }
        textNode = walker.nextNode();
      }
      throw new Error(
        `Could not find a code range: ${selectedRange.startText} — ${selectedRange.endText}`,
      );
    },
    { startText, endText },
  );
}

async function clickSelectionCopy(page: Page): Promise<void> {
  const button = page.getByTestId("copy-selection");
  await button.click();
  await expect(page.getByTestId("selection-actions")).toHaveCount(0);
}

async function copySelection(page: Page): Promise<void> {
  await page.keyboard.press("ControlOrMeta+c");
}

/** Some older copy controls write only text/plain. */
async function readPlainClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

async function denyClipboardUntilAllowed(page: Page): Promise<void> {
  await page.evaluate(() => {
    let denied = true;
    window.addEventListener("allow-test-clipboard", () => {
      denied = false;
    });
    for (const method of ["write", "writeText"] as const) {
      const original = navigator.clipboard[method].bind(navigator.clipboard);
      Object.defineProperty(navigator.clipboard, method, {
        configurable: true,
        value: (...args: unknown[]) => {
          if (denied) return Promise.reject(new DOMException("Denied", "NotAllowedError"));
          return Reflect.apply(original, navigator.clipboard, args);
        },
      });
    }
    const original = document.execCommand.bind(document);
    document.execCommand = (...args: Parameters<typeof document.execCommand>) => {
      if (denied && args[0] === "copy") throw new DOMException("Denied", "NotAllowedError");
      return original(...args);
    };
  });
}

async function readRichClipboard(page: Page): Promise<ClipboardContent> {
  return page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items[0];
    if (!item) {
      throw new Error("Expected clipboard content");
    }
    return {
      html: await (await item.getType("text/html")).text(),
      plainText: await (await item.getType("text/plain")).text(),
    };
  });
}

test("copying an assistant selection preserves Markdown structure and links", async ({
  context,
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ uiFontFamily: "serif" }));
  });
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "assistant-selection-copy-",
    title: "Assistant selection copy",
    initialPrompt: "Render the clipboard fixture.",
    featureValues: { mockAssistantResponse: ASSISTANT_MARKDOWN },
  });

  try {
    await allowRichClipboard(context);
    await agent.client.waitForAgentUpsert(
      agent.agentId,
      (snapshot) => snapshot.status === "idle",
      30_000,
    );
    await openAgentRoute(page, agent);

    const assistantMessage = assistantMessageBlocks(page);
    for (const [tag, text] of [
      ["strong", "strong prose"],
      ["em", "emphasized prose"],
      ["s", "struck prose"],
    ]) {
      const formattedProse = assistantMessage.locator(tag).filter({ hasText: text });
      await expect(formattedProse).toHaveCSS("font-family", "serif");
      await expect(formattedProse).not.toHaveAttribute("data-pmono");
    }
    const inlineCode = assistantMessage.locator("code").filter({ hasText: "apply_patch" });
    await expect(inlineCode).toHaveCSS("font-family", /monospace|Mono/);

    await selectStructuredClipboardFixture(page);
    await copySelection(page);

    const clipboard = await readRichClipboard(page);
    expect(clipboard.plainText).toBe(EXPECTED_WHOLE_SELECTION_MARKDOWN);
    expect(clipboard.html).not.toContain("<ul>");
    expect(clipboard.html).not.toContain("<li>");
    expect(clipboard.html).toContain("<div>- ");
    expect(clipboard.html).toContain(
      '<strong><a href="https://example.com/issues/1">First issue</a></strong>',
    );
    expect(clipboard.html).toContain("<code>apply_patch</code>");
    expect(clipboard.html).toContain("<div>5. Fifth item</div>");
    expect(clipboard.html).toContain("A hard break<br>");
    expect(clipboard.html).toContain(
      '<a href="http://www.example.com/">www.example.com</a> stays plain Markdown text.',
    );
    expect(clipboard.html).toContain(
      '<a href="https://docs.example.com/" title="Reference">docs</a>',
    );
    expect(clipboard.html).toContain(
      '<a href="https://autolink.example.com/">https://autolink.example.com</a>',
    );
    expect(clipboard.html).toContain(
      '<a href="file:///tmp/paseo%20notes.md#L4">workspace file</a>',
    );
    expect(clipboard.html).toContain("<code>https://example.com/generated</code>");
    expect(clipboard.html).toContain(
      '<a href="https://example.com/generated"><code>https://example.com/generated</code></a>',
    );
    expect(clipboard.html).toContain('<code class="language-typescript">');
    expect(clipboard.html).toContain(
      '<pre><code class="language-text">before\n```\nafter\n</code></pre>',
    );
    expect(clipboard.html).toContain("<table>");
    expect(clipboard.html).toContain('<td style="text-align:left">Current | active</td>');
    expect(clipboard.html.match(/<td\b/g)).toHaveLength(3);
    expect(clipboard.html).toContain("<s>obsolete</s>");
    expect(clipboard.html).toContain('<th style="text-align:left">Left</th>');
    expect(clipboard.html).toContain('<th style="text-align:right">Right</th>');
    expect(clipboard.html).toContain('<th style="text-align:center">Center</th>');

    await doubleClickAssistantMarkdownText(page, "code", "apply_patch");
    await copySelection(page);

    const doubleClickedCodeClipboard = await readRichClipboard(page);
    expect(doubleClickedCodeClipboard.plainText).toBe("apply_patch");
    expect(doubleClickedCodeClipboard.html).not.toContain("<code>");

    await doubleClickAssistantMarkdownText(page, "strong", "strong prose");
    await copySelection(page);

    const doubleClickedBoldClipboard = await readRichClipboard(page);
    expect(doubleClickedBoldClipboard.plainText).toBe("strong");
    expect(doubleClickedBoldClipboard.html).not.toContain("<strong>");

    await selectAssistantTextRange(
      page,
      "P1 — High-value UI behavior",
      "Smoke with an older saved Fabel/model alias and with daemon/client version drift.",
    );
    await copySelection(page);

    const headingAndListClipboard = await readRichClipboard(page);
    expect(headingAndListClipboard.plainText).toBe(
      [
        "P1 — High-value UI behavior",
        "===========================",
        "",
        "5. Claude model and thinking preferences",
        "    - Switch Claude models and confirm each model retains its own thinking choice.",
        "    - Cover new-workspace drafts, queued launches, schedules, and editing existing schedules.",
        "    - Confirm Opus 5 exposes the Fast toggle.",
        "    - Smoke with an older saved Fabel/model alias and with daemon/client version drift.",
      ].join("\n"),
    );
    expect(headingAndListClipboard.html).toMatch(
      /<h1>P1 — High-value UI behavior<\/h1>\s*<div>5\. Claude model and thinking preferences\s*<\/div><div>- Switch Claude models/,
    );

    await selectAssistantText(page, "First");
    await copySelection(page);

    const partialClipboard = await readRichClipboard(page);
    expect(partialClipboard.plainText).toBe("First");
    expect(partialClipboard.html).toContain("<p>First</p>");

    await selectAssistantTextRange(page, "Direct matches:", "repeated sandbox setup.");
    await copySelection(page);

    const paragraphAndListClipboard = await readRichClipboard(page);
    expect(paragraphAndListClipboard.plainText).toBe(
      [
        "Direct matches:",
        "",
        "Formatted **strong prose**, _emphasized prose_, and ~~struck prose~~.",
        "",
        "- **[First issue](https://example.com/issues/1)**: exact `apply_patch` failure.",
        "- [Second issue](https://example.com/issues/2): repeated sandbox setup.",
      ].join("\n"),
    );
    expect(paragraphAndListClipboard.html).not.toContain("<ul>");
    expect(paragraphAndListClipboard.html).not.toContain("<li>");
    expect(paragraphAndListClipboard.html).toContain(
      '<div>- <strong><a href="https://example.com/issues/1">First issue</a></strong>',
    );

    await selectAssistantListItemFromMarker(page, "ul", "First issue", "failure.");
    await copySelection(page);

    const draggedBulletClipboard = await readRichClipboard(page);
    expect(draggedBulletClipboard.plainText).toBe(
      "- **[First issue](https://example.com/issues/1)**: exact `apply_patch` failure.",
    );
    expect(draggedBulletClipboard.html).toContain(
      '<div>- <strong><a href="https://example.com/issues/1">First issue</a></strong>',
    );

    await selectAssistantListItemFromMarker(page, "ol", "Sixth item", "Sixth item");
    await copySelection(page);

    const draggedNumberClipboard = await readRichClipboard(page);
    expect(draggedNumberClipboard.plainText).toBe("6. Sixth item");
    expect(draggedNumberClipboard.html).toContain("<div>6. Sixth item</div>");

    await selectAssistantText(page, "docs");
    await copySelection(page);

    const titledLinkClipboard = await readRichClipboard(page);
    expect(titledLinkClipboard.plainText).toBe("docs");
    expect(titledLinkClipboard.html).not.toContain("<a ");

    await selectAssistantText(page, "https://autolink.example.com");
    await copySelection(page);

    const autolinkClipboard = await readRichClipboard(page);
    expect(autolinkClipboard.plainText).toBe("https://autolink.example.com");

    await selectAssistantText(page, "workspace file");
    await copySelection(page);

    const fileLinkClipboard = await readRichClipboard(page);
    expect(fileLinkClipboard.plainText).toBe("workspace file");
    expect(fileLinkClipboard.html).not.toContain("<a ");

    await selectAssistantTextRange(page, "Seventh item", "Eighth item");
    await copySelection(page);

    const midListClipboard = await readRichClipboard(page);
    expect(midListClipboard.plainText).toBe("Seventh item\n\n8. Eighth item");
    expect(midListClipboard.html).toContain("<div>8. Eighth item</div>");

    await selectAssistantTextRange(page, "Inner eight", "Inner nine");
    await copySelection(page);

    const nestedListClipboard = await readRichClipboard(page);
    expect(nestedListClipboard.plainText).toBe("Inner eight\n\n9. Inner nine");
    expect(nestedListClipboard.html).toContain("<div>9. Inner nine</div>");

    await selectAssistantTextRange(page, "Seventh item", "Nested list:");
    await copySelection(page);

    const crossBlockClipboard = await readRichClipboard(page);
    expect(crossBlockClipboard.plainText).toBe("Seventh item\n\n8. Eighth item\n\nNested list:");
    expect(crossBlockClipboard.html).toContain("<div>8. Eighth item</div>");

    await selectAssistantText(page, "Current");
    await copySelection(page);

    const partialTableClipboard = await readRichClipboard(page);
    expect(partialTableClipboard.plainText).toBe("Current");
    expect(partialTableClipboard.html).toContain("<p>Current</p>");
    expect(partialTableClipboard.html).not.toContain("&lt;table");

    await selectAssistantTextRange(page, "Right", "ready");
    await copySelection(page);

    const columnSliceClipboard = await readRichClipboard(page);
    expect(columnSliceClipboard.plainText).toContain("ready");
    expect(columnSliceClipboard.html).not.toContain("<table>");
    expect(columnSliceClipboard.html).toContain("ready");
    expect(columnSliceClipboard.html).toContain("<s>obsolete</s>");

    // A partial selection loses its `pre` wrapper, so the code reaches Turndown as
    // prose unless it is diverted first: the line break and the indentation go, and
    // Markdown-significant characters get escaped.
    await selectAssistantAcrossCodeLines(page, "const", "return");
    await copySelection(page);

    const codeLinesClipboard = await readRichClipboard(page);
    expect(codeLinesClipboard.plainText).toBe('const answer = "yes";\n  return');
    expect(codeLinesClipboard.html).toContain('<pre><code class="language-typescript">');

    // Selecting inside code expresses an intent to copy code, even when the selection
    // contains every character in the block.
    await selectAssistantElement(
      page,
      '[data-paseo-markdown-language="typescript"] [data-paseo-markdown-tag="code"]',
    );
    await copySelection(page);

    const completeCodeClipboard = await readRichClipboard(page);
    expect(completeCodeClipboard.plainText).toBe('const answer = "yes";\n  return answer;');

    // Touching the block before it without selecting any of its text is still a
    // selection inside the code.
    await selectAssistantElementFromEndOf(
      page,
      "not a generated link.",
      '[data-paseo-markdown-language="typescript"] [data-paseo-markdown-tag="code"]',
    );
    await copySelection(page);

    expect((await readRichClipboard(page)).plainText).toBe(
      'const answer = "yes";\n  return answer;',
    );

    // Crossing the block boundary expresses an intent to carry its Markdown structure.
    await selectAssistantAcrossCodeLines(page, "const", "After code.");
    await copySelection(page);

    const crossedCodeClipboard = await readRichClipboard(page);
    expect(crossedCodeClipboard.plainText).toBe(
      '```typescript\nconst answer = "yes";\n  return answer;\n```\n\nAfter code.',
    );

    // Selecting a whole line runs off its end into the newline node. A trailing
    // newline auto-executes the line when it is pasted into a terminal.
    await selectAssistantAcrossCodeLines(page, "const", "  ");
    await copySelection(page);

    expect((await readRichClipboard(page)).plainText).toBe('const answer = "yes";');

    // The block's own Copy button had the same hazard: a Markdown fence body ends in
    // a newline, and the button copied it raw.
    const typescriptFence = assistantMessage.locator('[data-paseo-markdown-language="typescript"]');
    // The button is opacity 0 / pointerEvents none until the fence is hovered.
    await typescriptFence.hover();
    await typescriptFence.locator("[data-paseo-markdown-ignore]").click();

    expect(await readPlainClipboard(page)).toBe('const answer = "yes";\n  return answer;');

    // A blank line before the closing fence leaves the body ending in two newlines,
    // so stripping only the terminal one still hands the terminal an executable line.
    const bashFence = assistantMessage.locator('[data-paseo-markdown-language="bash"]');
    await bashFence.hover();
    await bashFence.locator("[data-paseo-markdown-ignore]").click();

    expect(await readPlainClipboard(page)).toBe("echo trailing");
  } finally {
    await agent.cleanup();
  }
});

test("copying a selection across an assistant image keeps its Markdown source and alt text", async ({
  context,
  page,
}) => {
  const image =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "assistant-selection-copy-image-",
    title: "Assistant selection copy image",
    initialPrompt: "Render the image fixture.",
    featureValues: {
      mockAssistantResponse: [
        "Before the image.",
        "",
        `![chart](${image})`,
        "",
        "After the image.",
      ].join("\n"),
    },
  });

  try {
    await allowRichClipboard(context);
    await agent.client.waitForAgentUpsert(
      agent.agentId,
      (snapshot) => snapshot.status === "idle",
      30_000,
    );
    await openAgentRoute(page, agent);
    await expect(assistantMessageBlocks(page).locator("img")).toHaveCount(1);

    await selectAssistantTextRange(page, "Before the image.", "After the image.");
    await copySelection(page);

    expect((await readRichClipboard(page)).plainText).toBe(
      `Before the image.\n\n![chart](${image})\n\nAfter the image.`,
    );

    await selectAssistantImage(page);
    await copySelection(page);

    expect((await readRichClipboard(page)).plainText).toBe(`![chart](${image})`);

    await dragFromBelowImageTo(page, "After the");
    await copySelection(page);

    expect((await readRichClipboard(page)).plainText).toBe("After the");
  } finally {
    await agent.cleanup();
  }
});

test("replying to selected assistant text preserves the draft and focuses the composer", async ({
  page,
  context,
}, testInfo) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "assistant-selection-reply-",
    title: "Reply to selected text",
    initialPrompt: "Explain the ports.",
    featureValues: {
      mockAssistantResponse:
        "Docker ports are **PostgreSQL databases**.\n\nKeep the existing configuration.",
    },
  });
  try {
    await allowRichClipboard(context);
    await agent.client.waitForAgentUpsert(
      agent.agentId,
      (snapshot) => snapshot.status === "idle",
      30_000,
    );
    await openAgentRoute(page, agent);
    const composer = composerLocator(page);
    await composer.fill("My existing draft");
    await selectAssistantText(page, "PostgreSQL databases");
    const reply = page.getByTestId("reply-to-selection");
    const copy = page.getByTestId("copy-selection");
    await expect(reply).toBeVisible();
    await expect(copy).toBeVisible();
    await expect(page.getByTestId("selection-actions-divider")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("selection-reply-action.png") });
    await clickSelectionCopy(page);
    expect((await readRichClipboard(page)).plainText).toBe("PostgreSQL databases");
    await expect(composer).toHaveAttribute("data-markdown", "My existing draft");
    await selectAssistantText(page, "PostgreSQL databases");
    await expect(reply).toBeVisible();
    await agent.client.sendAgentMessage(agent.agentId, "Add another streamed reply.");
    await agent.client.waitForFinish(agent.agentId, 30_000);
    // Markdown replacement can collapse the DOM selection; the captured excerpt survives.
    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
      window.dispatchEvent(new Event("scroll"));
    });
    await expect(reply).toBeVisible();
    await denyClipboardUntilAllowed(page);
    await copy.click();
    await expect(page.getByText("Unable to copy", { exact: true })).toBeVisible();
    await expect(copy).toBeEnabled();
    await expect(composer).toHaveAttribute("data-markdown", "My existing draft");
    await page.evaluate(() => window.dispatchEvent(new Event("allow-test-clipboard")));
    await clickSelectionCopy(page);
    expect((await readRichClipboard(page)).plainText).toBe("PostgreSQL databases");
    await selectAssistantText(page, "PostgreSQL databases");
    await reply.click();
    await expect(composer).toHaveAttribute(
      "data-markdown",
      "My existing draft\n\n> PostgreSQL databases\n\n",
    );
    await expect(composer).toBeFocused();
    await composer.pressSequentially("Please clarify this.");
    await expect(composer).toHaveAttribute(
      "data-markdown",
      "My existing draft\n\n> PostgreSQL databases\n\nPlease clarify this.",
    );
    await page.screenshot({ path: testInfo.outputPath("selection-reply-composer.png") });
    await selectAssistantText(page, "PostgreSQL databases");
    await expect(reply).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(reply).toHaveCount(0);
    await expect(composer).toHaveAttribute(
      "data-markdown",
      "My existing draft\n\n> PostgreSQL databases\n\nPlease clarify this.",
    );
  } finally {
    await agent.cleanup();
  }
});

test("Reply follows the active end of wrapped text selections", async ({ page }, testInfo) => {
  const paragraph =
    "Existing subscriber prices are preserved. Apple remains unsubmitted; Google changes are saved. I updated the completion report and kept the existing configuration. ".repeat(
      6,
    );
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "assistant-selection-position-",
    title: "Selection reply position",
    initialPrompt: "Explain the current configuration.",
    featureValues: { mockAssistantResponse: paragraph },
  });
  try {
    await agent.client.waitForAgentUpsert(
      agent.agentId,
      (snapshot) => snapshot.status === "idle",
      30_000,
    );
    await openAgentRoute(page, agent);
    await waitForTimelineGeometryToSettle(page);
    await page
      .getByTestId("agent-chat-scroll")
      .filter({ visible: true })
      .click({ position: { x: 2, y: 2 } });
    const message = assistantMessageBlocks(page).locator("p").first();
    await expect(message).toBeVisible();
    await message.scrollIntoViewIfNeeded();
    const points = await message.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const node = walker.nextNode();
      if (!(node instanceof Text)) throw new Error("Expected response text");
      const lines = new Map<number, { rect: DOMRect; offset: number }[]>();
      for (let offset = 0; offset < node.length; offset++) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rect = range.getBoundingClientRect();
        if (rect.width <= 0) continue;
        const line = lines.get(rect.top) ?? [];
        line.push({ rect, offset });
        lines.set(rect.top, line);
      }
      const rows = Array.from(lines.values());
      const second = rows[1];
      const third = rows[2];
      if (!second || !third) throw new Error("Expected three wrapped lines");
      function point(row: { rect: DOMRect; offset: number }[], fraction: number) {
        return row[Math.floor(row.length * fraction)]!.offset;
      }
      return {
        secondStart: point(second, 0.25),
        secondEnd: point(second, 0.7),
        thirdEnd: point(third, 0.65),
      };
    });
    const cases = [
      { name: "partial-second-line", start: points.secondStart, end: points.secondEnd },
      { name: "wrapped-forward", start: points.secondStart, end: points.thirdEnd },
      { name: "wrapped-backward", start: points.thirdEnd, end: points.secondStart },
    ];
    for (const selectionCase of cases) {
      await test.step(selectionCase.name, async () => {
        await message.evaluate(
          (element, selectionOffsets) => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            const node = walker.nextNode();
            if (!(node instanceof Text)) throw new Error("Expected response text");
            const selection = window.getSelection();
            if (!selection) throw new Error("Expected browser selection");
            selection.setBaseAndExtent(node, selectionOffsets.start, node, selectionOffsets.end);
          },
          { start: selectionCase.start, end: selectionCase.end },
        );
        const reply = page.getByTestId("reply-to-selection");
        const toolbar = page.getByTestId("selection-actions");
        await expect(reply).toBeVisible();
        const focus = await page.evaluate(() => {
          const selection = window.getSelection();
          if (!selection?.focusNode || selection.isCollapsed)
            throw new Error("Expected selected text");
          const range = document.createRange();
          range.setStart(selection.focusNode, selection.focusOffset);
          range.collapse(true);
          const rect = range.getBoundingClientRect();
          return { x: rect.left, top: rect.top };
        });
        await expect
          .poll(async () => {
            const rect = await toolbar.boundingBox();
            if (!rect) throw new Error("Expected Reply action");
            return Math.abs(rect.x + rect.width / 2 - focus.x);
          })
          .toBeLessThan(2);
        const rect = await toolbar.boundingBox();
        if (!rect) throw new Error("Expected Reply action");
        expect(Math.abs(rect.y + rect.height + 8 - focus.top)).toBeLessThan(2);
        await page.screenshot({ path: testInfo.outputPath(`${selectionCase.name}.png`) });
      });
    }
  } catch (error) {
    await page.screenshot({ path: testInfo.outputPath("selection-position-failure.png") });
    const selected = await page.evaluate(() => ({
      text: window.getSelection()?.toString(),
      focus: window.getSelection()?.focusNode?.parentElement?.outerHTML,
      active: document.activeElement?.outerHTML,
    }));
    await testInfo.attach("selection-state", {
      body: JSON.stringify(selected),
      contentType: "application/json",
    });
    throw error;
  } finally {
    await agent.cleanup();
  }
});

async function selectTranscriptExcerpt(page: Page, start: string, end: string): Promise<string> {
  return page
    .getByTestId("agent-chat-scroll")
    .filter({ visible: true })
    .evaluate(
      (feed, excerpt) => {
        const walker = document.createTreeWalker(feed, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        let started = false;
        let node = walker.nextNode();
        while (node) {
          const text = node.textContent ?? "";
          const startOffset = text.indexOf(excerpt.start);
          if (!started && startOffset >= 0) {
            range.setStart(node, startOffset);
            started = true;
          }
          const endOffset = text.indexOf(
            excerpt.end,
            node === range.startContainer ? range.startOffset : 0,
          );
          if (started && endOffset >= 0) {
            range.setEnd(node, endOffset + excerpt.end.length);
            const selection = window.getSelection();
            if (!selection) throw new Error("Expected transcript selection");
            selection.removeAllRanges();
            selection.addRange(range);
            return selection.toString();
          }
          node = walker.nextNode();
        }
        throw new Error(`Transcript excerpt not found: ${excerpt.start} -> ${excerpt.end}`);
      },
      { start, end },
    );
}

test("Reply quotes Thinking, shell output, and selections spanning both", async ({
  page,
  context,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ autoExpandReasoning: true }));
  });
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "transcript-selection-reply-",
    title: "Reply to all transcript text",
    model: "ten-second-stream",
    initialPrompt: "Show reasoning and shell output.",
  });
  try {
    await allowRichClipboard(context);
    await agent.client.waitForFinish(agent.agentId, 20_000);
    await openAgentRoute(page, agent);
    const composer = composerLocator(page);
    await expect(composer).toBeVisible();
    const shell = page
      .getByTestId("tool-call-badge")
      .filter({ hasText: "node scripts/simulate-stream-burst.mjs" })
      .last();
    const feed = page.getByTestId("agent-chat-scroll").filter({ visible: true });
    await feed.hover({ position: { x: 20, y: 40 } });
    await page.mouse.wheel(0, -700);
    await waitForTimelineGeometryToSettle(page);
    await shell.getByRole("button").first().click();
    const output = page.locator("[data-pmono]").filter({ hasText: "[burst] tick 1" }).last();
    await expect(output).toBeVisible({ timeout: 30_000 });

    for (const excerpt of [
      { start: "Need to find the scroll container", end: "watches for new messages" },
      { start: "[burst] tick 1", end: "[burst] tick 2 userIsAtBottom=true" },
      { start: "Need to find the scroll container", end: "[burst] tick 2 userIsAtBottom=true" },
    ]) {
      await composer.fill("Existing comment");
      const selected = await selectTranscriptExcerpt(page, excerpt.start, excerpt.end);
      const reply = page.getByTestId("reply-to-selection");
      await expect(reply).toBeVisible();
      await clickSelectionCopy(page);
      expect((await readRichClipboard(page)).plainText).toBe(selected);
      await selectTranscriptExcerpt(page, excerpt.start, excerpt.end);
      await reply.click();
      const quote = selected
        .trimEnd()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
      await expect(composer).toHaveAttribute("data-markdown", `Existing comment\n\n${quote}\n\n`);
      await expect(composer).toBeFocused();
    }
    await page.screenshot({ path: testInfo.outputPath("thinking-and-output-reply.png") });
  } finally {
    await agent.cleanup();
  }
});

for (const layout of ["desktop", "compact"] as const) {
  test(`copies nonadjacent user and assistant messages as original Markdown (${layout})`, async ({
    page,
    context,
  }, testInfo) => {
    if (layout === "compact") await page.setViewportSize({ width: 430, height: 932 });
    const prompt = "Please keep **user Markdown** and `inline code`.";
    const response = "A [link](https://example.com).\n\n```ts\nconst answer = 42;\n```";
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "multi-message-copy-",
      title: "Multi-message selection",
      initialPrompt: prompt,
      featureValues: { mockAssistantResponse: response },
    });
    try {
      await allowRichClipboard(context);
      await agent.client.waitForFinish(agent.agentId, 15_000);
      await agent.client.sendAgentMessage(agent.agentId, "Leave this middle prompt unselected.");
      await agent.client.waitForFinish(agent.agentId, 15_000);
      await openAgentRoute(page, agent);
      await page.getByTestId("message-selection-start").click();
      await expect(page.getByTestId("message-selection-copy")).toBeDisabled();
      const users = page.getByRole("checkbox", { name: "Select user message", exact: true });
      const assistants = page.getByRole("checkbox", {
        name: "Select assistant message",
        exact: true,
      });
      await expect(users).toHaveCount(2);
      await expect(assistants).toHaveCount(2);
      // Reverse click order must still copy chronological conversation order.
      await assistants.last().click();
      await users.first().click();
      await expect(page.getByTestId("message-selection-copy")).toHaveAccessibleName(
        "Copy selected messages (2)",
      );
      await page.screenshot({ path: testInfo.outputPath(`multi-message-${layout}.png`) });
      await page.getByTestId("message-selection-copy").click();
      await expect(page.getByText("Messages copied", { exact: true })).toBeVisible();
      expect(await readPlainClipboard(page)).toBe(
        `### User\n\n${prompt}\n\n---\n\n### Assistant\n\n${response}`,
      );
      await expect(page.getByTestId("message-selection-start")).toBeVisible();
      await expect(users).toHaveCount(0);
      await page.getByTestId("message-selection-start").click();
      await users.first().click();
      await page.getByTestId("message-selection-cancel").click();
      await expect(users).toHaveCount(0);
      await page.getByTestId("message-selection-start").click();
      await expect(page.getByTestId("message-selection-copy")).toBeDisabled();
      await page.getByTestId("message-selection-cancel").click();
    } finally {
      await agent.cleanup();
    }
  });
}

test("keeps message checkboxes selected after clipboard denial and allows Copy to retry", async ({
  page,
  context,
}) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "multi-copy-retry-",
    title: "Copy retry",
    initialPrompt: "Keep my selection.",
    featureValues: { mockAssistantResponse: "A **complete** response." },
  });
  try {
    await allowRichClipboard(context);
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await openAgentRoute(page, agent);
    await denyClipboardUntilAllowed(page);
    await page.getByTestId("message-selection-start").click();
    const checkbox = page.getByRole("checkbox", { name: "Select user message", exact: true });
    await checkbox.click();
    await page.getByTestId("message-selection-copy").click();
    await expect(page.getByTestId("message-selection-error")).toContainText(
      "Your selection is kept",
    );
    await expect(checkbox).toBeChecked();
    await expect(page.getByTestId("message-selection-copy")).toBeEnabled();
    await page.evaluate(() => window.dispatchEvent(new Event("allow-test-clipboard")));
    await page.getByTestId("message-selection-copy").click();
    await expect(page.getByTestId("message-selection-start")).toBeVisible();
    await expect(page.getByTestId("message-selection-error")).toHaveCount(0);
    expect(await readPlainClipboard(page)).toBe("### User\n\nKeep my selection.");
  } finally {
    await agent.cleanup();
  }
});

test("keeps message selections while loading and scrolling to older conversation history", async ({
  page,
  context,
}) => {
  const firstPrompt = "Earliest selected prompt.";
  const response = "Keep **original Markdown**.\n\n```text\nselected reply\n```";
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "multi-copy-history-",
    title: "History selection",
    initialPrompt: firstPrompt,
    featureValues: { mockAssistantResponse: response },
  });
  try {
    await allowRichClipboard(context);
    await agent.client.waitForFinish(agent.agentId, 15_000);
    for (let index = 1; index < 45; index++) {
      await agent.client.sendAgentMessage(agent.agentId, `Unselected prompt ${index}.`);
      await agent.client.waitForFinish(agent.agentId, 15_000);
    }
    await openAgentRoute(page, agent);
    await expect(page.getByText(firstPrompt, { exact: true })).toHaveCount(0);
    await page.getByTestId("message-selection-start").click();
    const latestCheckbox = page
      .getByRole("checkbox", { name: "Select assistant message", exact: true })
      .last();
    await latestCheckbox.click();
    await expect(latestCheckbox).toBeChecked();
    await page.getByTestId("assistant-message").last().click();
    await page.keyboard.press("ControlOrMeta+f");
    const find = page.getByRole("textbox", { name: "Find in pane", exact: true });
    await find.fill(firstPrompt);
    await expect(page.getByText(firstPrompt, { exact: true })).toBeVisible();
    await find.press("Escape");
    const earliest = page
      .locator("[data-message-id]")
      .filter({ has: page.getByText(firstPrompt, { exact: true }) });
    await earliest.getByRole("checkbox", { name: "Select user message", exact: true }).click();
    await expect(page.getByTestId("message-selection-copy")).toHaveAccessibleName(
      "Copy selected messages (2)",
    );
    await page.getByTestId("message-selection-copy").click();
    await expect(page.getByTestId("message-selection-start")).toBeVisible();
    expect(await readPlainClipboard(page)).toBe(
      `### User\n\n${firstPrompt}\n\n---\n\n### Assistant\n\n${response}`,
    );
  } finally {
    await agent.cleanup();
  }
});

test("keeps an expanded compaction summary open when entering and leaving message selection", async ({
  page,
  context,
}) => {
  const intro =
    "This session is being continued from a previous conversation.\n\n" +
    "Keep the expanded context visible while choosing messages. ".repeat(30);
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "multi-copy-expanded-",
    title: "Expanded selection",
    initialPrompt: "Show the restored context.",
    featureValues: { mockAssistantResponse: intro },
  });
  try {
    await allowRichClipboard(context);
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await openAgentRoute(page, agent);
    const summary = page.getByRole("button", { name: "Compaction summary", exact: true }).last();
    await summary.click();
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("message-selection-start").click();
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("message-selection-cancel").click();
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("message-selection-start").click();
    await page
      .getByRole("checkbox", { name: "Select assistant message", exact: true })
      .last()
      .click();
    await page.getByTestId("message-selection-copy").click();
    await expect(page.getByTestId("message-selection-start")).toBeVisible();
    await expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(await readPlainClipboard(page)).toBe(`### Assistant\n\n${intro}`);
  } finally {
    await agent.cleanup();
  }
});

test("selection toolbar copies command lists and raw multi-line code", async ({
  page,
  context,
}, testInfo) => {
  const markdown =
    "- `supabase --project alpha`\n- `supabase --project beta`\n\n```bash\n  # comment\n  echo value\n```";
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "selection-toolbar-copy-",
    title: "Selection Copy",
    initialPrompt: "Show commands.",
    featureValues: { mockAssistantResponse: markdown },
  });
  try {
    await allowRichClipboard(context);
    await agent.client.waitForFinish(agent.agentId, 15_000);
    await openAgentRoute(page, agent);
    const composer = composerLocator(page);
    await composer.fill("Keep this draft");
    await selectAssistantElement(page, "ul");
    const copy = page.getByTestId("copy-selection");
    await expect(copy).toBeVisible();
    const replyRect = await page.getByTestId("reply-to-selection").boundingBox();
    const copyRect = await copy.boundingBox();
    const dividerRect = await page.getByTestId("selection-actions-divider").boundingBox();
    if (!replyRect || !copyRect || !dividerRect) throw new Error("Expected selection toolbar");
    expect(copyRect.x + copyRect.width).toBeLessThanOrEqual(dividerRect.x);
    expect(dividerRect.x + dividerRect.width).toBeLessThanOrEqual(replyRect.x);
    const dividerColors = await page
      .getByTestId("selection-actions-divider")
      .evaluate((element) => ({
        divider: getComputedStyle(element).backgroundColor,
        toolbar: getComputedStyle(element.parentElement!).backgroundColor,
      }));
    expect(dividerColors.divider).not.toBe(dividerColors.toolbar);
    const padding = await page.getByTestId("selection-actions").evaluate((toolbar) => {
      return Array.from(toolbar.querySelectorAll('[role="button"]'), (button) => {
        const style = getComputedStyle(button);
        return [style.paddingLeft, style.paddingRight];
      });
    });
    expect(padding).toHaveLength(2);
    expect(padding[0]).toEqual(padding[1]);
    expect(padding[0]?.[0]).toBe(padding[0]?.[1]);
    await page.screenshot({ path: testInfo.outputPath("selection-copy-reply-toolbar.png") });
    await clickSelectionCopy(page);
    const list = await readRichClipboard(page);
    await expect(page.getByText("Copied", { exact: true })).toHaveCount(0);
    expect(list.plainText).toBe("- `supabase --project alpha`\n- `supabase --project beta`");
    expect(list.html).toContain("<div>- <code>supabase --project alpha</code></div>");
    expect(list.html).toContain("<code>supabase --project alpha</code>");
    await selectAssistantAcrossCodeLines(page, "# comment", "value");
    await clickSelectionCopy(page);
    const code = await readRichClipboard(page);
    expect(code.plainText).toBe("# comment\n  echo value");
    expect(code.html).toContain("<pre><code");
    expect(code.html).not.toContain("<h1>");
    await expect(composer).toHaveAttribute("data-markdown", "Keep this draft");
  } finally {
    await agent.cleanup();
  }
});
