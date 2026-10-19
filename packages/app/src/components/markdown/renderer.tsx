import { memo, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { EnrichedMarkdownText, type LinkPressEvent } from "react-native-enriched-markdown";
import { withUnistyles } from "react-native-unistyles";
import {
  useAssistantFileLinkActions,
  useAssistantFileLinkEnvironment,
} from "@/assistant-file-links";
import { useStableEvent } from "@/hooks/use-stable-event";
import { AttachmentLightbox, type ImageLightboxSource } from "@/components/attachment-lightbox";
import type { Theme } from "@/styles/theme";
import { isWeb } from "@/constants/platform";
import { MarkdownRendererFrame } from "./frame";
import { WEB_RENDERERS } from "./renderers";
import { createMarkdownStyles } from "./styles";
import { PENDING_MARKDOWN_IMAGE, splitMarkdownImageBlocks } from "./source";
import { splitStreamingMarkdown } from "./streaming";
import { useMarkdownSource, type MarkdownImageContext } from "./images";

import { MermaidFence, MermaidStreamingContext, splitMermaidFences } from "./fence/mermaid";

const ThemedMarkdown = withUnistyles(EnrichedMarkdownText);
const MD4C_FLAGS = { latexMath: false, hardSoftBreaks: true, admonitions: true };

const regularStyle = (theme: Theme) => createMarkdownStyles(theme);
const userStyle = (theme: Theme) => createMarkdownStyles(theme, false, "user");
const compactStyle = (theme: Theme) => createMarkdownStyles(theme, true);
const WEB_CONTAINER = { userSelect: "text" as const };

export interface MarkdownRendererProps extends MarkdownImageContext {
  text: string;
  compact?: boolean;
  variant?: "default" | "user";
  streaming?: boolean;
  onLinkPress?: (url: string) => unknown;
  imageLayout?: "gallery";
}

/** All Markdown surfaces share the same engine and source adaptation. */
export const MarkdownRenderer = memo(function MarkdownRenderer(props: MarkdownRendererProps) {
  const imageBlocks = useMemo(() => {
    const blocks =
      props.imageLayout === "gallery" ? splitMarkdownImageBlocks(props.text) : [props.text];
    let offset = 0;
    return blocks.map((text) => {
      const block = { text, key: String(offset) };
      offset += text.length;
      return block;
    });
  }, [props.imageLayout, props.text]);
  const streaming = !isWeb && !!props.streaming;
  // Only completed lines affect block closure. Do not run mdast on every reveal frame.
  const completeLines = streaming ? props.text.slice(0, props.text.lastIndexOf("\n") + 1) : "";
  const boundary = useMemo(
    () => splitStreamingMarkdown(completeLines, true).head.length,
    [completeLines],
  );
  if (imageBlocks.length > 1) {
    return (
      <View style={galleryStyles.mixed}>
        {imageBlocks.map(({ text, key }) => (
          <MarkdownRenderer key={key} {...props} text={text} />
        ))}
      </View>
    );
  }
  if (!streaming || boundary === 0) return <MarkdownPart {...props} />;
  return (
    <>
      <MarkdownPart {...props} text={props.text.slice(0, boundary)} continues />
      <MarkdownPart {...props} text={props.text.slice(boundary)} />
    </>
  );
});

const MarkdownPart = memo(function MarkdownPart({
  text,
  continues = false,
  compact = false,
  variant = "default",
  streaming = false,
  onLinkPress,
  imageLayout,
  ...imageContext
}: MarkdownRendererProps & { continues?: boolean }) {
  const environment = useAssistantFileLinkEnvironment();
  const actions = useAssistantFileLinkActions();
  const client =
    imageContext.client ??
    (environment.client?.readFile
      ? { readFile: environment.client.readFile.bind(environment.client) }
      : undefined);
  const { markdown, imageSources, linkRecognition, linkSource, imageOnly, imagePreviews } =
    useMarkdownSource(text, {
      workspaceRoot: environment.workspaceRoot,
      serverId: environment.serverId,
      ...imageContext,
      client,
    });
  const [image, setImage] = useState<ImageLightboxSource | null>(null);
  const pressLink = useStableEvent(({ url, sourceType }: LinkPressEvent) => {
    const source = linkSource(url, sourceType);
    if (onLinkPress && !actions.canResolveFile(source)) onLinkPress(url);
    else actions.open(source, "preferred");
  });
  const pressImage = useStableEvent(({ url }: { url: string }) => {
    if (url !== PENDING_MARKDOWN_IMAGE) setImage({ type: "uri", uri: url });
  });
  const closeImage = useStableEvent(() => setImage(null));
  const openGalleryImage = useStableEvent((uri: string) => setImage({ type: "uri", uri }));
  const gallerySources = useMemo<ImageLightboxSource[]>(
    () =>
      imagePreviews.flatMap(({ uri, status }) =>
        uri && status === "ready" ? [{ type: "uri" as const, uri }] : [],
      ),
    [imagePreviews],
  );
  const segments = useMemo(
    () =>
      isWeb ? [{ kind: "markdown", id: "0", source: markdown }] : splitMermaidFences(markdown),
    [markdown],
  );
  let markdownStyle = compact ? compactStyle : regularStyle;
  if (variant === "user") markdownStyle = userStyle;
  if (imageLayout === "gallery" && imageOnly) {
    return (
      <View style={galleryStyles.container} testID="assistant-image-gallery">
        <Text style={galleryStyles.label}>
          {imagePreviews.length} {imagePreviews.length === 1 ? "image" : "images"}
        </Text>
        <ScrollView horizontal contentContainerStyle={galleryStyles.row}>
          {imagePreviews.map(({ source, alt, uri, status }, index) => (
            <GalleryThumbnail
              key={source}
              uri={uri}
              status={status}
              label={alt || `Open image ${index + 1}`}
              onOpen={openGalleryImage}
            />
          ))}
        </ScrollView>
        {image ? (
          <AttachmentLightbox
            source={image}
            sources={gallerySources}
            onNavigate={setImage}
            onClose={closeImage}
          />
        ) : null}
      </View>
    );
  }
  const content = (
    <MermaidStreamingContext.Provider value={streaming}>
      {segments.map((segment) =>
        segment.kind === "mermaid" ? (
          <MermaidFence key={`${segment.kind}:${segment.id}`} code={segment.source} />
        ) : (
          <ThemedMarkdown
            key={`${segment.kind}:${segment.id}`}
            markdown={segment.source}
            containerStyle={isWeb ? WEB_CONTAINER : undefined}
            uniProps={markdownStyle}
            flavor="github"
            selectable
            allowTrailingMargin={continues && segment === segments[segments.length - 1]}
            md4cFlags={MD4C_FLAGS}
            linkRecognition={linkRecognition}
            enableTaskListItemToggle={false}
            enableLinkPreview={false}
            enableBlockContextMenu={false}
            // JS reveal owns pacing; native fade animation is a separate experiment.
            streamingAnimation={false}
            onLinkPress={pressLink}
            onImagePress={pressImage}
            renderers={isWeb ? WEB_RENDERERS : undefined}
          />
        ),
      )}
      {image ? <AttachmentLightbox source={image} onClose={closeImage} /> : null}
    </MermaidStreamingContext.Provider>
  );
  return <MarkdownRendererFrame imageSources={imageSources}>{content}</MarkdownRendererFrame>;
});

const GalleryThumbnail = memo(function GalleryThumbnail({
  uri,
  status,
  label,
  onOpen,
}: {
  uri: string | undefined;
  status: "ready" | "pending" | "unavailable";
  label: string;
  onOpen: (uri: string) => void;
}) {
  const source = useMemo(() => ({ uri }), [uri]);
  const open = useStableEvent(() => {
    if (uri) onOpen(uri);
  });
  return (
    <Pressable
      style={galleryStyles.thumbnail}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={!uri || status !== "ready"}
      onPress={open}
    >
      {uri && status === "ready" ? (
        <Image source={source} style={galleryStyles.image} resizeMode="cover" />
      ) : null}
      {status === "unavailable" ? <Text style={galleryStyles.label}>Unavailable</Text> : null}
    </Pressable>
  );
});

const galleryStyles = StyleSheet.create((theme) => ({
  mixed: { gap: 12 },
  container: { gap: 8, alignSelf: "stretch" },
  row: { gap: 8 },
  label: { color: theme.colors.foregroundMuted, fontSize: 12 },
  thumbnail: {
    width: 96,
    height: 96,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  image: { width: "100%", height: "100%" },
}));
