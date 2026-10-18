import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentMetadata } from "@/attachments/types";
import { AttachmentLightbox, type ImageLightboxSource } from "./attachment-lightbox";

const { theme, imageMetadata, useAttachmentPreviewUrlMock, imageReadyCallbacks, imageLoading } =
  vi.hoisted(() => {
    const hoistedTheme = {
      spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
      iconSize: { sm: 14, md: 18, lg: 22 },
      borderWidth: { 1: 1 },
      borderRadius: { full: 999, md: 6, lg: 8 },
      fontSize: { xs: 11, sm: 13, base: 15 },
      fontWeight: { normal: "400" },
      colors: {
        surface1: "#111",
        surface2: "#222",
        foreground: "#fff",
        foregroundMuted: "#aaa",
        border: "#555",
        borderAccent: "#444",
      },
    };

    const hoistedImageMetadata: AttachmentMetadata = {
      id: "img-1",
      mimeType: "image/png",
      storageType: "web-indexeddb",
      storageKey: "img-1",
      fileName: "img-1.png",
      byteSize: 42,
      createdAt: 1,
    };

    return {
      imageReadyCallbacks: new Map<string, () => void>(),
      imageLoading: { manual: false, previewPending: false },
      theme: hoistedTheme,
      imageMetadata: hoistedImageMetadata,
      useAttachmentPreviewUrlMock: vi.fn<(metadata: AttachmentMetadata | null) => string | null>(
        () => "blob:preview",
      ),
    };
  });
const attachmentSource: ImageLightboxSource = { type: "attachment", metadata: imageMetadata };
const assistantImageSource: ImageLightboxSource = {
  type: "uri",
  uri: "blob:assistant-image",
};

const secondImageSource: ImageLightboxSource = { type: "uri", uri: "blob:second" };
const abandonedImageSource: ImageLightboxSource = { type: "uri", uri: "blob:abandoned" };
const latestImageSource: ImageLightboxSource = { type: "uri", uri: "blob:latest" };

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (factory: unknown) => (typeof factory === "function" ? factory(theme) : factory),
  },
  useUnistyles: () => ({ theme }),
}));

vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "message.attachments.closeImage": "Close image",
        "message.attachments.dismissImage": "Dismiss image",
        "message.attachments.imageLoadFailed": "Couldn't load image",
        "common.loading": "Loading...",
      })[key] ?? key,
  }),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

vi.mock("react-native-gesture-handler", () => ({
  GestureHandlerRootView: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "gesture-handler-root" }, children),
}));

vi.mock("lucide-react-native", () => {
  const createIcon = (name: string) => (props: Record<string, unknown>) =>
    React.createElement("span", { ...props, "data-icon": name });
  return {
    X: createIcon("X"),
    ChevronLeft: createIcon("ChevronLeft"),
    ChevronRight: createIcon("ChevronRight"),
  };
});

vi.mock("@/components/zoomable-viewport/image", () => ({
  ZoomableImage: (props: Record<string, unknown>) => {
    React.useEffect(() => {
      const ready = props.onReady as () => void;
      imageReadyCallbacks.set(String(props.uri), ready);
      if (!imageLoading.manual) ready();
    }, [props.onReady, props.uri]);
    const actions = props.actions as Array<{
      label: string;
      onPress: () => void;
      testID?: string;
    }>;
    return React.createElement(
      "div",
      {
        "data-testid": `${String(props.testID)}-image`,
        "data-source": props.uri,
        role: "img",
      },
      actions.map((action) =>
        React.createElement(
          "button",
          {
            "aria-label": action.label,
            "data-testid": action.testID,
            key: action.label,
            onClick: action.onPress,
            type: "button",
          },
          action.label,
        ),
      ),
    );
  },
}));

vi.mock("react-native", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-native");
  const Modal = ({ visible = true, children }: { visible?: boolean; children?: React.ReactNode }) =>
    visible ? React.createElement("div", { "data-testid": "lightbox-modal" }, children) : null;
  return { ...actual, Modal };
});

vi.mock("@/attachments/use-attachment-preview-url", () => ({
  useAttachmentPreview: (metadata: AttachmentMetadata | null) => {
    const url = useAttachmentPreviewUrlMock(metadata);
    let status = "ready";
    if (!url) status = imageLoading.previewPending ? "loading" : "error";
    return { url, status };
  },
}));

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  dom.window.requestAnimationFrame = vi.fn(() => 1);
  dom.window.cancelAnimationFrame = vi.fn();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("navigator", dom.window.navigator);

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  useAttachmentPreviewUrlMock.mockReturnValue("blob:preview");
  imageLoading.manual = false;
  imageLoading.previewPending = false;
  imageReadyCallbacks.clear();
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function render(element: React.ReactElement) {
  act(() => {
    root?.render(element);
  });
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
}

