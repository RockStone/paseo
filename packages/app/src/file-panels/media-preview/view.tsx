import { useCallback, useMemo } from "react";
import { WebView } from "react-native-webview";
import type { FileMediaPreviewProps } from "./types";

const style = { flex: 1, width: "100%" as const, backgroundColor: "transparent" };
const origins = ["*"];

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function FileMediaPreview({
  url,
  kind,
  label,
  colorScheme,
  onReady,
  onError,
}: FileMediaPreviewProps) {
  const source = useMemo(
    () => ({
      baseUrl: url.slice(0, url.lastIndexOf("/") + 1),
      html: `<!doctype html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src file:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
    <style>html,body{margin:0;height:100%;background:transparent;color-scheme:${colorScheme}}body{display:flex;align-items:center;justify-content:center}video{width:100%;max-height:100%;object-fit:contain}audio{width:100%;max-width:520px}</style>
    </head><body><${kind} controls playsinline preload="metadata" aria-label="${escapeAttribute(label)}" src="${escapeAttribute(url)}"></${kind}>
    <script>const media=document.querySelector('audio,video');media.addEventListener('loadedmetadata',()=>window.ReactNativeWebView.postMessage('ready'));media.addEventListener('error',()=>window.ReactNativeWebView.postMessage('error'));</script></body></html>`,
    }),
    [kind, label, colorScheme, url],
  );
  const message = useCallback(
    ({ nativeEvent }: { nativeEvent: { data: string } }) => {
      if (nativeEvent.data === "ready") onReady();
      else if (nativeEvent.data === "error") onError();
    },
    [onError, onReady],
  );
  const allowInitial = useCallback(
    ({ url: target }: { url: string }) => target === "about:blank" || target === source.baseUrl,
    [source.baseUrl],
  );
  return (
    <WebView
      source={source}
      style={style}
      originWhitelist={origins}
      testID={`file-${kind}-preview`}
      onMessage={message}
      onError={onError}
      onShouldStartLoadWithRequest={allowInitial}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction
      allowFileAccess
      allowingReadAccessToURL={url}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      domStorageEnabled={false}
      thirdPartyCookiesEnabled={false}
      cacheEnabled={false}
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
    />
  );
}
