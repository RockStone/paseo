import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useQueryClient } from "@tanstack/react-query";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { Theme } from "@/styles/theme";
import { useIsCompactFormFactor } from "@/constants/layout";
import { claudeAuthenticationKey, useClaudeAuthentication } from "./use-status";
import { openClaudeAuthenticationForm } from "./form-model";

const SaveSpinner = withUnistyles(LoadingSpinner);
const saveSpinnerProps = (theme: Theme) => ({ color: theme.colors.accentForeground });

export function ClaudeAuthenticationSettings({ serverId }: { serverId: string }) {
  const { status, client, supported, connected } = useClaudeAuthentication(serverId);
  const [model] = useState(openClaudeAuthenticationForm);
  const state = useSyncExternalStore(model.subscribe, model.getState);
  const cache = useQueryClient();
  const size = useIsCompactFormFactor() ? "md" : "sm";
  useEffect(() => () => model.close(), [model]);
  const save = useCallback(() => {
    void model.submit(async (token, renewBy) => {
      if (!client) throw new Error("Host disconnected");
      await client.setClaudeAuthentication({ action: "save", token, renewBy });
      await cache.invalidateQueries({ queryKey: claudeAuthenticationKey(serverId) });
    });
  }, [cache, client, model, serverId]);
  const remove = useCallback(() => {
    void model.remove(async () => {
      if (!client) throw new Error("Host disconnected");
      await client.setClaudeAuthentication({ action: "remove" });
      await cache.invalidateQueries({ queryKey: claudeAuthenticationKey(serverId) });
    });
  }, [cache, client, model, serverId]);
  if (!supported) return null;
  return (
    <View style={styles.section} testID="claude-authentication-settings">
      <Text style={styles.heading}>Authentication</Text>
      <Text style={styles.hint}>
        Run claude setup-token in your terminal, then paste the result here. Stored in this host’s
        macOS Keychain.
      </Text>
      {status.isError ? (
        <Text style={styles.error}>
          Unable to read Keychain status. Unlock the host’s login keychain and retry.
        </Text>
      ) : null}
      {status.data?.tokenStored ? (
        <Text style={styles.hint}>Token stored · Renew by {status.data.renewBy?.slice(0, 10)}</Text>
      ) : null}
      <Field label="Subscription token" error={state.error}>
        <FormTextInput
          key={state.resetKey}
          size={size}
          secureTextEntry
          initialValue=""
          onChangeText={model.setToken}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!state.pending}
          accessibilityLabel="Claude subscription token"
          placeholder="Paste setup-token"
          testID="claude-authentication-token"
        />
      </Field>
      <Field label="Renewal reminder date">
        <FormTextInput
          size={size}
          initialValue={state.renewal}
          onChangeText={model.setRenewal}
          editable={!state.pending}
          autoCorrect={false}
          placeholder="YYYY-MM-DD"
          accessibilityLabel="Claude token renewal date"
        />
      </Field>
      <Text style={styles.hint}>
        Applies when Claude processes next start. Running agents keep their current credentials.
      </Text>
      <View style={styles.actions}>
        {state.saved ? <Text style={styles.hint}>Saved to Keychain</Text> : null}
        {state.removed ? <Text style={styles.hint}>Removed from Keychain</Text> : null}
        {status.data?.tokenStored ? (
          <Button size="sm" variant="ghost" disabled={!connected || state.pending} onPress={remove}>
            Remove token
          </Button>
        ) : null}
        <Button
          size="sm"
          disabled={!connected || !state.token || state.pending}
          onPress={save}
          testID="claude-authentication-save"
          style={styles.saveButton}
          accessibilityLabel="Save Claude token"
        >
          {state.pending ? <SaveSpinner size="small" uniProps={saveSpinnerProps} /> : "Save token"}
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: { padding: 16, gap: 12 },
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.base, fontWeight: "600" },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  saveButton: { width: 112 },
  actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 12 },
}));
