import { useCallback, useMemo, useRef, type PropsWithChildren } from "react";
import { Pressable, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Copy, GitBranch } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { useBranchSwitcher } from "@/hooks/use-branch-switcher";
import { ToolbarLabelSelectTrigger } from "@/components/ui/toolbar-label-trigger";
import { composerPillStyles } from "@/composer/pill-styles";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { useWorkspaceClipboardActions } from "@/hooks/use-workspace-clipboard-actions";

function BranchCopyMenu({
  branchName,
  onCopy,
  children,
}: PropsWithChildren<{
  branchName: string;
  onCopy: (branchName: string) => void;
}>) {
  const { t } = useTranslation();
  const handleCopy = useCallback(() => onCopy(branchName), [branchName, onCopy]);
  return (
    <ContextMenu>
      <ContextMenuTrigger contextOnly>{children}</ContextMenuTrigger>
      <ContextMenuContent testID="branch-copy-context-menu" minWidth={0}>
        <ContextMenuItem onSelect={handleCopy}>
          {t("sidebar.workspace.actions.copyBranchName")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

interface BranchSwitcherProps {
  currentBranchName: string | null;
  serverId: string;
  workspaceId: string;
  workspaceDirectory: string | null;
  isGitCheckout: boolean;
  variant?: "toolbar" | "composer";
  checkoutPath?: string;
  testID?: string;
}

const foregroundMutedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const ThemedGitBranch = withUnistyles(GitBranch);
const ThemedChevronDown = withUnistyles(ChevronDown);

export function BranchSwitcher({
  currentBranchName,
  serverId,
  workspaceId,
  workspaceDirectory,
  isGitCheckout,
  variant = "toolbar",
  checkoutPath,
  testID = "workspace-header-branch-switcher",
}: BranchSwitcherProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const toast = useToast();
  const queryClient = useQueryClient();
  const { copyBranchName } = useWorkspaceClipboardActions();

  const { branchOptions, isOpen, setIsOpen, handleBranchSelect } = useBranchSwitcher({
    client,
    normalizedServerId: serverId,
    normalizedWorkspaceId: workspaceId,
    workspaceDirectory,
    currentBranchName,
    isGitCheckout,
    isConnected,
    toast,
    queryClient,
  });

  const handleCopyBranch = useCallback(
    (branchName: string) => {
      setIsOpen(false);
      void copyBranchName({ currentBranch: branchName });
    },
    [copyBranchName, setIsOpen],
  );
  const handleCopyCurrentBranch = useCallback(() => {
    if (currentBranchName) handleCopyBranch(currentBranchName);
  }, [currentBranchName, handleCopyBranch]);

  const handleOpen = useCallback(() => setIsOpen(true), [setIsOpen]);

  const branchLeadingSlot = useMemo(
    () => <ThemedGitBranch size={14} uniProps={foregroundMutedIconColorMapping} />,
    [],
  );

  const renderBranchOption = useCallback<NonNullable<ComboboxProps["renderOption"]>>(
    ({ option, selected, active, onPress }) => (
      <BranchCopyMenu branchName={option.id} onCopy={handleCopyBranch}>
        <ComboboxItem
          label={option.label}
          selected={selected}
          active={active}
          onPress={onPress}
          leadingSlot={branchLeadingSlot}
          testID={`branch-option-${option.id}`}
        />
      </BranchCopyMenu>
    ),
    [branchLeadingSlot, handleCopyBranch],
  );

  const checkoutFooter = useMemo(
    () => (
      <View>
        {currentBranchName ? (
          <Button
            testID="branch-copy-current"
            variant="ghost"
            size="sm"
            leftIcon={Copy}
            onPress={handleCopyCurrentBranch}
            style={styles.copyAction}
          >
            {t("sidebar.workspace.actions.copyBranchName")}
          </Button>
        ) : null}
        {checkoutPath ? (
          <Text style={[styles.tooltipText, styles.checkoutPath]}>{checkoutPath}</Text>
        ) : null}
      </View>
    ),
    [checkoutPath, currentBranchName, handleCopyCurrentBranch, t],
  );

  if (!currentBranchName && variant !== "composer") {
    return null;
  }
  const label = currentBranchName ?? "HEAD";
  const accessibilityLabel = t("branchSwitcher.currentBranch", { branchName: label });

  return (
    <View ref={anchorRef} collapsable={false} style={styles.anchor}>
      <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          {variant === "composer" ? (
            <Pressable
              testID={testID}
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              onPress={handleOpen}
              style={[
                composerPillStyles.body,
                styles.pill,
                isOpen && composerPillStyles.bodyActive,
              ]}
            >
              {branchLeadingSlot}
              <Text
                style={[composerPillStyles.label, styles.branchLabel]}
                numberOfLines={1}
                ellipsizeMode="middle"
              >
                {label}
              </Text>
              <ThemedChevronDown size={12} uniProps={foregroundMutedIconColorMapping} />
            </Pressable>
          ) : (
            <ToolbarLabelSelectTrigger
              testID={testID}
              label={label}
              open={isOpen}
              onPress={handleOpen}
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
            />
          )}
        </TooltipTrigger>
        <TooltipContent side={variant === "composer" ? "top" : "bottom"} maxWidth={420}>
          <Text style={styles.tooltipText}>
            {variant === "composer" ? label : t("branchSwitcher.triggerTooltip")}
          </Text>
          {checkoutPath ? (
            <Text testID="composer-checkout-path" style={styles.tooltipText}>
              {checkoutPath}
            </Text>
          ) : null}
        </TooltipContent>
      </Tooltip>
      <Combobox
        options={branchOptions}
        value={currentBranchName ?? ""}
        onSelect={handleBranchSelect}
        searchable
        placeholder={t("branchSwitcher.placeholder")}
        searchPlaceholder={t("branchSwitcher.searchPlaceholder")}
        emptyText={t("branchSwitcher.empty")}
        title={t("branchSwitcher.title")}
        open={isOpen}
        onOpenChange={setIsOpen}
        anchorRef={anchorRef}
        desktopPlacement={variant === "composer" ? "top-start" : "bottom-start"}
        footer={checkoutFooter}
        desktopPreventInitialFlash
        desktopMinWidth={280}
        renderOption={renderBranchOption}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  anchor: {
    flexShrink: 1,
    minWidth: 0,
  },
  pill: { maxWidth: 240 },
  branchLabel: { flexShrink: 1 },
  checkoutPath: { padding: theme.spacing[3] },
  copyAction: { alignSelf: "flex-start", margin: theme.spacing[1] },
  tooltipText: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.sm,
  },
}));
