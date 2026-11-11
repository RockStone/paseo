import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { usePluginHostNavigation } from "../host-navigation";
import { getIsElectron } from "@/constants/platform";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { isHttpUrl } from "@/utils/http-url";
import {
  normalizeWorkspaceFileLocation,
  createWorkspaceFileTabTarget,
} from "@/workspace/file-open";
import { openWorkspaceTargetAtLocation } from "@/workspace-tabs/open-beside";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

type HostNavigation = NonNullable<PluginSurfaceProps["navigation"]>;

/**
 * Paseoi: what a header button's popover can open. Links and files that belong to the workspace
 * the button sits in open in that workspace's one reused side pane, beside the session, the same
 * as links opened from the chat. Anything else keeps the host's navigation.
 */
export interface PluginButtonNavigation extends HostNavigation {
  /** Opens a workspace file, relative to the workspace root, in the side pane. */
  readonly openFile: (input: {
    readonly path: string;
    readonly workspaceId: string;
    readonly lineStart?: number;
    readonly serverId?: string;
  }) => void;
}

export function usePluginButtonNavigation(serverId: string): PluginButtonNavigation {
  const host = usePluginHostNavigation(serverId);
  return useMemo(() => createPluginButtonNavigation(serverId, host), [serverId, host]);
}

export function createPluginButtonNavigation(
  serverId: string,
  host: HostNavigation,
): PluginButtonNavigation {
  const workspaceKey = (input: { workspaceId: string; serverId?: string }) =>
    buildWorkspaceTabPersistenceKey({
      serverId: input.serverId ?? serverId,
      workspaceId: input.workspaceId,
    });
  return {
    ...host,
    openBrowser: getIsElectron()
      ? (input) => {
          if (!isHttpUrl(input.url)) throw new Error("Only absolute HTTP(S) URLs are supported.");
          const key = workspaceKey(input);
          if (!key) {
            host.openBrowser?.(input);
            return;
          }
          const { browserId } = createWorkspaceBrowser({ initialUrl: input.url });
          openWorkspaceTargetAtLocation({
            workspaceKey: key,
            target: { kind: "browser", browserId },
            location: "side",
          });
        }
      : undefined,
    openFile: (input) => {
      const location = normalizeWorkspaceFileLocation({
        path: input.path,
        lineStart: input.lineStart,
      });
      const key = workspaceKey(input);
      if (!location || !key) return;
      openWorkspaceTargetAtLocation({
        workspaceKey: key,
        target: createWorkspaceFileTabTarget(location),
        location: "side",
      });
    },
  };
}
