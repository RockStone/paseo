import React, {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useMemo,
} from "react";
import { View, StyleSheet as NativeStyleSheet } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import type { EditingTextInputHandle, EditingTextInputProps } from "@/components/ui/text-input";
import { composerDecorations } from "./decorations.web";
import { openExternalUrl } from "@/utils/open-external-url";

interface DecoratedInputProps extends Omit<
  EditingTextInputProps,
  "onKeyPress" | "onSelectionChange" | "onFocus" | "onBlur"
> {
  onKeyPress?: (event: { nativeEvent: KeyboardEvent; preventDefault(): void }) => void;
  onSelectionChange?: (event: {
    nativeEvent: { selection: { start: number; end: number } };
  }) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  referenceColor?: string;
  codeBackground?: string;
  codeColor?: string;
  codeBorder?: string;
  quoteColor?: string;
  quoteBorder?: string;
}

const HOST_STYLE = { height: "100%", minWidth: 0 };
const configuration = new Compartment();
const externalEdit = Transaction.userEvent.of("input.complete");

function boundedSelection(selection: { start: number; end: number }, length: number) {
  // Restored drafts can retain a caret from a longer previous value. Match the
  // native text input's bounds before handing that selection to CodeMirror.
  return EditorSelection.range(
    Math.max(0, Math.min(selection.start, length)),
    Math.max(0, Math.min(selection.end, length)),
  );
}

