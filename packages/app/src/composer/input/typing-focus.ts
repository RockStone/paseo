export interface TypingFocusInput {
  enabled: boolean;
  inputRef: { readonly current: { focus(): void } | null };
}

export function useTypingFocus(_input: TypingFocusInput): void {}
