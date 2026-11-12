// A manual opened from an on-screen machine list can return to that list.
// A direct QR link (or in-app QR scan) has no matching history-state origin,
// so it always returns to the root store selection screen.
export function manualReturnPath(machineId, navigationState, publicAreas) {
  const origin = navigationState?.manualListOrigin;
  if (
    origin?.machineId === machineId &&
    typeof origin.areaId === 'string' &&
    publicAreas.some(area => area.id === origin.areaId)
  ) return '/area/' + origin.areaId;
  return '/';
}
