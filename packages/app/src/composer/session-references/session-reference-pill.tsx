import { useCallback, useMemo, useState } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { AttachmentLabel, AttachmentPill } from "@/components/attachment-pill";
import {
  sessionReferenceToAgentAttachment,
  type SessionReferenceAttachment,
} from "@/attachments/session-reference";

interface SessionReferencePillProps {
  attachment: SessionReferenceAttachment;
  index: number;
  disabled: boolean;
  onRemove: (index: number) => void;
}

export function SessionReferencePill({
  attachment,
  index,
  disabled,
  onRemove,
}: SessionReferencePillProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  const remove = useCallback(() => onRemove(index), [index, onRemove]);
  const header = useMemo(() => ({ title: attachment.title }), [attachment.title]);
  const subtitle = `${t(`sessionReference.${attachment.referenceType}`)} · ${attachment.id.slice(0, 8)}`;
  return (
    <>
      <AttachmentPill
        testID="composer-session-reference-pill"
        onOpen={open}
        onRemove={remove}
        disabled={disabled}
        openAccessibilityLabel={t("sessionReference.open", { title: attachment.title })}
        removeAccessibilityLabel={t("sessionReference.remove", { title: attachment.title })}
      >
        <AttachmentLabel title={`#${attachment.title}`} subtitle={subtitle} />
      </AttachmentPill>
      <AdaptiveModalSheet visible={visible} onClose={close} header={header}>
        <Text selectable style={styles.details}>
          {sessionReferenceToAgentAttachment(attachment).text}
        </Text>
      </AdaptiveModalSheet>
    </>
  );
}
const styles = StyleSheet.create((theme) => ({
  details: { color: theme.colors.foreground, fontSize: 13, lineHeight: 20, padding: 24 },
}));
