import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

const CODE_FONT_ATTRIBUTES = { "data-pmono": "" };

class ReferenceLabel extends WidgetType {
  constructor(
    readonly label: string,
    readonly url: string,
  ) {
    super();
  }
  ignoreEvent() {
    return false;
  }
  eq(other: ReferenceLabel) {
    return this.label === other.label && this.url === other.url;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "composer-reference";
    span.textContent = this.label;
    span.title = this.url;
    if (/^https?:\/\//i.test(this.url)) span.dataset.composerUrl = this.url;
    return span;
  }
}

function labelText(node: Nodes): string {
  if ("value" in node) return node.value;
  if ("children" in node) return node.children.map(labelText).join("");
  return "";
}

function waitsForSpace(node: Nodes, following: string | undefined): boolean {
  return node.type !== "inlineCode" && following !== " ";
}

function decorateUrls(text: string, from: number, to: number): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  for (const match of text.slice(from, to).matchAll(/\bhttps?:\/\/[^\s<>]+/gi)) {
    let url = match[0].replace(/[.,;:!?]+$/, "");
    // Keep balanced URL path parentheses, leaving prose punctuation outside the link.
    while (url.endsWith(")") && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0))
      url = url.slice(0, -1);
    ranges.push(
      Decoration.mark({
        class: "composer-url",
        attributes: { "data-composer-url": url, title: url },
      }).range(from + match.index, from + match.index + url.length),
    );
  }
  return ranges;
}

function decorateQuote(
  state: EditorState,
  from: number,
  to: number,
  quotedLines: Set<number>,
): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  const lastLine = state.doc.lineAt(Math.max(from, to - 1)).number;
  for (let number = state.doc.lineAt(from).number; number <= lastLine; number++) {
    const line = state.doc.line(number);
    if (quotedLines.has(line.from)) continue;
    quotedLines.add(line.from);
    ranges.push(Decoration.line({ class: "composer-quote" }).range(line.from));
    const marker = /^ {0,3}(?:> ?)+/.exec(line.text)?.[0];
    if (marker)
      ranges.push(Decoration.replace({ atomic: true }).range(line.from, line.from + marker.length));
  }
  return ranges;
}

function decorateCodeBlock(state: EditorState, from: number, to: number): Range<Decoration>[] {
  const opening = state.doc.lineAt(from);
  const closing = state.doc.lineAt(Math.max(from, to - 1));
  const fence = /^ {0,3}(`{3,})[^`]*$/.exec(state.sliceDoc(from, opening.to))?.[1];
  const endFence = /^ {0,3}(`{3,})[\t ]*$/.exec(closing.text)?.[1];
  // Markdown also parses unfinished fences as code. Wait for an actual matching closer.
  if (!fence || !endFence || endFence.length < fence.length || opening.number === closing.number)
    return [];
  const ranges: Range<Decoration>[] = [
    Decoration.replace({ atomic: true }).range(from, opening.to),
    Decoration.replace({ atomic: true }).range(closing.from, closing.to),
  ];
  for (let number = opening.number; number <= closing.number; number++) {
    const classes = ["composer-code-block"];
    if (number === opening.number) classes.push("composer-code-fence", "composer-code-block-start");
    if (number === closing.number) classes.push("composer-code-fence", "composer-code-block-end");
    ranges.push(
      Decoration.line({ class: classes.join(" "), attributes: CODE_FONT_ATTRIBUTES }).range(
        state.doc.line(number).from,
      ),
    );
  }
  return ranges;
}

function decorate(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const ranges: Range<Decoration>[] = [];
  const quotedLines = new Set<number>();
  function visit(node: Nodes) {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined) return;
    if (node.type === "blockquote") {
      ranges.push(...decorateQuote(state, from, to, quotedLines));
    }
    if (node.type === "link") {
      const label = labelText(node);
      ranges.push(
        Decoration.replace({ atomic: true, widget: new ReferenceLabel(label, node.url) }).range(
          from,
          to,
        ),
      );
      return;
    }
    if (node.type === "text") {
      ranges.push(...decorateUrls(text, from, to));
    }
    if (node.type === "code") {
      ranges.push(...decorateCodeBlock(state, from, to));
      return;
    }
    let width = 0;
    let className = "";
    let attributes: Record<string, string> | undefined;
    if (node.type === "inlineCode") {
      width = text.slice(from, to).match(/^`+/)?.[0].length ?? 1;
      className = "composer-code";
      attributes = CODE_FONT_ATTRIBUTES;
    } else if (node.type === "strong") {
      width = 2;
      className = "composer-bold";
    } else if (node.type === "emphasis") {
      width = 1;
      className = "composer-italic";
    }
    if (width > 0 && waitsForSpace(node, text[to])) return;
    if (width > 0) {
      ranges.push(Decoration.replace({ atomic: true }).range(from, from + width));
      ranges.push(
        Decoration.mark({ class: className, attributes }).range(from + width, to - width),
      );
      ranges.push(Decoration.replace({ atomic: true }).range(to - width, to));
    }
    if ("children" in node) node.children.forEach(visit);
  }
  visit(fromMarkdown(text));
  return Decoration.set(ranges, true);
}

export const composerDecorations = StateField.define<DecorationSet>({
  create: decorate,
  update: (value, transaction) => (transaction.docChanged ? decorate(transaction.state) : value),
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) =>
      view.state.field(field).update({ filter: (_from, _to, value) => value.spec.atomic === true }),
    ),
  ],
});
