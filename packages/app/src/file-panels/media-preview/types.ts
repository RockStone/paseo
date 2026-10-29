export interface FileMediaPreviewProps {
  url: string;
  kind: "audio" | "video";
  label: string;
  colorScheme: "light" | "dark";
  onReady(): void;
  onError(): void;
}
