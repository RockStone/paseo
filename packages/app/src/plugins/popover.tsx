import { PluginClientStateProvider } from "@getpaseo/plugin/client/host";
import { createContext, useContext, type ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuSurface, type MenuSurfaceProps } from "@/components/ui/menu";
import { ToastApiProvider, type useToast } from "@/contexts/toast-context";
import type { createPluginClientStateSource } from "./client-state/source";
import { PluginInstallationProvider } from "./installation-provider";
import type { InstalledPlugin } from "./types";

export interface PluginEnvironment {
  installation: InstalledPlugin;
  state: ReturnType<typeof createPluginClientStateSource>;
  toast: ReturnType<typeof useToast>;
}

interface PluginEnvironmentProviderProps {
  environment: PluginEnvironment;
  children: ReactNode;
}

/**
 * The providers plugin UI runs under. Render it around a contribution and again inside every
 * surface it opens: native sheets teleport their children, so providers around the trigger alone
 * cannot reach a popover body.
 */
export function PluginEnvironmentProvider({
  environment,
  children,
}: PluginEnvironmentProviderProps) {
  return (
    <ToastApiProvider api={environment.toast}>
      <PluginInstallationProvider plugin={environment.installation}>
        <PluginClientStateProvider source={environment.state}>{children}</PluginClientStateProvider>
      </PluginInstallationProvider>
    </ToastApiProvider>
  );
}

type PluginPopoverSurfaceProps = Pick<
  MenuSurfaceProps,
  "children" | "pages" | "sheetTitle" | "sheetTrailing" | "side" | "align" | "offset" | "testID"
>;

/**
 * The surface every plugin popover opens in: anchored to its trigger on wide layouts, a bottom
 * sheet on compact ones when the enclosing `MenuRoot` uses `compactMode="sheet"`.
 */
export function PluginPopoverSurface(props: PluginPopoverSurfaceProps) {
  return <MenuSurface {...props} minWidth={280} maxWidth={420} maxHeight={440} scrollable />;
}

/**
 * Paseoi: true inside the edge drawer. The drawer has a fixed height and does not scroll, so the
 * content fills it and scrolls its own lists under a pinned header (the Driveboard's tabs).
 */
export const PluginDrawerFillContext = createContext(false);

export function PluginPopoverContent({ children }: { children: ReactNode }) {
  const fill = useContext(PluginDrawerFillContext);
  return <View style={fill ? styles.fill : styles.content}>{children}</View>;
}

const styles = StyleSheet.create((theme) => ({
  content: { padding: theme.spacing[3], gap: theme.spacing[2] },
  fill: { flex: 1, padding: theme.spacing[3], paddingBottom: 0, gap: theme.spacing[2] },
}));
