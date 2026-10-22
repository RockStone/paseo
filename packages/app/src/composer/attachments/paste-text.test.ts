import { describe, expect, it, vi } from "vitest";
import type { FileUploadInput, FileUploadResult } from "@getpaseo/client/internal/daemon-client";
import { createTextFilePaste } from "./paste-text";

const file: FileUploadInput = {
  fileName: "paste-test.txt",
  mimeType: "text/plain",
  bytes: new TextEncoder().encode("  中文 👋\r\nlog\n"),
  temporary: true,
};
const response: FileUploadResult = {
  requestId: "test",
  error: null,
  file: {
    type: "uploaded_file",
    id: "upload-test",
    fileName: file.fileName,
    mimeType: file.mimeType,
    size: file.bytes.byteLength,
    path: "/tmp/test/paste-test.txt",
  },
};

function setup() {
  const capture = vi.fn(async () => file);
  const upload = vi.fn(async (_input: FileUploadInput) => response);
  const attach = vi.fn();
  const pendingChanged = vi.fn();
  const paste = createTextFilePaste({ capture, upload, attach, pendingChanged });
  return { paste, capture, upload, attach, pendingChanged };
}

describe("paste text as a file", () => {
  it("retains the original bytes for retry after an upload failure", async () => {
    const { paste, capture, upload, attach } = setup();
    upload.mockRejectedValueOnce(new Error("Host disconnected"));
    await paste.run();
    expect(paste.getState()).toEqual({ status: "error", message: "Host disconnected" });
    expect(attach).not.toHaveBeenCalled();
    capture.mockResolvedValue({ ...file, bytes: new TextEncoder().encode("changed clipboard") });
    await paste.run();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenLastCalledWith(file);
    expect(attach).toHaveBeenCalledWith({ kind: "file", attachment: response.file });
    expect(paste.getState()).toEqual({ status: "idle" });
  });

  it("retries clipboard reads that failed before bytes were captured", async () => {
    const { paste, capture, upload } = setup();
    capture.mockRejectedValueOnce(new Error("Permission denied"));
    await paste.run();
    expect(upload).not.toHaveBeenCalled();
    await paste.run();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(upload).toHaveBeenCalledOnce();
  });

  it("ignores repeated shortcuts while uploading and discards stale completion on cancel", async () => {
    const { paste, upload, attach, pendingChanged } = setup();
    const deferred = Promise.withResolvers<FileUploadResult>();
    upload.mockReturnValueOnce(deferred.promise);
    const first = paste.run();
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    await paste.run();
    expect(upload).toHaveBeenCalledOnce();
    expect(pendingChanged).toHaveBeenLastCalledWith(true);
    paste.cancel();
    deferred.resolve(response);
    await first;
    expect(attach).not.toHaveBeenCalled();
    expect(pendingChanged).toHaveBeenLastCalledWith(false);
    expect(paste.getState()).toEqual({ status: "idle" });
  });

  it("does not upload clipboard text after its owning composer was unmounted", async () => {
    const { paste, capture, upload, attach } = setup();
    const deferred = Promise.withResolvers<FileUploadInput>();
    capture.mockReturnValueOnce(deferred.promise);
    const pending = paste.run();
    paste.cancel();
    deferred.resolve(file);
    await pending;
    expect(upload).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
    await paste.run();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(attach).toHaveBeenCalledOnce();
  });
});
