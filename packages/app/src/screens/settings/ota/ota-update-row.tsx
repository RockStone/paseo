import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import * as Updates from "expo-updates";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { settingsStyles } from "@/styles/settings";
import { toErrorMessage } from "@/utils/error-messages";

/**
 * Paseoi: which OTA bundle this device runs, and a way to fetch and apply the latest one now.
 * The app version stays the binary's version across OTA updates, so it can't tell you whether a
 * fix has arrived; the update id and publish time can.
 */
export function OtaUpdateRow() {
  const { t } = useTranslation();
  const toast = useToast();
  const { currentlyRunning } = Updates.useUpdates();
  const [busy, setBusy] = useState(false);
  const check = useCallback(async () => {
    setBusy(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        toast.show(t("settings.about.ota.upToDate"));
        return;
      }
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [t, toast]);

  if (!Updates.isEnabled) return null;
  const hint = currentlyRunning.isEmbeddedLaunch
    ? t("settings.about.ota.embedded")
    : t("settings.about.ota.running", {
        id: currentlyRunning.updateId?.slice(0, 8) ?? "?",
        date: currentlyRunning.createdAt?.toLocaleString() ?? "?",
      });
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]} testID="settings-ota-update">
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{t("settings.about.ota.title")}</Text>
        <Text style={settingsStyles.rowHint} selectable>
          {hint}
        </Text>
      </View>
      <Button variant="secondary" size="sm" onPress={check} disabled={busy}>
        {busy ? t("settings.about.ota.checking") : t("settings.about.ota.check")}
      </Button>
    </View>
  );
}
