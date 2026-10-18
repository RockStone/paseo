import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/components/ui/segmented-control";

export type SessionReferenceScope = "current" | "all";

export function SessionReferenceScopeFilter({
  scope,
  onChange,
}: {
  scope: SessionReferenceScope;
  onChange: (scope: SessionReferenceScope) => void;
}) {
  const { t } = useTranslation();
  const options = useMemo(
    () => [
      {
        value: "current" as const,
        label: t("sessionReference.currentProject"),
        testID: "session-reference-scope-current",
      },
      {
        value: "all" as const,
        label: t("sessionReference.allProjects"),
        testID: "session-reference-scope-all",
      },
    ],
    [t],
  );
  return (
    <View style={styles.container}>
      <SegmentedControl options={options} value={scope} onValueChange={onChange} size="xs" />
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  container: {
    padding: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
}));
