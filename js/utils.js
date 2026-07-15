/* ═══════════════════════════════════════════════
   utils.js — Helpers (dates, IDs, formatting)
   ═══════════════════════════════════════════════ */

const Utils = (() => {
  'use strict';

  let _idCounter = 0;
  function generateId() {
    _idCounter = (_idCounter + 1) % 0xffff;
    return Date.now().toString(36) + _idCounter.toString(36).padStart(4, '0') + Math.random().toString(36).slice(2, 8);
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatFullTime(ts) {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  function estimateTokens(text) {
    if (!text) return 0;
    let tokens = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code > 0x7ff) tokens += 2;
      else if (code > 0x7f) tokens += 1.5;
      else tokens += 0.25;
    }
    return Math.max(1, Math.ceil(tokens));
  }

  function truncate(text, len = 100) {
    if (!text) return '';
    return text.length > len ? text.slice(0, len) + '…' : text;
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  const _escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => _escapeMap[c]);
  }

  function deepClone(obj) {
    if (typeof structuredClone === 'function') {
      return structuredClone(obj);
    }
    return JSON.parse(JSON.stringify(obj));
  }

  function isObject(val) {
    return val !== null && typeof val === 'object' && !Array.isArray(val);
  }

  return { generateId, formatTime, formatFullTime, estimateTokens, truncate, debounce, escapeHtml, deepClone, isObject };
})();

// Explicit global (rather than relying on classic-script implicit scope sharing).
if (typeof window !== 'undefined') {
  window.Utils = Utils;
}

// Expose to Node's CommonJS module system for unit tests (tests/utils.test.js),
// while leaving browser usage (plain global `Utils`) untouched.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Utils;
}