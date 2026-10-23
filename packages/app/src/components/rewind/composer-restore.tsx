import type { UserComposerAttachment } from "@/attachments/types";
import type { RewoundComposerMessage } from "./attachments";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { ComposerTextSource } from "@/composer/text-source";
import { createContext, useContext, useMemo, type ReactNode } from "react";

interface RewindComposerRestoreContextValue {
  completeRewind: (message: RewoundComposerMessage) => void;
}

interface RewindComposerRestoreProviderProps {
  textSource: ComposerTextSource;
  setText: (text: string) => void;
  attachments: UserComposerAttachment[];
  setAttachments: (attachments: UserComposerAttachment[]) => void;
  onRewindComplete: () => void;
  children: ReactNode;
}

const RewindComposerRestoreContext = createContext<RewindComposerRestoreContextValue | null>(null);

export function restoreComposerDraftIfEmpty(input: {
  currentText: string;
  currentAttachments: readonly UserComposerAttachment[];
  rewound: RewoundComposerMessage;
}): RewoundComposerMessage | null {
  return input.currentText.length > 0 || input.currentAttachments.length > 0 ? null : input.rewound;
}

export function RewindComposerRestoreProvider({
  textSource,
  setText,
  attachments,
  setAttachments,
  onRewindComplete,
  children,
}: RewindComposerRestoreProviderProps) {
  const completeRewind = useStableEvent((message: RewoundComposerMessage) => {
    const restored = restoreComposerDraftIfEmpty({
      currentText: textSource.getSnapshot(),
      currentAttachments: attachments,
      rewound: message,
    });
    if (restored) {
      if (restored.attachments.length > 0) setAttachments(restored.attachments);
      setText(restored.text);
    }
    onRewindComplete();
  });

  const value = useMemo(() => ({ completeRewind }), [completeRewind]);

  return (
    <RewindComposerRestoreContext.Provider value={value}>
      {children}
    </RewindComposerRestoreContext.Provider>
  );
}

export function useRewindComposerRestore(): RewindComposerRestoreContextValue | null {
  return useContext(RewindComposerRestoreContext);
}
