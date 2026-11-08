/**
 * Safe cross-browser clipboard helper with fallback and explicit error return.
 * Never swallows copy failures silently.
 */
export async function copyTextToClipboard(text, env = globalThis) {
  const payload = String(text ?? '');
  if (!payload) {
    return { ok: false, error: 'Nothing to copy yet.' };
  }

  try {
    if (env?.navigator?.clipboard?.writeText) {
      await env.navigator.clipboard.writeText(payload);
      return { ok: true };
    }
  } catch {
    // Fall through to document.execCommand fallback when Permissions-Policy or HTTP blocks Clipboard API
  }

  try {
    const doc = env?.document;
    if (!doc?.createElement || !doc?.body) {
      return {
        ok: false,
        error: 'Clipboard access is unavailable in this environment.',
      };
    }
    const area = doc.createElement('textarea');
    area.value = payload;
    area.setAttribute('readonly', 'true');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    doc.body.appendChild(area);
    area.select();
    const copied =
      typeof doc.execCommand === 'function' ? doc.execCommand('copy') : false;
    doc.body.removeChild(area);
    if (!copied) {
      return {
        ok: false,
        error: 'Browser blocked automatic copy — select the text manually and press Ctrl+C / Cmd+C.',
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: 'Browser blocked automatic copy — select the text manually and press Ctrl+C / Cmd+C.',
    };
  }
}
