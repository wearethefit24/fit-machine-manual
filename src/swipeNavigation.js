// Pure navigation and gesture decisions, shared by the viewer and unit tests.
export function getViewerParentRoute(route, catalog) {
  const parts = route.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  const [type, id] = parts;
  if (type === 'store') {
    return catalog.stores.some(store => store.id === id) ? '/' : null;
  }
  if (type === 'area') {
    const area = catalog.areas.find(item => item.id === id);
    if (!area) return null;
    return catalog.stores.some(store => store.id === area.storeId)
      ? '/store/' + area.storeId : '/';
  }
  if (type === 'machine') {
    const machine = catalog.machines.find(item => item.id === id);
    if (!machine) return null;
    return catalog.areas.some(area => area.id === machine.areaId)
      ? '/area/' + machine.areaId : '/';
  }
  return null;
}

export function shouldCompleteSwipe(distance, viewportWidth, velocity) {
  if (distance <= 0) return false;
  // A deliberate slow drag or a shorter, fast flick both feel native.
  const threshold = Math.min(170, Math.max(98, viewportWidth * 0.29));
  return distance >= threshold || (distance >= 56 && velocity > 0.55);
}
