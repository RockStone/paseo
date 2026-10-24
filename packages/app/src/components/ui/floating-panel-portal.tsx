import {
  createContext,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View } from "react-native";
import { PortalHost } from "@gorhom/portal";

export const DEFAULT_FLOATING_PANEL_PORTAL_HOST = "content-floating-panels";

interface FloatingPanelPortalContextValue {
  hostName: string;
  hostRef: RefObject<View | null>;
  layoutRevision: number;
  onHostLayout: () => void;
}

const FloatingPanelPortalContext = createContext<FloatingPanelPortalContextValue | null>(null);

export function FloatingPanelPortalProvider({
  name = DEFAULT_FLOATING_PANEL_PORTAL_HOST,
  children,
}: {
  name?: string;
  children: ReactNode;
}): ReactElement {
  const instanceId = useId();
  const hostName = `${name}:${instanceId}`;
  const hostRef = useRef<View>(null);
  const [layoutRevision, setLayoutRevision] = useState(0);
  const onHostLayout = useCallback(() => setLayoutRevision((revision) => revision + 1), []);
  // A retained route can mount the same workspace more than once. Its popovers
  // must measure and render into this instance, never a hidden sibling's host.
  const value = useMemo(
    () => ({ hostName, hostRef, layoutRevision, onHostLayout }),
    [hostName, hostRef, layoutRevision, onHostLayout],
  );
  return (
    <FloatingPanelPortalContext.Provider value={value}>
      {children}
    </FloatingPanelPortalContext.Provider>
  );
}

export function useFloatingPanelPortal(): FloatingPanelPortalContextValue {
  const value = useContext(FloatingPanelPortalContext);
  if (!value) throw new Error("Floating panels require FloatingPanelPortalProvider");
  return value;
}

export function FloatingPanelPortalHost(): ReactElement {
  const { hostName, hostRef, onHostLayout } = useFloatingPanelPortal();
  return (
    <View
      ref={hostRef}
      testID="floating-panel-portal-host"
      collapsable={false}
      pointerEvents="box-none"
      style={styles.host}
      onLayout={onHostLayout}
    >
      <PortalHost key={hostName} name={hostName} />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
  },
});
