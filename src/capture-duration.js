const key = 'musing-lab-capture-seconds-v1';
const options = [0.5, 1, 1.5, 2, 3];

export function getCaptureSeconds() {
  return Number(document.getElementById('capture-duration').value);
}

export function minimumReadings(seconds) {
  return Math.max(3, Math.min(8, Math.floor(seconds * 5)));
}

export function initCaptureDuration() {
  const select = document.getElementById('capture-duration');
  try {
    const saved = Number(localStorage.getItem(key));
    if (options.includes(saved)) select.value = String(saved);
  } catch { /* Keep the default when storage is unavailable. */ }
  select.addEventListener('change', () => {
    try { localStorage.setItem(key, select.value); } catch { /* The current selection still works. */ }
  });
}
