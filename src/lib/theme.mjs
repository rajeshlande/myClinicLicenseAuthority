export const THEME_STORAGE_KEY = 'myclinic.authority.theme';

export function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light';
}

export function resolveInitialTheme(storage = globalThis.localStorage) {
  try {
    const saved = storage?.getItem?.(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // Ignore storage access errors in strict sandboxes
  }
  return 'light';
}

export function nextTheme(current) {
  return normalizeTheme(current) === 'light' ? 'dark' : 'light';
}

export function applyDocumentTheme(
  theme,
  doc = globalThis.document,
  storage = globalThis.localStorage,
) {
  const clean = normalizeTheme(theme);
  if (doc?.documentElement) {
    doc.documentElement.setAttribute('data-theme', clean);
  }
  try {
    storage?.setItem?.(THEME_STORAGE_KEY, clean);
  } catch {
    // Ignore storage write errors
  }
  return clean;
}
