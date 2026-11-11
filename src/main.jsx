import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './style.css';
// Prevent browser page magnification without blocking ordinary scrolling
// or the dedicated cropper's zoom slider.
function preventBrowserPinchZoom(event) {
  if (!event.cancelable) return;
  if (event.type.startsWith('gesture') || event.touches?.length > 1) {
    event.preventDefault();
  }
}
document.addEventListener('touchstart', preventBrowserPinchZoom, { passive: false });
document.addEventListener('touchmove', preventBrowserPinchZoom, { passive: false });
document.addEventListener('gesturestart', preventBrowserPinchZoom, { passive: false });
document.addEventListener('gesturechange', preventBrowserPinchZoom, { passive: false });

createRoot(document.getElementById('root')).render(<App />);
