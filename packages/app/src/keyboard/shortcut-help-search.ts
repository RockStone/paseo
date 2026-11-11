import type { KeyboardShortcutHelpSection } from "@/keyboard/keyboard-shortcuts";
import { formatShortcut, type ShortcutKey, type ShortcutOs } from "@/utils/format-shortcut";

/** Resolves an i18n key to display text. The caller's `t`, injected. */
export type TranslateHelpKey = (key: string) => string;

/**
 * Alternative spellings for one combo, so searching "cmd k" and "command+k" both
 * find ⌘K. The modifier a user types rarely matches the token the binding
 * stores, and never matches the symbol the badge renders.
 */
export function shortcutSearchAliases(
  keys: readonly ShortcutKey[],
  shortcutOs: ShortcutOs,
): string {
  const aliases = keys.map((key) => {
    if (shortcutOs === "mac") {
      if (key === "mod" || key === "meta") return ["cmd", "command"];
      if (key === "alt") return ["alt", "option"];
    } else {
      if (key === "mod" || key === "ctrl") return ["ctrl", "control"];
      if (key === "meta") return ["win", "windows"];
    }
    return [key];
  });
  const combinations = aliases.reduce<string[][]>(
    (prefixes, choices) =>
      prefixes.flatMap((prefix) => choices.map((choice) => [...prefix, choice])),
    [[]],
  );
  return combinations
    .flatMap((combination) => [combination.join(" "), combination.join("+")])
    .join(" ");
}

/**
 * Search text for one row's keys. Built per combo and joined, never over a
 * flattened chord: the alias expansion is combinatorial, so flattening a
 * multi-step chord into one key list both explodes the combination count and
 * invents aliases for combos the user never has to press together.
 */
export function shortcutSearchText(chord: ShortcutKey[][], shortcutOs: ShortcutOs): string {
  return chord
    .flatMap((combo) => [
      combo.join(" "),
      formatShortcut(combo, shortcutOs),
      shortcutSearchAliases(combo, shortcutOs),
    ])
    .join(" ");
}

// Only the Latin, Greek and Cyrillic combining accents. Stripping every mark would also strip the
// Japanese voicing marks, so a search for カ would find ガ.
const COMBINING_ACCENTS = /[\u0300-\u036f]/g;

/** Case- and accent-folded, so "categorias" finds "Categorías" and "ecran" finds "Écran". */
function foldForSearch(text: string): string {
  return text.normalize("NFD").replace(COMBINING_ACCENTS, "").normalize("NFC").toLocaleLowerCase();
}

/**
 * The cheat sheet's sections narrowed to a query, matching on the row's label,
 * its note, and every spelling of the keys that actually fire it. A section
 * whose own title matches keeps all of its rows.
 */
export function filterShortcutHelpSections({
  sections,
  query,
  translate,
  shortcutOs,
}: {
  sections: readonly KeyboardShortcutHelpSection[];
  query: string;
  translate: TranslateHelpKey;
  shortcutOs: ShortcutOs;
}): KeyboardShortcutHelpSection[] {
  const normalizedQuery = foldForSearch(query.trim());
  if (!normalizedQuery) return [...sections];

  return sections.flatMap((section) => {
    if (foldForSearch(translate(section.titleKey)).includes(normalizedQuery)) {
      return [section];
    }

    const rows = section.rows.filter((row) => {
      const searchText = [
        translate(row.labelKey),
        row.noteKey ? translate(row.noteKey) : row.note,
        row.chord ? shortcutSearchText(row.chord, shortcutOs) : null,
      ]
        .filter(Boolean)
        .join(" ");
      return foldForSearch(searchText).includes(normalizedQuery);
    });

    return rows.length > 0 ? [{ ...section, rows }] : [];
  });
}
