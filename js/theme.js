/* ═══════════════════════════════════════════════
   theme.js — Theme & mode management
   ═══════════════════════════════════════════════ */

;(() => {
  const UI = window.UI = window.UI || {};

  const THEMES = [
    { id: 'aurora-flux', label: 'Aurora Flux' },
    { id: 'ocean-ember', label: 'Ocean Ember' },
    { id: 'graphite-candy', label: 'Graphite Candy' },
    { id: 'mint-galaxy', label: 'Mint Galaxy' },
    { id: 'sakura-tech', label: 'Sakura Tech' },
    { id: 'citrus-garden', label: 'Citrus Garden' },
    { id: 'lavender-forest', label: 'Lavender Forest' },
    { id: 'neon-noir', label: 'Neon Noir' },
    { id: 'solar-mirage', label: 'Solar Mirage' },
    { id: 'retro-arcade', label: 'Retro Arcade' }
  ];

  function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') || 'aurora-flux';
  }

  function getCurrentMode() {
    return document.documentElement.getAttribute('data-mode') || 'light';
  }

  function setTheme(themeId) {
    document.documentElement.setAttribute('data-theme', themeId);
    try {
      localStorage.setItem('chai-theme', themeId);
    } catch (err) {
      console.error('[Theme] Failed to save theme:', err);
    }
    const sel = document.getElementById('rs-theme-select');
    if (sel) sel.value = themeId;
    const mode = getCurrentMode();
    document.documentElement.setAttribute('data-mode', mode);
  }

  function setMode(mode) {
    document.documentElement.setAttribute('data-mode', mode);
    try {
      localStorage.setItem('chai-mode', mode);
    } catch (err) {
      console.error('[Theme] Failed to save mode:', err);
    }
  }

  function toggleMode() {
    const current = getCurrentMode();
    setMode(current === 'dark' ? 'light' : 'dark');
  }

  function populateThemeSelector() {
    const sel = document.getElementById('rs-theme-select');
    const modeBtn = document.getElementById('rs-mode-toggle');
    if (!sel) return;

    const savedTheme = localStorage.getItem('chai-theme') || 'aurora-flux';
    const savedMode = localStorage.getItem('chai-mode') || 'light';

    sel.innerHTML = THEMES.map(t =>
      `<option value="${t.id}"${t.id === savedTheme ? ' selected' : ''}>${t.label}</option>`
    ).join('');

    sel.addEventListener('change', () => {
      setTheme(sel.value);
      UI.showToast('Theme: ' + sel.options[sel.selectedIndex].text, 'success');
    });

    if (modeBtn) {
      // Show the correct icon for the saved mode (set on load AND on toggle).
      modeBtn.textContent = savedMode === 'dark' ? '🌙' : '☀️';
      modeBtn.addEventListener('click', () => {
        toggleMode();
        const newMode = getCurrentMode();
        const btn = document.getElementById('rs-mode-toggle');
        if (btn) btn.textContent = newMode === 'dark' ? '🌙' : '☀️';
        UI.showToast('Switched to ' + newMode + ' mode', 'success');
      });
    }

    setTheme(savedTheme);
    setMode(savedMode);
  }

  Object.assign(UI, {
    THEMES,
    getCurrentTheme,
    getCurrentMode,
    setTheme,
    setMode,
    toggleMode,
    populateThemeSelector
  });
})();
