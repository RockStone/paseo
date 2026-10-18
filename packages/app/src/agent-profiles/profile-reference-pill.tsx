import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { AttachmentLabel, AttachmentPill } from "@/components/attachment-pill";
import type { AgentProfileComposerAttachment } from "@/attachments/types";
import { AgentProfileGlyph } from "./internal/agent-profile-glyph";
import { profileReferenceToAgentAttachment } from "./profile-reference";

interface AgentProfileReferencePillProps {
  attachment: AgentProfileComposerAttachment;
  index: number;
  disabled: boolean;
  onRemove: (index: number) => void;
}

export function AgentProfileReferencePill({
  attachment,
  index,
  disabled,
  onRemove,
}: AgentProfileReferencePillProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const remove = useCallback(() => onRemove(index), [index, onRemove]);
  const { profile } = attachment;
  const header = useMemo(() => ({ title: profile.name }), [profile.name]);
  const summary = [profile.provider, profile.model].filter(Boolean).join(" · ");
  const icon = useMemo(
    () => <AgentProfileGlyph icon={profile.icon} color={profile.color} />,
    [profile.icon, profile.color],
  );
  return (
    <>
      <AttachmentPill
        testID="composer-agent-profile-pill"
        onOpen={open}
        onRemove={remove}
        disabled={disabled}
        openAccessibilityLabel={t("agentAutocomplete.openProfile", { name: profile.name })}
        removeAccessibilityLabel={t("agentAutocomplete.removeProfile", { name: profile.name })}
      >
        <AttachmentLabel icon={icon} title={`@${profile.name}`} subtitle={summary} />
      </AttachmentPill>
      <AdaptiveModalSheet visible={visible} onClose={close} header={header}>
        <Text selectable style={styles.details}>
          {profileReferenceToAgentAttachment(attachment).text}
        </Text>
      </AdaptiveModalSheet>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  details: { color: theme.colors.foreground, fontSize: 13, lineHeight: 20, padding: 24 },
}));
