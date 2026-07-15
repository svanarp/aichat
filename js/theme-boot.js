/* ═══════════════════════════════════════════════
   theme-boot.js — Apply saved theme/mode before first paint (avoids FOUC).
   Must load synchronously in <head>, before the stylesheets.
   Kept as an external file (rather than an inline <script>) so the page
   can enforce a strict script-src CSP with no 'unsafe-inline'.
   ═══════════════════════════════════════════════ */
(function () {
  try {
    const t = localStorage.getItem('chai-theme') || 'aurora-flux';
    const m = localStorage.getItem('chai-mode') || 'light';
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.setAttribute('data-mode', m);
  } catch (_) {
    // localStorage unavailable (e.g. private browsing) — keep the default theme/mode.
  }
})();
