const key = 'musing-lab-results-v1';

export function getResults() {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}

export function saveResult(result) {
  const results = getResults();
  results.push({ id: crypto.randomUUID(), at: new Date().toISOString(), ...result });
  localStorage.setItem(key, JSON.stringify(results));
  return results;
}

export function exportResults() {
  const blob = new Blob([JSON.stringify(getResults(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `musing-results-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
