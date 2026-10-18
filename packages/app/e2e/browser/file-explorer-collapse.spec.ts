import { failDirectorySuggestionRequests } from "../support/helpers/command-center-file-search";
import { test, expect } from "../support/fixtures";
import {
  collapseFolder,
  expandFolder,
  expectExplorerEntryHidden,
  expectExplorerEntryVisible,
  expectFileTabOpen,
  openFileExplorer,
  openFileFromExplorer,
} from "../support/helpers/file-explorer";
import { gotoWorkspace } from "../support/helpers/launcher";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";

let workspace: SeededWorkspace;

test.beforeAll(async () => {
  workspace = await seedWorkspace({
    repoPrefix: "file-explorer-collapse-",
    repo: {
      files: [
        { path: "assets/logo.png", content: "image bytes for explorer e2e\n" },
        { path: "docs/guide.md", content: "# Guide\n" },
        { path: "src/nested/filter-needle.ts", content: "export const needle = true;\n" },
        { path: ".claude/filter-secret.md", content: "Hidden filter fixture\n" },
      ],
    },
  });
});

test.afterAll(async () => {
  await workspace?.cleanup();
});

test.describe("File explorer collapse", () => {
  test("collapses an opened image file parent folder and still expands other folders", async ({
    page,
  }) => {
    await gotoWorkspace(page, workspace.workspaceId);
    await openFileExplorer(page);

    await expandFolder(page, "assets");
    await expectExplorerEntryVisible(page, "logo.png");

    await openFileFromExplorer(page, "logo.png");
    await expectFileTabOpen(page, "assets/logo.png");

    await collapseFolder(page, "assets");
    await expectExplorerEntryHidden(page, "logo.png");

    await expandFolder(page, "docs");
    await expectExplorerEntryVisible(page, "guide.md");
  });
});

test("Files filter searches nested paths and restores the expanded tree when cleared", async ({
  page,
}) => {
  await gotoWorkspace(page, workspace.workspaceId);
  await openFileExplorer(page);
  await expandFolder(page, "docs");
  await expectExplorerEntryVisible(page, "guide.md");
  const filter = page.getByTestId("files-filter-input");
  await filter.fill("filter-needle");
  const result = page.getByTestId("files-filter-result-src/nested/filter-needle.ts");
  await expect(result).toBeVisible();
  await expect(result).toContainText("filter-needle.ts");
  await expect(result).toContainText("src/nested");
  await result.click();
  await expectFileTabOpen(page, "src/nested/filter-needle.ts");
  await page.getByTestId("files-filter-clear").click();
  await expect(filter).toHaveValue("");
  await expectExplorerEntryVisible(page, "guide.md");
  await filter.fill("nothing-matches-this-xyz");
  await expect(page.getByTestId("files-filter-empty")).toHaveText("No matching files");
  await filter.fill("src/nested");
  await expect(result).toBeVisible();
  await filter.fill("filter-secret");
  const hidden = page.getByTestId("files-filter-result-.claude/filter-secret.md");
  await expect(hidden).toBeVisible();
  await page.getByTestId("files-hidden-toggle").click();
  await expect(hidden).toHaveCount(0);
  await expect(page.getByTestId("files-filter-empty")).toHaveText("No matching files");
  await page.getByTestId("files-hidden-toggle").click();
  await expect(hidden).toBeVisible();
  await page.getByTestId("files-filter-clear").click();
});

test("Files filter exposes search errors and Retry recovers", async ({ page }) => {
  await failDirectorySuggestionRequests(page, 1);
  await gotoWorkspace(page, workspace.workspaceId);
  await openFileExplorer(page);
  await page.getByTestId("files-filter-input").fill("filter-needle");
  const error = page.getByTestId("files-filter-error");
  await expect(error).toContainText("Could not search files. Try again.");
  await error.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect(page.getByTestId("files-filter-result-src/nested/filter-needle.ts")).toBeVisible();
});
