export function formatResponseReference(reference: { id: string; preview: string }): string {
  const label = reference.preview.replace(/[\\[\]]/g, "\\$&").replace(/\s+/g, " ");
  return `[Replying to: ${label}](paseo-response://${reference.id})`;
}

export function responseReferenceIds(text: string): string[] {
  return [
    ...new Set(
      Array.from(
        text.matchAll(/paseo-response:\/\/([a-f0-9]{64})(?![a-f0-9])/g),
        (match) => match[1],
      ),
    ),
  ];
}
