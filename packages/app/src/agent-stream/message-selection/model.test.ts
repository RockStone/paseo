import { describe, expect, it, vi } from "vitest";
import { openMessageSelection, type SelectableMessage } from "./model";

function message(
  id: string,
  seq: number,
  kind: SelectableMessage["kind"],
  text: string,
): SelectableMessage {
  return { id, kind, text, timestamp: new Date(0), timelineCursor: { epoch: "epoch", seq } };
}
const user = message(
  "user",
  1,
  "user_message",
  "Keep **this** and `code`.\n\n[link](https://example.com)",
);
const assistant = message(
  "assistant",
  2,
  "assistant_message",
  "```ts\nconst answer = 42;\n```\n\nDone.",
);

describe("message selection", () => {
  it("copies original Markdown in conversation order despite reverse selection and unmounted history", async () => {
    const model = openMessageSelection();
    let source = [user, assistant];
    model.registerSource("agent", () => source);
    model.start("agent");
    model.toggle("agent", assistant);
    model.toggle("agent", user);
    source = [assistant];
    const write = vi.fn().mockResolvedValue(undefined);
    expect(await model.copy(write)).toBe(true);
    expect(write).toHaveBeenCalledExactlyOnceWith(
      `### User\n\n${user.text}\n\n---\n\n### Assistant\n\n${assistant.text}`,
    );
    expect(model.getState()).toMatchObject({ target: null, selected: new Map(), pending: false });
  });

  it("uses the latest full source when a selected assistant response continues streaming", () => {
    const model = openMessageSelection();
    let source = [assistant];
    model.registerSource("agent", () => source);
    model.start("agent");
    model.toggle("agent", assistant);
    source = [{ ...assistant, text: `${assistant.text}\nFinal paragraph.` }];
    expect(model.markdown()).toBe(`### Assistant\n\n${source[0]!.text}`);
  });

  it("retains selected messages on clipboard failure and retries without duplicate submissions", async () => {
    const model = openMessageSelection();
    model.start("agent");
    model.toggle("agent", user);
    let reject!: (reason: Error) => void;
    const write = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue(undefined);
    const first = model.copy(write);
    expect(model.getState().pending).toBe(true);
    expect(await model.copy(write)).toBe(false);
    model.toggle("agent", user);
    reject(new Error("Clipboard denied"));
    expect(await first).toBe(false);
    expect(model.getState()).toMatchObject({ error: true, pending: false });
    expect(model.getState().selected.size).toBe(1);
    expect(await model.copy(write)).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("isolates conversations and ignores a completed copy after cancellation or a new selection", async () => {
    const model = openMessageSelection();
    model.start("first");
    model.toggle("second", user);
    expect(model.getState().selected.size).toBe(0);
    model.toggle("first", user);
    let resolve!: () => void;
    const copying = model.copy(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    model.cancel();
    model.start("second");
    model.toggle("second", assistant);
    resolve();
    expect(await copying).toBe(false);
    expect(model.getState().target).toBe("second");
    expect(model.markdown()).toBe(`### Assistant\n\n${assistant.text}`);
  });
});
