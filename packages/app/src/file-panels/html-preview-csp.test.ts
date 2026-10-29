import { describe, expect, it } from "vitest";
import { withPreviewCsp } from "./html-preview-csp";
import { prepareHtmlPreviewImages } from "./html-preview/images";

describe("withPreviewCsp", () => {
  it("places the policy before the complete source document", () => {
    const source =
      " <!-- untrusted --!><!doctype html \"'><script>location='https://example.com'</script>";
    const output = withPreviewCsp(source);

    expect(output).toMatch(/^<!doctype html><meta http-equiv="Content-Security-Policy"/);
    expect(output.endsWith(source)).toBe(true);
    expect(output.indexOf("Content-Security-Policy")).toBeLessThan(output.indexOf("<script>"));
  });

  it("keeps the original document intact", () => {
    const source = "<!doctype html><html><head></head><body><h1>Visual plan</h1></body></html>";

    expect(withPreviewCsp(source)).toContain(source);
  });

  it("drops a leading BOM before appending the source", () => {
    const output = withPreviewCsp("﻿<!doctype html><h1>Plan</h1>");

    expect(output.includes("﻿")).toBe(false);
    expect(output).toContain("<!doctype html><h1>Plan</h1>");
  });

  it("refuses remote resources while allowing inline scripts and styles", () => {
    const document = withPreviewCsp("<h1>Plan</h1>");

    expect(document).toContain("default-src 'none'");
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain("form-action 'none'");
    expect(document).toContain("base-uri 'none'");
    expect(document).toContain("frame-src 'none'");
    expect(document).toContain("object-src 'none'");
    expect(document).toContain("script-src 'unsafe-inline'");
    expect(document).toContain("style-src 'unsafe-inline'");
    expect(document).not.toMatch(/script-src[^;]*https:/);
    expect(document).not.toMatch(/img-src[^;]*https:/);
    expect(document).not.toMatch(/connect-src[^;]*https:/);
  });

  it("handles pathological source without parsing it", () => {
    const source = `${"<!--".repeat(10_000)}${'"'.repeat(10_000)}<html></html>`;

    expect(withPreviewCsp(source).endsWith(source)).toBe(true);
  });
});

describe("HTML preview local images", () => {
  it("resolves sibling and parent images and only rewrites image attributes", () => {
    const html = `<!doctype html><!-- <img src="ignore.png"> -->
<script>const example = '<img src="ignore.png">';</script>
<img class="photo" SRC='../assets/a%20%26%20b.png?v=2&amp;x=1#hero' width=20>
<img src=./sibling.png><img src="../assets/a%20%26%20b.png">
<a href="../assets/a%20%26%20b.png">Original link</a>`;
    const document = prepareHtmlPreviewImages(html, "review/index.html", "/project");
    expect(document.paths).toEqual(["/project/assets/a & b.png", "/project/review/sibling.png"]);
    const rendered = document.render(
      new Map([
        ["/project/assets/a & b.png", "blob:hero"],
        ["/project/review/sibling.png", "blob:sibling"],
      ]),
    );
    expect(rendered).toContain('<img class="photo" src="blob:hero" width=20>');
    expect(rendered).toContain('<img src="blob:sibling">');
    expect(rendered).toContain(`<script>const example = '<img src="ignore.png">';</script>`);
    expect(rendered).toContain('<!-- <img src="ignore.png"> -->');
    expect(rendered).toContain('<a href="../assets/a%20%26%20b.png">Original link</a>');
  });

  it("does not acquire remote resources, scripts, styles, data URLs or non-image files", () => {
    const html = `<img src="https://example.com/a.png"><img src="//example.com/a.png">
<img src="data:image/png;base64,abc"><img src="file:///private/a.png">
<img src="secret.txt"><script src="local.js"></script><link href="local.css" rel="stylesheet">`;
    const document = prepareHtmlPreviewImages(html, "/project/index.html", "/project");
    expect(document.paths).toEqual([]);
    expect(document.render(new Map())).toBe(html);
  });

  it("keeps unresolved images intact and escapes replacement attribute values", () => {
    const html = '<img src="one.png"><img src="missing.png">';
    const document = prepareHtmlPreviewImages(html, "index.html", "/project");
    expect(document.render(new Map([["/project/one.png", 'blob:one?x="&<']]))).toBe(
      '<img src="blob:one?x=&quot;&amp;&lt;"><img src="missing.png">',
    );
  });

  it("uses the first source when an image declares duplicate attributes", () => {
    const document = prepareHtmlPreviewImages(
      '<img src="one.png" src="two.png">',
      "index.html",
      "/project",
    );
    expect(document.paths).toEqual(["/project/one.png"]);
  });
});
