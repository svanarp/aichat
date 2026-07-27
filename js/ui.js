/* ═══════════════════════════════════════════════
   ui.js — Shared utilities, markdown, roles, init
   ═══════════════════════════════════════════════ */

;(() => {
  const UI = window.UI = window.UI || {};

  const ALLOWED_MARKDOWN_TAGS = new Set([
    'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'details', 'div', 'dl', 'dt',
    'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'kbd', 'li', 'ol', 'p',
    'pre', 's', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'th',
    'thead', 'tr', 'ul'
  ]);

  const ALLOWED_CLASSES = new Set([
    'reasoning-block', 'reasoning-content'
  ]);

  function isSafeUrl(value) {
    if (!value) return false;
    try {
      const url = new URL(value, window.location.href);
      return ['http:', 'https:', 'mailto:'].includes(url.protocol);
    } catch (_) {
      return false;
    }
  }

  function sanitizeHtml(html) {
    if (typeof DOMPurify === 'undefined') {
      // Fail closed: if the sanitizer library didn't load, never inject raw HTML.
      console.error('[UI] DOMPurify unavailable — falling back to plain-text escaping');
      return Utils.escapeHtml(html);
    }
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: Array.from(ALLOWED_MARKDOWN_TAGS),
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class'],
      // Only allow http(s)/mailto links plus same-document/relative references —
      // blocks javascript:, data:, vbscript:, etc.
      ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|[^a-z]|[a-z0-9+.-]+(?:[^a-z0-9+.:-]|$))/i,
      ALLOW_DATA_ATTR: false
    });
  }

  // DOMPurify hooks (registered once): restrict `class` to our known-safe
  // set, and force safe `rel`/`target` on any links that survive sanitizing.
  if (typeof DOMPurify !== 'undefined') {
    DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
      if (data.attrName !== 'class') return;
      const safeClasses = (data.attrValue || '').split(/\s+/).filter(cls =>
        ALLOWED_CLASSES.has(cls) || /^language-[a-z0-9_+-]+$/i.test(cls) || /^hljs/.test(cls)
      );
      data.attrValue = safeClasses.join(' ');
      if (!data.attrValue) data.keepAttr = false;
    });
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
      if (node.tagName === 'A' && node.hasAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  function preprocessReasoning(content) {
    if (!content) return '';

    let processed = content.replace(/<(think|reasoning)>([\s\S]*?)<\/(think|reasoning)>/gi, (match, openTag, p1) => {
      const safeContent = Utils.escapeHtml(p1);
      return `<details class="reasoning-block">
        <summary>🧠 Reasoning (click to expand)</summary>
        <div class="reasoning-content">${safeContent}</div>
      </details>`;
    });

    processed = processed.replace(/\<\|channel\>thought\n?([\s\S]*?)\<channel\|\>/gi, (match, p1) => {
      const safeContent = Utils.escapeHtml(p1);
      return `<details class="reasoning-block">
        <summary>🧠 Reasoning (click to expand)</summary>
        <div class="reasoning-content">${safeContent}</div>
      </details>`;
    });

    return processed;
  }

  function renderMarkdown(content) {
    const processed = preprocessReasoning(content);
    return sanitizeHtml(marked.parse(processed, { breaks: true }));
  }

  /* ── Toast notification ── */
  function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.setAttribute('role', 'alert');

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.addEventListener('click', () => toast.remove());
    toast.appendChild(closeBtn);

    document.body.appendChild(toast);

    const duration = type === 'error' ? 5000 : 3000;
    toast._hideTimer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 200ms';
      setTimeout(() => toast.remove(), 200);
    }, duration);

    toast.addEventListener('mouseenter', () => {
      clearTimeout(toast._hideTimer);
    });
    toast.addEventListener('mouseleave', () => {
      toast._hideTimer = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 200ms';
        setTimeout(() => toast.remove(), 200);
      }, duration);
    });
  }

  /* ── Typing indicator ── */
  function showTypingIndicator() {
    const container = document.getElementById('chat-messages');
    const existing = container.querySelector('.typing-indicator');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = 'typing-indicator';
    el.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
    container.appendChild(el);
    UI.scrollToBottom();
  }

  function hideTypingIndicator() {
    const el = document.querySelector('.typing-indicator');
    if (el) el.remove();
  }

  /* ── Copy message text to clipboard ── */
  function copyMessageToClipboard(msgId) {
    const chat = ChatManager.getCurrentChat();
    if (!chat) return;
    const msg = chat.messages.find(m => m.id === msgId);
    if (!msg) return;
    navigator.clipboard.writeText(msg.content).then(() => {
      showToast('Message copied', 'success');
    }).catch(() => {
      showToast('Failed to copy', 'error');
    });
  }

  /* ── Copy full conversation to clipboard ── */
  function copyConversationToClipboard() {
    const chat = ChatManager.getCurrentChat();
    if (!chat || !chat.messages.length) {
      showToast('No messages to copy', 'error');
      return;
    }
    const text = chat.messages.map(m => {
      const role = m.role === 'user' ? 'You' : 'AI';
      return `**${role}:** ${m.content}`;
    }).join('\n\n---\n\n');
    navigator.clipboard.writeText(text).then(() => {
      showToast('Conversation copied', 'success');
    }).catch(() => {
      showToast('Failed to copy', 'error');
    });
  }

  /* ── Enter edit mode for a message ── */
  function enterEditMode(msgId) {
    const chat = ChatManager.getCurrentChat();
    if (!chat) return;
    const msg = chat.messages.find(m => m.id === msgId);
    if (!msg || msg.role !== 'user') return;

    const msgEl = document.querySelector(`.message[data-msg-id="${msgId}"]`);
    if (!msgEl) return;
    const bubble = msgEl.querySelector('.message-bubble');
    if (!bubble) return;

    const originalContent = msg.content;
    bubble.innerHTML = `
      <textarea class="message-edit-textarea" data-edit-id="${msgId}">${Utils.escapeHtml(originalContent)}</textarea>
      <div class="message-edit-actions">
        <button class="btn btn-primary btn-edit-save" data-edit-id="${msgId}">Save & Resend</button>
        <button class="btn btn-secondary btn-edit-cancel" data-edit-id="${msgId}">Cancel</button>
      </div>
    `;

    const textarea = bubble.querySelector('.message-edit-textarea');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    textarea.addEventListener('keydown', function handler(e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveEdit(msgId);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit(msgId);
      }
    });
  }

  function saveEdit(msgId) {
    const textarea = document.querySelector(`.message-edit-textarea[data-edit-id="${msgId}"]`);
    if (!textarea) return;
    const newContent = textarea.value.trim();
    if (!newContent) return;
    ChatManager.editAndResend(msgId, newContent);
  }

  function cancelEdit(msgId) {
    const chat = ChatManager.getCurrentChat();
    if (!chat) return;
    UI.renderMessages(chat);
  }

  /* ── Input stats ── */
  function updateInputStats(text) {
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
    const tokens = Utils.estimateTokens(text);
    document.getElementById('token-estimate').textContent = `~${tokens} tokens`;
    document.getElementById('char-count').textContent = `${chars} chars`;
    document.getElementById('word-count').textContent = `${words} words`;
  }

  function autoResizeTextarea(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  /* ── Default personas ── */
  const DEFAULT_ROLES = [
    { id: 'helpful', name: 'Helpful Assistant', prompt: `You are a helpful, practical assistant. Focus on clarity, accuracy, and actionable advice. Be concise and logical.
Prioritize information that is most useful to the user.` },
    { id: 'creative', name: 'Creative Writer', prompt: `You are a creative and imaginative assistant. Think outside the box, use vivid language, and explore unconventional ideas. Be bold and innovative in your responses.
Use metaphors, analogies, and rich descriptions.` },
    { id: 'code', name: 'Code Expert', prompt: `You are an expert programmer. Write clean, efficient, well-commented code.
Explain your reasoning, consider edge cases, and suggest best practices.
When providing code, include type hints and documentation where appropriate.` },
    { id: 'analyst', name: 'Data Analyst', prompt: `You are a meticulous data analyst. Present information clearly with numbers, tables, and structured insights.
Explain your methodology, highlight key findings, and suggest actionable recommendations.
Always cite data sources and note uncertainties.` },
    { id: 'tutor', name: 'Patient Tutor', prompt: `You are a patient and encouraging teacher. Explain concepts from first principles,
break down complex ideas into simple steps, and check for understanding.
Use analogies and real-world examples to make learning engaging.` },
    { id: 'translator', name: 'Translator & Linguist', prompt: `You are a skilled translator and linguist. Provide accurate, natural-sounding translations.
Explain cultural context, idioms, and nuances. When asked, provide multiple translation options
with notes on formality and regional variations.` },
    { id: 'debate', name: 'Debate Partner', prompt: `You are a thoughtful debate partner. Present balanced arguments on both sides of an issue.
Challenge assumptions respectfully, ask probing questions, and help refine reasoning.
Aim for intellectual rigor while remaining open-minded.` },
    { id: 'storyteller', name: 'Storyteller', prompt: `You are a master storyteller. Craft engaging narratives with compelling characters,
vivid settings, and well-paced plots. Use dialogue, sensory details, and emotional arcs.
Adapt your style to any genre from fantasy to noir.` },
    { id: 'consultant', name: 'Business Consultant', prompt: `You are an experienced business consultant. Provide strategic advice with clear frameworks,
SWOT analyses, and actionable roadmaps. Consider market dynamics, competitive positioning,
and financial implications. Be pragmatic and results-oriented.` },
    { id: 'philosopher', name: 'Philosopher', prompt: `You are a thoughtful philosopher. Examine ideas from multiple philosophical traditions,
question assumptions, and explore ethical implications. Use thought experiments and
classical arguments to illuminate complex questions.` }
  ];

  function getAllRoles() {
    const hiddenDefaults = Store.loadHiddenDefaults();
    const defaults = DEFAULT_ROLES
      .filter(r => !hiddenDefaults.includes(r.name))
      .map(r => ({ ...r, isDefault: true }));
    const customRoles = Store.loadCustomRoles().map(r => ({ id: r.id, name: r.name, prompt: r.systemPrompt, isDefault: false }));
    const customNames = new Set(customRoles.map(r => r.name.toLowerCase()));
    return [...defaults.filter(r => !customNames.has(r.name.toLowerCase())), ...customRoles];
  }

  function populateRoleSelect() {
    const sel = document.getElementById('rs-role-select');
    if (!sel) return;
    const roles = getAllRoles();
    sel.innerHTML = '<option value="">— No persona —</option>' + roles.map(r =>
      `<option value="${r.id}">${Utils.escapeHtml(r.name)}</option>`
    ).join('');
  }

  function applyRoleById(roleId) {
    const systemPromptEl = document.getElementById('rs-system-prompt');
    if (!systemPromptEl) return;
    const roles = getAllRoles();
    const role = roles.find(r => r.id === roleId);
    if (role) {
      systemPromptEl.value = role.prompt;
      saveChatSettings();
      showToast('Applied persona: ' + role.name, 'success');
    }
  }

  /* ── Populate sidebar provider profile select ── */
  function populateProfileSelect() {
    const sel = document.getElementById('rs-profile-select');
    if (!sel) return;
    const profiles = Store.loadProfiles();
    const activeId = Store.getActiveProfileId();
    sel.innerHTML = profiles.map(p =>
      `<option value="${p.id}"${p.id === activeId ? ' selected' : ''}>${Utils.escapeHtml(p.name || p.model)}</option>`
    ).join('');
  }

  /* ── Read sidebar controls and save as chat settings ── */
  function saveChatSettings() {
    const settings = getChatSettings();
    ChatManager.updateSettings(settings);
  }

  function getChatSettings() {
    return {
      systemPrompt: document.getElementById('rs-system-prompt')?.value || '',
      thinkingMode: document.getElementById('center-thinking-toggle')?.checked || false,
      temperature: parseFloat(document.getElementById('rs-temperature')?.value) || 0.7,
      maxTokens: Math.max(1, Math.min(131072, parseInt(document.getElementById('rs-max-tokens')?.value) || 8192)),
      reasoningEffort: document.getElementById('rs-reasoning-effort')?.value || 'medium'
    };
  }

  /* ── Initialize right sidebar event listeners ── */
  function initRightSidebar() {
    const toggleBtn = document.getElementById('right-sidebar-toggle');
    const closeBtn = document.getElementById('right-sidebar-close');
    const sidebar = document.getElementById('right-sidebar');

    UI.populateThemeSelector();

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const isNarrow = window.innerWidth <= 1024;
        if (isNarrow) {
          sidebar.classList.toggle('open');
        } else {
          const collapsed = sidebar.classList.toggle('collapsed');
          toggleBtn.classList.toggle('active', !collapsed);
          try {
            localStorage.setItem('chai-right-sidebar-collapsed', collapsed ? '1' : '0');
          } catch (err) {
            console.error('[UI] Failed to save right sidebar state:', err);
          }
        }
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        const isNarrow = window.innerWidth <= 1024;
        if (isNarrow) {
          sidebar.classList.remove('open');
        } else {
          sidebar.classList.add('collapsed');
        }
        if (toggleBtn) toggleBtn.classList.remove('active');
        try {
          localStorage.setItem('chai-right-sidebar-collapsed', '1');
        } catch (err) {
          console.error('[UI] Failed to save right sidebar state:', err);
        }
      });
    }

    const savedState = localStorage.getItem('chai-right-sidebar-collapsed');
    const isNarrow = window.innerWidth <= 1024;
    if (isNarrow) {
      sidebar.classList.remove('open');
    } else if (savedState === '1') {
      sidebar.classList.add('collapsed');
    }

    UI.setupRangeSlider('rs-temperature', 'rs-temp-value');

    const roleSelect = document.getElementById('rs-role-select');
    if (roleSelect) {
      roleSelect.addEventListener('change', () => {
        const val = roleSelect.value;
        if (val) {
          applyRoleById(val);
        } else {
          const systemPromptEl = document.getElementById('rs-system-prompt');
          if (systemPromptEl) {
            systemPromptEl.value = '';
            saveChatSettings();
          }
        }
      });
    }

    document.getElementById('rs-role-manager-btn').addEventListener('click', () => {
      UI.openRoleManagerModal();
    });

    const profileSelect = document.getElementById('rs-profile-select');
    const modelFilter = document.getElementById('rs-model-filter');
    const modelDropdown = document.getElementById('rs-model-dropdown');
    const fetchModelsBtn = document.getElementById('rs-fetch-models-btn');
    let modelList = [];

    function renderDropdown(filterText) {
      const q = (filterText || '').toLowerCase().trim();
      const items = q
        ? modelList.filter(m => m.toLowerCase().includes(q))
        : modelList;
      if (!items.length) {
        modelDropdown.innerHTML = '<div class="model-dropdown-empty">No models match</div>';
        modelDropdown.classList.remove('hidden');
        return;
      }
      modelDropdown.innerHTML = items.map((m, i) =>
        `<div class="model-dropdown-item${i === 0 ? ' active' : ''}" data-model="${m}">${m}</div>`
      ).join('');
      modelDropdown.classList.remove('hidden');
    }

    const clearBtn = document.getElementById('rs-model-clear-btn');

    function toggleClearBtn() {
      if (!clearBtn) return;
      clearBtn.classList.toggle('visible', !!modelFilter.value);
    }

    function selectModel(model) {
      if (!model) return;
      modelFilter.value = model;
      ChatManager.setChatModel(model);
      UI.renderHeader(model);
      modelDropdown.classList.add('hidden');
      toggleClearBtn();
    }

    if (profileSelect) {
      profileSelect.addEventListener('change', () => {
        const profileId = profileSelect.value;
        if (profileId) {
          Store.setActiveProfileId(profileId);
          ChatManager.setChatModel('');
          UI.renderHeader('');
          modelFilter.value = '';
          modelList = [];
          modelDropdown.classList.add('hidden');
          toggleClearBtn();
        }
      });
    }

    document.getElementById('rs-profile-manage-btn').addEventListener('click', () => {
      UI.openConfigModal();
    });

    if (modelFilter && modelDropdown && fetchModelsBtn) {
      const fetchAndPopulateModels = async () => {
        const profile = Store.getActiveProfile();
        if (!profile || !profile.endpoint) {
          showToast('Please configure a provider endpoint first.', 'error');
          return;
        }
        fetchModelsBtn.disabled = true;
        fetchModelsBtn.textContent = '↻ Fetching…';
        try {
          const models = await Api.fetchModels({ endpoint: profile.endpoint, apiKey: profile.apiKey });
          modelList = models.sort((a, b) => a.localeCompare(b));
          modelFilter.value = '';
          ChatManager.setChatModel('');
          UI.renderHeader('');
          toggleClearBtn();
          renderDropdown('');
          showToast(`Loaded ${modelList.length} models`, 'success');
        } catch (err) {
          showToast(`Failed to fetch models: ${err.message}`, 'error');
        } finally {
          fetchModelsBtn.disabled = false;
          fetchModelsBtn.textContent = '↻ Fetch';
        }
      };

      fetchModelsBtn.addEventListener('click', fetchAndPopulateModels);

      modelFilter.addEventListener('input', () => {
        renderDropdown(modelFilter.value);
        toggleClearBtn();
      });

      modelFilter.addEventListener('keydown', (e) => {
        const items = modelDropdown.querySelectorAll('.model-dropdown-item');
        const active = modelDropdown.querySelector('.model-dropdown-item.active');
        if (e.key === 'Enter') {
          e.preventDefault();
          if (active) {
            selectModel(active.dataset.model);
          } else if (modelList.includes(modelFilter.value)) {
            selectModel(modelFilter.value);
          }
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!items.length) return;
          let idx = -1;
          if (active) idx = Array.from(items).indexOf(active);
          idx = e.key === 'ArrowDown'
            ? (idx + 1) % items.length
            : (idx - 1 + items.length) % items.length;
          items.forEach(el => el.classList.remove('active'));
          items[idx].classList.add('active');
          items[idx].scrollIntoView({ block: 'nearest' });
          return;
        }
        if (e.key === 'Escape') {
          modelDropdown.classList.add('hidden');
        }
      });

      modelFilter.addEventListener('blur', () => {
        setTimeout(() => modelDropdown.classList.add('hidden'), 180);
      });

      modelFilter.addEventListener('focus', () => {
        if (modelList.length) renderDropdown(modelFilter.value);
      });

      modelDropdown.addEventListener('mousedown', (e) => {
        const item = e.target.closest('.model-dropdown-item');
        if (item) {
          e.preventDefault();
          selectModel(item.dataset.model);
        }
      });

      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          modelFilter.value = '';
          ChatManager.setChatModel('');
          UI.renderHeader('');
          modelDropdown.classList.add('hidden');
          toggleClearBtn();
          modelFilter.focus();
        });
      }

      toggleClearBtn();
    }

    document.getElementById('rs-export-json-btn').addEventListener('click', () => {
      UI.exportChatJSON();
    });
    document.getElementById('rs-export-html-btn').addEventListener('click', () => {
      UI.exportChatHTML();
    });
    document.getElementById('rs-export-md-btn').addEventListener('click', () => {
      UI.exportChatMarkdown();
    });
    document.getElementById('rs-backup-btn').addEventListener('click', () => {
      UI.backupAllData();
    });
    document.getElementById('rs-restore-btn').addEventListener('click', () => {
      UI.restoreAllData();
    });
    document.getElementById('rs-import-chat-btn').addEventListener('click', () => {
      UI.importChat();
    });

    const autoSave = Utils.debounce(() => {
      saveChatSettings();
    }, 300);

    document.getElementById('rs-system-prompt').addEventListener('input', autoSave);
    document.getElementById('center-thinking-toggle').addEventListener('change', (e) => {
      autoSave();
    });
    document.getElementById('rs-temperature').addEventListener('input', autoSave);
    document.getElementById('rs-max-tokens').addEventListener('input', autoSave);
    document.getElementById('rs-reasoning-effort').addEventListener('change', autoSave);
  }

  Object.assign(UI, {
    showToast,
    showTypingIndicator,
    hideTypingIndicator,
    copyMessageToClipboard,
    copyConversationToClipboard,
    enterEditMode,
    saveEdit,
    cancelEdit,
    updateInputStats,
    autoResizeTextarea,
    sanitizeHtml,
    renderMarkdown,
    preprocessReasoning,
    isSafeUrl,
    DEFAULT_ROLES,
    getAllRoles,
    populateRoleSelect,
    applyRoleById,
    populateProfileSelect,
    saveChatSettings,
    getChatSettings,
    initRightSidebar
  });
})();
