import { useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { withPreviewCsp } from "./html-preview-csp";
import type { HtmlPreviewImageAsset } from "./html-preview/images";

// `allow-scripts` alone: the file gets an opaque origin, so a plan page can run
// its own scripts (Excalidraw, charts) but cannot reach the Paseo app's DOM,
// cookies, or storage, and cannot navigate the top window. Agent-written HTML is
// not trusted markup. No popup tokens — a preview is a viewer, not a browser, and
// escaping the sandbox to open one buys nothing for reading a local plan. The same
// isolation means storage APIs throw inside the frame; pages that want to persist
// state have to export.
//
// A sandboxed frame may still navigate *itself*, and nothing in CSP stops that
// (see html-preview-csp.ts). That is the one hole left on web, it is bounded to
// the page's own contents, and it is documented in SECURITY.md rather than papered
// over with a directive browsers ignore.
const SANDBOX = "allow-scripts";

const iframeStyle = {
  flex: 1,
  minHeight: 0,
  border: "none",
  backgroundColor: "white",
} as const;

const NO_IMAGES: readonly HtmlPreviewImageAsset[] = [];

export function FileHtmlPreview({
  html,
  images = NO_IMAGES,
  testID,
}: {
  html: string;
  images?: readonly HtmlPreviewImageAsset[];
  testID?: string;
}) {
  const { t } = useTranslation();
  const frame = useRef<HTMLIFrameElement>(null);
  const assets = useMemo(
    () =>
      images.map((image) => ({
        source: image.source,
        blob: new Blob([new Uint8Array(image.bytes).buffer], { type: image.mime }),
      })),
    [images],
  );
  const document = useMemo(() => {
    const id = crypto.randomUUID();
    const bootstrap = assets.length ? imageBootstrap(id) : "";
    return { id, html: withPreviewCsp(bootstrap + html) };
  }, [html, assets]);
  useLayoutEffect(() => {
    if (assets.length === 0) return;
    let delivered = false;
    const receive = (event: MessageEvent) => {
      if (delivered || event.source !== frame.current?.contentWindow || event.data !== document.id)
        return;
      const port = event.ports[0];
      if (!port) return;
      delivered = true;
      // This port belongs to the original document even if its frame navigates away.
      port.postMessage(assets);
      port.close();
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [assets, document]);
  return (
    <iframe
      key={document.id}
      ref={frame}
      data-testid={testID}
      title={t("panels.file.filePanels.builtin.html")}
      srcDoc={document.html}
      sandbox={SANDBOX}
      referrerPolicy="no-referrer"
      style={iframeStyle}
    />
  );
}

// Opaque frames cannot load parent-origin blobs. Create each image URL inside its owning frame.
function imageBootstrap(id: string): string {
  return `<script>(()=>{
const channel=new MessageChannel();
channel.port1.onmessage=event=>{
  const apply=()=>{
    for(const image of event.data){
      const url=URL.createObjectURL(image.blob);
      for(const element of document.querySelectorAll('img')){
        if(element.getAttribute('src')===image.source) element.src=url;
      }
    }
    channel.port1.close();
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',apply,{once:true});
  else apply();
};
parent.postMessage(${JSON.stringify(id)},'*',[channel.port2]);
})()</script>`;
}
