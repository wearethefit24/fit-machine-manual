// QR scanner starts at a fixed 1.5x zoom.
export const QR_CAMERA_ZOOM = 1.5;

// Use the camera track's real zoom when it is exposed by the browser.
// Unsupported tracks fall back to a centered 1.5x crop of the video preview.
export async function applyPreferredQrZoom(track) {
  if (!track || typeof track.getCapabilities !== 'function' ||
      typeof track.applyConstraints !== 'function') return false;
  try {
    const { zoom } = track.getCapabilities();
    if (!zoom || typeof zoom.min !== 'number' || typeof zoom.max !== 'number' ||
        zoom.min > QR_CAMERA_ZOOM || zoom.max < QR_CAMERA_ZOOM) return false;
    await track.applyConstraints({ advanced: [{ zoom: QR_CAMERA_ZOOM }] });
    const actualZoom = track.getSettings?.().zoom;
    // Some browsers apply zoom but omit it from getSettings().
    return typeof actualZoom !== 'number' ||
      Math.abs(actualZoom - QR_CAMERA_ZOOM) < 0.05;
  } catch {
    // Lack of track zoom should never stop the QR scanner from working.
    return false;
  }
}
