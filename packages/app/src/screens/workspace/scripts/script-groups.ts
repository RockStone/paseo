export function groupScripts<T>(
  scripts: readonly T[],
  name: (script: T) => string,
  sharedNames: readonly string[],
) {
  const sharedSet = new Set(sharedNames);
  const shared: T[] = [];
  const workspace: T[] = [];
  for (const script of scripts) (sharedSet.has(name(script)) ? shared : workspace).push(script);
  return { shared, workspace };
}
