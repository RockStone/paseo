// Paseoi builds stamp this suffix on the app version. It switches on the Paseoi
// storage, the 6770 listener and the manual update policy at runtime.
const CUSTOM_BUILD_VERSION_SUFFIX = /-paseoi\.\d+$/;

export function isCustomBuildVersion(version: string): boolean {
  return CUSTOM_BUILD_VERSION_SUFFIX.test(version);
}

export function stripCustomBuildVersion(version: string): string {
  return version.replace(CUSTOM_BUILD_VERSION_SUFFIX, "");
}
