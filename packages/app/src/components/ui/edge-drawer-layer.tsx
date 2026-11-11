import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Modal } from "@/components/ui/modal";

export interface EdgeDrawerLayerProps {
  /** False while the drawer slides out: it stays painted but no longer takes input. */
  active: boolean;
  onClose: () => void;
  triggerRef: RefObject<View | null>;
  children: ReactNode;
}

/**
 * Native: a transparent Modal, so the drawer escapes the header's bounds for Android hit-testing
 * (docs/floating-panels.md, Gotcha 1). A tap anywhere outside the drawer lands on the backdrop,
 * the trigger included, so the trigger closes the drawer rather than reopening it.
 */
export function EdgeDrawerLayer({ active, onClose, children }: EdgeDrawerLayerProps) {
  const { t } = useTranslation();
  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent={Platform.OS === "android"}
      onRequestClose={onClose}
    >
      <View style={styles.layer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("menu.backdrop")}
          disabled={!active}
          style={styles.backdrop}
          onPress={onClose}
        />
        {children}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: { flex: 1 },
  backdrop: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
});