function queryByTestId(testID: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testID}"]`);
}

describe("AttachmentLightbox", () => {
  it("renders nothing when the source is null", () => {
    render(<AttachmentLightbox source={null} onClose={vi.fn()} />);

    expect(queryByTestId("attachment-lightbox-backdrop")).toBeNull();
    expect(queryByTestId("attachment-lightbox-image")).toBeNull();
  });

  it("renders the image when metadata is provided", () => {
    render(<AttachmentLightbox source={attachmentSource} onClose={vi.fn()} />);

    const image = queryByTestId("attachment-lightbox-image");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("data-source")).toBe("blob:preview");
  });

  it("renders a direct timeline image without resolving attachment storage", () => {
    render(<AttachmentLightbox source={assistantImageSource} onClose={vi.fn()} />);

    const image = queryByTestId("attachment-lightbox-image");
    expect(image?.getAttribute("data-source")).toBe("blob:assistant-image");
    expect(useAttachmentPreviewUrlMock).toHaveBeenLastCalledWith(null);
  });

  it("navigates within the supplied gallery with arrows and keyboard, without wrapping", () => {
    const second: ImageLightboxSource = { type: "uri", uri: "blob:second" };
    const third: ImageLightboxSource = { type: "uri", uri: "blob:third" };
    const sources = [assistantImageSource, second, third];
    const onClose = vi.fn();
    function Gallery() {
      const [source, setSource] = React.useState<ImageLightboxSource>(sources[1]);
      return (
        <AttachmentLightbox
          source={source}
          sources={sources}
          onNavigate={setSource}
          onClose={onClose}
        />
      );
    }
    render(<Gallery />);
    expect(queryByTestId("attachment-lightbox-position")?.textContent).toBe("2 / 3");
    click(queryByTestId("attachment-lightbox-next")!);
    expect(queryByTestId("attachment-lightbox-image")?.getAttribute("data-source")).toBe(
      "blob:third",
    );
    expect(queryByTestId("attachment-lightbox-next")?.getAttribute("aria-disabled")).toBe("true");
    act(() => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight" }));
    });
    expect(queryByTestId("attachment-lightbox-position")?.textContent).toBe("3 / 3");
    act(() => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft" }));
    });
    expect(queryByTestId("attachment-lightbox-image")?.getAttribute("data-source")).toBe(
      "blob:second",
    );
    click(queryByTestId("attachment-lightbox-previous")!);
    expect(queryByTestId("attachment-lightbox-image")?.getAttribute("data-source")).toBe(
      "blob:assistant-image",
    );
    expect(queryByTestId("attachment-lightbox-previous")?.getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("can navigate away from a failed attachment preview", () => {
    useAttachmentPreviewUrlMock.mockReturnValue(null);
    const sources = [attachmentSource, assistantImageSource];
    function Gallery() {
      const [source, setSource] = React.useState<ImageLightboxSource>(sources[0]);
      return (
        <AttachmentLightbox
          source={source}
          sources={sources}
          onNavigate={setSource}
          onClose={vi.fn()}
        />
      );
    }
    render(<Gallery />);
    act(() => vi.advanceTimersByTime(500));
    expect(document.body.textContent).toContain("Couldn't load image");
    click(queryByTestId("attachment-lightbox-next")!);
    expect(queryByTestId("attachment-lightbox-image")?.getAttribute("data-source")).toBe(
      "blob:assistant-image",
    );
    expect(document.body.textContent).not.toContain("Couldn't load image");
  });

  it("keeps the previous image painted until the next viewport and image are ready", () => {
    const onClose = vi.fn();
    render(<AttachmentLightbox source={assistantImageSource} onClose={onClose} />);
    imageLoading.manual = true;
    render(<AttachmentLightbox source={secondImageSource} onClose={onClose} />);
    const layers = [...document.querySelectorAll('[data-testid="attachment-lightbox-layer"]')];
    expect(layers).toHaveLength(2);
    expect(layers[0].getAttribute("aria-hidden")).toBeNull();
    expect(layers[1].getAttribute("aria-hidden")).toBe("true");
    expect(document.body.textContent).not.toContain("Couldn't load image");
    act(() => imageReadyCallbacks.get("blob:second")!());
    expect(document.querySelectorAll('[data-testid="attachment-lightbox-layer"]')).toHaveLength(1);
    expect(queryByTestId("attachment-lightbox-image")?.getAttribute("data-source")).toBe(
      "blob:second",
    );
    expect(queryByTestId("attachment-lightbox-layer")?.getAttribute("aria-hidden")).toBeNull();
  });

  it("does not show a failure while the next attachment URL is still resolving", () => {
    render(<AttachmentLightbox source={assistantImageSource} onClose={vi.fn()} />);
    imageLoading.previewPending = true;
    useAttachmentPreviewUrlMock.mockReturnValue(null);
    render(<AttachmentLightbox source={attachmentSource} onClose={vi.fn()} />);
    expect(queryByTestId("attachment-lightbox-image")?.getAttribute("data-source")).toBe(
      "blob:assistant-image",
    );
    expect(document.body.textContent).not.toContain("Couldn't load image");
    useAttachmentPreviewUrlMock.mockReturnValue("blob:preview");
    render(<AttachmentLightbox source={attachmentSource} onClose={vi.fn()} />);
    expect(queryByTestId("attachment-lightbox-image")?.getAttribute("data-source")).toBe(
      "blob:preview",
    );
  });

  it("ignores readiness from an abandoned image after rapid navigation", () => {
    render(<AttachmentLightbox source={assistantImageSource} onClose={vi.fn()} />);
    imageLoading.manual = true;
    render(<AttachmentLightbox source={abandonedImageSource} onClose={vi.fn()} />);
    imageLoading.manual = false;
    render(<AttachmentLightbox source={latestImageSource} onClose={vi.fn()} />);
    act(() => imageReadyCallbacks.get("blob:abandoned")!());
    expect(queryByTestId("attachment-lightbox-image")?.getAttribute("data-source")).toBe(
      "blob:latest",
    );
    expect(document.querySelectorAll('[data-testid="attachment-lightbox-layer"]')).toHaveLength(1);
  });

  it("delays loading and confirmed failure status messages for 500ms", () => {
    imageLoading.previewPending = true;
    useAttachmentPreviewUrlMock.mockReturnValue(null);
    render(<AttachmentLightbox source={attachmentSource} onClose={vi.fn()} />);
    act(() => vi.advanceTimersByTime(499));
    expect(queryByTestId("attachment-lightbox-loading")).toBeNull();
    expect(document.body.textContent).not.toContain("Couldn't load image");
    act(() => vi.advanceTimersByTime(1));
    expect(queryByTestId("attachment-lightbox-loading")?.textContent).toBe("Loading...");
    imageLoading.previewPending = false;
    render(<AttachmentLightbox source={attachmentSource} onClose={vi.fn()} />);
    expect(document.body.textContent).toContain("Couldn't load image");
    expect(queryByTestId("attachment-lightbox-loading")).toBeNull();
  });

  it("does not show navigation for a single image", () => {
    render(
      <AttachmentLightbox
        source={attachmentSource}
        sources={[attachmentSource]}
        onNavigate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(queryByTestId("attachment-lightbox-next")).toBeNull();
    expect(queryByTestId("attachment-lightbox-position")).toBeNull();
  });

  it("calls onClose when the backdrop is pressed", () => {
    const onClose = vi.fn();
    render(<AttachmentLightbox source={attachmentSource} onClose={onClose} />);

    const backdrop = queryByTestId("attachment-lightbox-backdrop");
    expect(backdrop).not.toBeNull();
    click(backdrop!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the close button is pressed", () => {
    const onClose = vi.fn();
    render(<AttachmentLightbox source={attachmentSource} onClose={onClose} />);

    const closeButton = document.querySelector(
      '[aria-label="Close image"][data-testid="attachment-lightbox-close"]',
    );
    expect(closeButton).not.toBeNull();
    click(closeButton!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows error text when the preview URL resolves to null", () => {
    useAttachmentPreviewUrlMock.mockReturnValue(null);
    render(<AttachmentLightbox source={attachmentSource} onClose={vi.fn()} />);

    expect(queryByTestId("attachment-lightbox-image")).toBeNull();
    act(() => vi.advanceTimersByTime(500));
    expect(document.body.textContent ?? "").toContain("Couldn't load image");
  });

  it("closes on Escape key on web", () => {
    const onClose = vi.fn();
    render(<AttachmentLightbox source={attachmentSource} onClose={onClose} />);

    act(() => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
