import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { useCallback } from "react";
import { Pressable, View } from "react-native";
import type { Styles } from "./theme";

/** A compact search box with a clear button once it has text. */
export function SearchField(props: {
  styles: Styles;
  theme: PluginTheme;
  value: string;
  placeholder: string;
  onChange(next: string): void;
}) {
  const { styles, theme, value, placeholder, onChange } = props;
  const clear = useCallback(() => onChange(""), [onChange]);
  return (
    <View style={styles.searchBox}>
      <Icon name="Search" size={14} color={theme.colors.foregroundMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        style={styles.searchInput}
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {value ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={clear}
          hitSlop={8}
          style={styles.iconButton}
        >
          <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}