const DecoratedInput = forwardRef<EditingTextInputHandle, DecoratedInputProps>(
  function DecoratedInput(props, ref) {
    const host = useRef<HTMLDivElement>(null);
    const editor = useRef<EditorView | null>(null);
    const latest = useRef(props);
    latest.current = props;
    const initialText = useRef(props.initialValue ?? "");
    const replacing = useRef(false);

    const setup = useRef(extensions);
    useLayoutEffect(() => {
      if (!host.current) return;
      const view = new EditorView({
        parent: host.current,
        state: EditorState.create({ doc: initialText.current, extensions: setup.current() }),
      });
      editor.current = view;
      view.contentDOM.dataset.markdown = initialText.current;
      if (latest.current.autoFocus) view.focus();
      return () => {
        editor.current = null;
        view.destroy();
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editor.current?.focus(),
        blur: () => editor.current?.contentDOM.blur(),
        isFocused: () => editor.current?.hasFocus ?? false,
        getText: () => editor.current?.state.doc.toString() ?? initialText.current,
        getSelection: () => {
          const selection = editor.current?.state.selection.main;
          return { start: selection?.from ?? 0, end: selection?.to ?? 0 };
        },
        getNativeRef: () => editor.current?.contentDOM ?? null,
        replaceText: (text, selection) => {
          const view = editor.current;
          if (!view) return;
          replacing.current = true;
          const caret = selection ?? { start: text.length, end: text.length };
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: text },
            selection: boundedSelection(caret, text.length),
            annotations: externalEdit,
          });
          replacing.current = false;
        },
        setSelection: (selection) => {
          const view = editor.current;
          if (!view) return;
          view.dispatch({ selection: boundedSelection(selection, view.state.doc.length) });
        },
        reset: () => {
          const view = editor.current;
          if (!view) return;
          replacing.current = true;
          view.setState(EditorState.create({ doc: "", extensions: extensions() }));
          view.contentDOM.dataset.markdown = "";
          view.contentDOM.dataset.selectionStart = "0";
          view.contentDOM.dataset.selectionEnd = "0";
          replacing.current = false;
        },
      }),
      [],
    );

    function presentation() {
      const current = latest.current;
      return [
        EditorState.readOnly.of(current.editable === false),
        EditorView.editable.of(current.editable !== false),
        EditorView.contentAttributes.of({
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": current.accessibilityLabel ?? "",
          "data-composer-input": "",
          "data-decorated-composer": "true",
          "data-testid": current.testID ?? "composer-decorated-input",
        }),
        placeholder(current.placeholder ?? ""),
        EditorView.theme({
          "&": {
            height: "100%",
            color: "inherit",
            fontSize: "inherit",
            backgroundColor: "transparent",
          },
          "&.cm-focused": { outline: "none" },
          ".cm-scroller": { fontFamily: "inherit", lineHeight: "inherit", overflow: "auto" },
          ".cm-content": {
            padding: "0",
            minHeight: "1.4em",
            caretColor: "currentColor",
            overflowWrap: "anywhere",
          },
          ".cm-line": { padding: "0" },
          ".cm-placeholder": { color: current.placeholderTextColor?.toString() ?? "inherit" },
          ".composer-reference": { color: current.referenceColor ?? "inherit", cursor: "text" },
          ".composer-url, .composer-reference[data-composer-url]": {
            color: current.referenceColor ?? "inherit",
            textDecoration: "underline",
            textUnderlineOffset: "2px",
            cursor: "text",
          },
          ".composer-bold": { fontWeight: "700" },
          ".composer-italic": { fontStyle: "italic" },
          ".cm-line.composer-quote": {
            color: current.quoteColor ?? "inherit",
            borderLeft: `2px solid ${current.quoteBorder ?? "currentColor"}`,
            paddingLeft: "8px",
            marginLeft: "2px",
          },
          ".composer-code, .cm-line.composer-code-block": {
            color: current.codeColor ?? "inherit",
            fontFamily: "monospace",
            backgroundColor: current.codeBackground ?? "transparent",
          },
          ".composer-code": {
            border: `1px solid ${current.codeBorder ?? "transparent"}`,
            borderRadius: "3px",
            padding: "1px 3px",
          },
          ".cm-line.composer-code-block": {
            borderLeft: `1px solid ${current.codeBorder ?? "transparent"}`,
            borderRight: `1px solid ${current.codeBorder ?? "transparent"}`,
            padding: "0 8px",
          },
          ".cm-line.composer-code-fence": { height: "0", fontSize: "0", lineHeight: "0" },
          ".cm-line.composer-code-block-start": {
            borderTop: `1px solid ${current.codeBorder ?? "transparent"}`,
            borderTopLeftRadius: "3px",
            borderTopRightRadius: "3px",
            paddingTop: "6px",
          },
          ".cm-line.composer-code-block-end": {
            borderBottom: `1px solid ${current.codeBorder ?? "transparent"}`,
            borderBottomLeftRadius: "3px",
            borderBottomRightRadius: "3px",
            paddingBottom: "6px",
          },
        }),
      ];
    }

    function extensions() {
      return [
        history(),
        EditorView.lineWrapping,
        composerDecorations,
        configuration.of(presentation()),
        EditorView.domEventHandlers({
          mousedown: (event) => {
            if (event.button !== 0 || (!event.metaKey && !event.ctrlKey)) return false;
            const target =
              event.target instanceof Element
                ? event.target.closest<HTMLElement>("[data-composer-url]")
                : null;
            const url = target?.dataset.composerUrl;
            if (!url) return false;
            event.preventDefault();
            void openExternalUrl(url);
            return true;
          },
          keydown: (event) => {
            if (event.isComposing) return false;
            latest.current.onKeyPress?.({
              nativeEvent: event,
              preventDefault: () => event.preventDefault(),
            });
            return event.defaultPrevented;
          },
          focus: () => {
            latest.current.onFocus?.();
          },
          blur: () => {
            latest.current.onBlur?.();
          },
        }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((update) => {
          const text = update.state.doc.toString();
          update.view.contentDOM.dataset.markdown = text;
          if (update.selectionSet || update.docChanged) {
            const selection = update.state.selection.main;
            update.view.contentDOM.dataset.selectionStart = String(selection.from);
            update.view.contentDOM.dataset.selectionEnd = String(selection.to);
            latest.current.onSelectionChange?.({
              nativeEvent: { selection: { start: selection.from, end: selection.to } },
            });
          }
          if (update.docChanged && !replacing.current && !update.view.composing)
            latest.current.onChangeText?.(text);
        }),
        EditorView.domEventHandlers({
          compositionend: (_event, view) => {
            queueMicrotask(() => {
              if (editor.current === view) latest.current.onChangeText?.(view.state.doc.toString());
            });
          },
        }),
      ];
    }

    useEffect(() => {
      editor.current?.dispatch({ effects: configuration.reconfigure(presentation()) });
    }, [
      props.editable,
      props.placeholder,
      props.placeholderTextColor,
      props.accessibilityLabel,
      props.referenceColor,
      props.codeBackground,
      props.codeColor,
      props.codeBorder,
      props.quoteColor,
      props.quoteBorder,
    ]);

    const hostStyle = useMemo(() => {
      const { cursor: _cursor, ...style } = NativeStyleSheet.flatten(props.style) ?? {};
      return style;
    }, [props.style]);
    return (
      <View style={hostStyle}>
        <div ref={host} style={HOST_STYLE} />
      </View>
    );
  },
);

export const EditingTextInput = withUnistyles(DecoratedInput, (theme) => ({
  referenceColor: theme.colors.accent,
  codeBackground: theme.colors.surface2,
  codeBorder: theme.colors.borderAccent,
  codeColor: theme.colors.accentBright,
  quoteColor: theme.colors.foregroundMuted,
  quoteBorder: theme.colors.foregroundExtraMuted,
}));
