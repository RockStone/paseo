import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { TFunction } from "i18next";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import type { ProjectScriptDraft } from "@/utils/project-config-form";
const SCRIPT_SERVICE_TYPE = "service";
interface ScriptValidation {
  hasErrors: boolean;
  nameError: string | null;
  commandError: string | null;
}

export function validateScript(script: ProjectScriptDraft, t: TFunction): ScriptValidation {
  const nameError =
    script.name.trim().length === 0 ? t("settings.project.scripts.nameRequired") : null;
  const commandError =
    script.commandText.trim().length === 0 ? t("settings.project.scripts.commandRequired") : null;
  return {
    hasErrors: Boolean(nameError || commandError),
    nameError,
    commandError,
  };
}

interface ScriptEditModalProps {
  script: ProjectScriptDraft;
  onChange: (next: ProjectScriptDraft) => void;
  onCancel: () => void;
  onSave: () => void;
  pending?: boolean;
  error?: ReactNode;
  headerTitle?: string;
  saveDisabled?: boolean;
  scopeLabel?: string;
  shared?: boolean;
  onSharedChange?: (shared: boolean) => void;
}

interface ScriptFieldsTouched {
  name: boolean;
  command: boolean;
}

const ALL_TOUCHED: ScriptFieldsTouched = { name: true, command: true };
const NONE_TOUCHED: ScriptFieldsTouched = { name: false, command: false };

export function ScriptEditModal({
  script,
  onChange,
  onCancel,
  onSave,
  pending = false,
  error,
  headerTitle,
  saveDisabled = false,
  scopeLabel,
  shared = false,
  onSharedChange,
}: ScriptEditModalProps) {
  const { t } = useTranslation();
  const [touched, setTouched] = useState<ScriptFieldsTouched>(NONE_TOUCHED);

  useEffect(() => {
    setTouched(NONE_TOUCHED);
  }, [script.id]);

  const markTouched = useCallback((field: keyof ScriptFieldsTouched) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }, []);

  const handleNameChange = useCallback(
    (text: string) => onChange({ ...script, name: text }),
    [onChange, script],
  );
  const handleCommandChange = useCallback(
    (text: string) => onChange({ ...script, commandText: text }),
    [onChange, script],
  );
  const handleServiceToggle = useCallback(
    (next: boolean) => onChange({ ...script, type: next ? SCRIPT_SERVICE_TYPE : "" }),
    [onChange, script],
  );

  const handleNameBlur = useCallback(() => markTouched("name"), [markTouched]);
  const handleCommandBlur = useCallback(() => markTouched("command"), [markTouched]);

  const cancel = useCallback(() => {
    if (!pending) onCancel();
  }, [onCancel, pending]);
  const validation = validateScript(script, t);

  const handleSavePress = useCallback(() => {
    if (validation.hasErrors) {
      setTouched(ALL_TOUCHED);
      return;
    }
    onSave();
  }, [validation.hasErrors, onSave]);

  const showNameError = touched.name && validation.nameError;
  const showCommandError = touched.command && validation.commandError;
  const isService = script.type === SCRIPT_SERVICE_TYPE;
  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title:
        headerTitle ??
        (script.name
          ? t("settings.project.scripts.editScript", { name: script.name })
          : t("settings.project.scripts.newScript")),
    }),
    [headerTitle, script.name, t],
  );

  return (
    <AdaptiveModalSheet
      visible
      header={sheetHeader}
      onClose={cancel}
      testID="script-edit-modal"
      desktopMaxWidth={560}
    >
      {scopeLabel ? <Text style={styles.modalHint}>{scopeLabel}</Text> : null}
      <View style={styles.modalSection}>
        <Text style={styles.modalLabel}>{t("settings.project.scripts.name")}</Text>
        <TextInput
          testID="script-edit-name"
          accessibilityLabel={t("settings.project.scripts.nameAccessibility")}
          editable={!pending}
          initialValue={script.name}
          onChangeText={handleNameChange}
          onBlur={handleNameBlur}
          placeholder="dev"
          placeholderTextColor={styles.placeholderColor.color}
          style={styles.modalInput}
        />
        {showNameError ? (
          <Text testID="script-edit-name-error" style={styles.fieldError}>
            {validation.nameError}
          </Text>
        ) : null}
      </View>
      <View style={styles.modalSection}>
        <Text style={styles.modalLabel}>{t("settings.project.scripts.command")}</Text>
        <TextInput
          testID="script-edit-command"
          accessibilityLabel={t("settings.project.scripts.commandAccessibility")}
          multiline
          editable={!pending}
          initialValue={script.commandText}
          onChangeText={handleCommandChange}
          onBlur={handleCommandBlur}
          placeholder="npm run dev"
          placeholderTextColor={styles.placeholderColor.color}
          style={styles.modalMultilineInput}
        />
        {showCommandError ? (
          <Text testID="script-edit-command-error" style={styles.fieldError}>
            {validation.commandError}
          </Text>
        ) : null}
      </View>
      <View style={styles.modalSection}>
        <View style={styles.serviceToggleRow}>
          <View style={styles.serviceToggleText}>
            <Text style={styles.serviceToggleLabel}>
              {t("settings.project.scripts.runAsService")}
            </Text>
            <Text style={styles.modalHint}>{t("settings.project.scripts.serviceHint")}</Text>
          </View>
          <Switch
            disabled={pending}
            value={isService}
            onValueChange={handleServiceToggle}
            accessibilityLabel={t("settings.project.scripts.runAsService")}
            testID="script-edit-service-toggle"
          />
        </View>
      </View>
      {onSharedChange ? (
        <View style={styles.serviceToggleRow}>
          <View style={styles.serviceToggleText}>
            <Text style={styles.serviceToggleLabel}>{t("settings.project.scripts.shared")}</Text>
            <Text style={styles.modalHint}>{t("settings.project.scripts.sharedScope")}</Text>
          </View>
          <Switch
            disabled={pending}
            value={shared}
            onValueChange={onSharedChange}
            accessibilityLabel={t("settings.project.scripts.shared")}
            testID="script-edit-shared-toggle"
          />
        </View>
      ) : null}
      {error}
      <View style={styles.modalFooter}>
        <Button
          disabled={pending}
          onPress={onCancel}
          variant="ghost"
          size="md"
          testID="script-edit-cancel"
        >
          {t("settings.project.actions.cancel")}
        </Button>
        <Button
          disabled={pending || saveDisabled}
          loading={pending}
          loadingMode="replace"
          accessibilityLabel={t("settings.project.actions.save")}
          onPress={handleSavePress}
          variant="default"
          size="md"
          testID="script-edit-save"
        >
          {t("settings.project.actions.save")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  modalSection: {
    gap: theme.spacing[2],
  },
  modalLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  modalInput: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  modalMultilineInput: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    minHeight: 100,
    textAlignVertical: "top",
  },
  modalFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  fieldError: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  serviceToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  serviceToggleText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  serviceToggleLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  modalHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
}));
