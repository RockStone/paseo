import { useCallback, type MouseEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  useContextMenu,
} from "@/components/ui/context-menu";
import { useToast } from "@/contexts/toast-context";

interface Props {
  path: string | null;
  onResolve(): void;
  children: ReactNode;
}

export function FileLinkContextMenu(props: Props) {
  return (
    <ContextMenu>
      <FileLinkMenu {...props} />
    </ContextMenu>
  );
}

function FileLinkMenu({ path, onResolve, children }: Props) {
  const menu = useContextMenu();
  const { t } = useTranslation();
  const toast = useToast();
  const open = useCallback(
    (event: MouseEvent<HTMLSpanElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onResolve();
      menu.setAnchorRect({ x: event.pageX, y: event.pageY, width: 0, height: 0 });
      menu.setOpen(true);
    },
    [menu, onResolve],
  );
  const copy = useCallback(async () => {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      toast.copied(t("workspace.tabs.toasts.filePathCopiedLabel"));
    } catch {
      toast.error(t("workspace.tabs.toasts.copyFailed"));
    }
  }, [path, t, toast]);
  return (
    <>
      <span onContextMenu={open}>{children}</span>
      <ContextMenuContent>
        <ContextMenuItem testID="file-link-copy-path" disabled={path === null} onSelect={copy}>
          {t("workspace.fileActions.copyPath")}
        </ContextMenuItem>
      </ContextMenuContent>
    </>
  );
}
