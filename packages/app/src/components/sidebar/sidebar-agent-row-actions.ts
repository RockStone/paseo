// Paseoi: the kebab on a sidebar agent row is revealed by hover on a desktop with a mouse and
// shown permanently wherever nobody can hover. It stays while its menu is open so a sheet that
// covers the row cannot unmount the control that owns it.
export function agentRowKebabVisible(input: {
  hovered: boolean;
  controlsAlwaysVisible: boolean;
  menuOpen: boolean;
}): boolean {
  return input.hovered || input.controlsAlwaysVisible || input.menuOpen;
}
