import { StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";

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
    return span;
  }
}

function labelText(node: Nodes): string {
  if ("value" in node) return node.value;
  if ("children" in node) return node.children.map(labelText).join("");
  return "";
}

function decorate(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const ranges: Range<Decoration>[] = [];
  function visit(node: Nodes) {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;
    if (from === undefined || to === undefined) return;
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
    let width = 0;
    let className = "";
    if (node.type === "inlineCode") {
      width = text.slice(from, to).match(/^`+/)?.[0].length ?? 1;
      className = "composer-code";
    } else if (node.type === "strong") {
      width = 2;
      className = "composer-bold";
    } else if (node.type === "emphasis") {
      width = 1;
      className = "composer-italic";
    }
    if (width > 0) {
      ranges.push(Decoration.replace({ atomic: true }).range(from, from + width));
      ranges.push(Decoration.mark({ class: className }).range(from + width, to - width));
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
