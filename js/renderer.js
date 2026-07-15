/* ═══════════════════════════════════════════════
   renderer.js — DOM rendering (messages, sidebar, header)
   ═══════════════════════════════════════════════ */

;(() => {
  const UI = window.UI = window.UI || {};

  function renderEmpty() {
    const container = document.getElementById('chat-messages');
    container.innerHTML = `
      <div class="empty-state">
        <div class="chat-bubble-icon"></div>
        <p>Start a conversation</p>
        <p class="hint">Type a message below to begin chatting with your AI model.</p>
      </div>
    `;
  }

  function destroyChartInstances(container) {
    if (typeof Chart === 'undefined') return;
    container.querySelectorAll('.chart-embed canvas').forEach(canvas => {
      const chart = Chart.getChart(canvas);
      if (chart) chart.destroy();
    });
  }

  function buildMessageHtml(msg) {
    const isUser = msg.role === 'user';
    const isAssistant = msg.role === 'assistant';
    const time = Utils.formatTime(msg.timestamp);
    const charCount = (msg.content || '').length + (msg.reasoningContent || '').length;
    const wordCount = ((msg.content || '') + ' ' + (msg.reasoningContent || '')).trim().split(/\s+/).filter(Boolean).length;
    const tokReal = msg.completionTokens;
    const tokEstimate = tokReal || Utils.estimateTokens((msg.content || '') + (msg.reasoningContent || ''));
    const tokLabel = tokReal ? `${tokReal}` : `~${tokEstimate}`;
    const isPinned = !!msg.pinned;

    let reasoningHtml = '';
    if (msg.reasoningContent) {
      const safeReasoning = Utils.escapeHtml(msg.reasoningContent);
      reasoningHtml = `<details class="reasoning-block">
        <summary>🧠 Reasoning (click to expand)</summary>
        <div class="reasoning-content">${safeReasoning}</div>
      </details>`;
    }

    let contentForRender = msg.content || '';
    if (msg.reasoningContent) {
      contentForRender = contentForRender
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
        .replace(/<\/think>/gi, '')
        .replace(/\<\|channel\>thought[\s\S]*?<channel\|\>/gi, '')
        .trim();
    }

    let renderedContent = '';
    if (contentForRender) {
      try {
        renderedContent = UI.renderMarkdown(contentForRender);
      } catch (_) {
        console.warn('[Renderer] markdown render failed, using escaped fallback');
        renderedContent = Utils.escapeHtml(contentForRender);
      }
    }

    return `
      <div class="message ${msg.role}${isPinned ? ' pinned' : ''}" data-msg-id="${msg.id}">
        <div class="message-bubble">${reasoningHtml}${renderedContent || '<em>…</em>'}</div>
        <div class="message-meta">
          <span class="message-role-badge">${isUser ? 'You' : 'AI'}</span>
          <span class="message-time" title="${Utils.formatFullTime(msg.timestamp)}">${time}</span>
            <span class="message-stats" title="${charCount} characters, ${wordCount} words, ${tokReal ? `${tokReal}` : `~${tokEstimate}`} tokens${msg.streamSpeed ? `, ${msg.streamSpeed} t/s` : ''}">${charCount}c · ${wordCount}w${isAssistant ? ` · ${tokLabel} tok` : ''}${msg.streamSpeed ? ` · ${msg.streamSpeed} t/s` : ''}</span>
            <div class="message-actions">
              ${isUser ? `<button class="msg-action-btn" data-action="edit" title="Edit message" aria-label="Edit message">✏️</button>` : ''}
              <button class="msg-action-btn" data-action="copy" title="Copy message" aria-label="Copy message">📋</button>
              <button class="msg-action-btn ${isPinned ? 'pinned' : ''}" data-action="pin" title="${isPinned ? 'Unpin' : 'Pin'}" aria-label="${isPinned ? 'Unpin message' : 'Pin message'}">${isPinned ? '📌' : '📍'}</button>
              ${isAssistant ? '<button class="msg-action-btn" data-action="regenerate" title="Regenerate response" aria-label="Regenerate response">🔄</button>' : ''}
              <button class="msg-action-btn" data-action="fork" title="Fork conversation from here" aria-label="Fork conversation from here">🔀</button>
            </div>
        </div>
      </div>
    `;
  }

  function renderMessages(chat) {
    const container = document.getElementById('chat-messages');
    if (!chat || !chat.messages || chat.messages.length === 0) {
      renderEmpty();
      updateContextTokens(0);
      return;
    }

    destroyChartInstances(container);

    const prevScrollTop = container.scrollTop;
    const prevScrollHeight = container.scrollHeight;
    const wasAtBottom = prevScrollHeight - prevScrollTop - container.clientHeight < 80;

    let totalTokens = 0;
    if (chat.totalPromptTokens && chat.totalCompletionTokens) {
      totalTokens = chat.totalPromptTokens + chat.totalCompletionTokens;
    } else {
      for (const msg of chat.messages) {
        totalTokens += msg.completionTokens || Utils.estimateTokens(msg.content || '');
        totalTokens += Utils.estimateTokens(msg.reasoningContent || '');
      }
    }
    updateContextTokens(totalTokens);

    // Remove non-message children (empty-state, etc.) before counting existing messages
    const nonMessages = container.querySelectorAll(':scope > :not(.message)');
    for (const el of nonMessages) el.remove();

    const existingChildren = container.querySelectorAll(':scope > .message');
    const common = Math.min(existingChildren.length, chat.messages.length);
    let prefixMatch = true;
    for (let i = 0; i < common; i++) {
      if (existingChildren[i].dataset.msgId !== chat.messages[i].id) {
        prefixMatch = false;
        break;
      }
    }

    if (prefixMatch) {
      // Append new messages
      for (let i = existingChildren.length; i < chat.messages.length; i++) {
        container.insertAdjacentHTML('beforeend', buildMessageHtml(chat.messages[i]));
      }
      // Remove excess message elements
      while (container.querySelectorAll(':scope > .message').length > chat.messages.length) {
        const all = container.querySelectorAll(':scope > .message');
        all[all.length - 1].remove();
      }
      // Only enhance newly added elements
      const newChildren = container.querySelectorAll(':scope > .message');
      for (let i = common; i < newChildren.length; i++) {
        enhanceRenderedContent(newChildren[i]);
      }
    } else {
      // Full rebuild for structural changes (edit, delete, reorder)
      container.innerHTML = chat.messages.map(msg => buildMessageHtml(msg)).join('');
      enhanceRenderedContent(container);
    }

    if (wasAtBottom) {
      scrollToBottom();
    } else {
      const newScrollHeight = container.scrollHeight;
      if (newScrollHeight > prevScrollHeight) {
        container.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
      } else {
        container.scrollTop = Math.min(prevScrollTop, newScrollHeight - container.clientHeight);
      }
      updateScrollBottomBtn();
    }

    // Re-apply search highlighting if search is active
    const searchInput = document.getElementById('chat-search-input');
    if (searchInput && searchInput.value.trim()) {
      const searchBar = document.getElementById('chat-search-bar');
      if (searchBar && !searchBar.classList.contains('hidden')) {
        requestAnimationFrame(() => UI.searchInChat());
      }
    }
  }

  function enhanceRenderedContent(container) {
    if (!container) container = document.getElementById('chat-messages');

    container.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code');
      if (!code) return;

      const classes = [...code.classList];
      const lang = classes.find(c => c.startsWith('language-'))?.slice(9) || '';

      if (lang === 'mermaid') {
        const div = document.createElement('div');
        div.className = 'mermaid';
        div.textContent = code.textContent;
        pre.replaceWith(div);
        return;
      }

      if (lang === 'chart' || lang === 'chart.js') {
        const div = document.createElement('div');
        div.className = 'chart-embed';
        div.dataset.chartData = encodeURIComponent(code.textContent);
        div.textContent = 'Chart loading…';
        pre.replaceWith(div);
        return;
      }

      if (lang === 'reasoning' || lang === 'thought' || lang === 'thinking') {
        const details = document.createElement('details');
        details.className = 'reasoning-block';
        const summary = document.createElement('summary');
        summary.textContent = '🧠 Reasoning (click to expand)';
        details.appendChild(summary);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'reasoning-content';
        try {
          contentDiv.innerHTML = UI.renderMarkdown(code.textContent);
        } catch (_) {
          console.warn('[Renderer] reasoning markdown render failed');
          contentDiv.textContent = code.textContent;
        }
        details.appendChild(contentDiv);
        pre.replaceWith(details);
        return;
      }

      if (typeof hljs !== 'undefined') {
        try { hljs.highlightElement(code); } catch (_) { console.warn('[Renderer] hljs highlight failed'); }
      }

      if (pre.querySelector('.code-lang-badge')) return;

      const displayLang = lang || 'text';

      pre.style.position = 'relative';

      const badge = document.createElement('span');
      badge.className = 'code-lang-badge';
      badge.textContent = displayLang;
      pre.appendChild(badge);

      const copyBtn = document.createElement('button');
      copyBtn.className = 'code-copy-btn';
      copyBtn.textContent = '📋';
      copyBtn.title = 'Copy code';
      copyBtn.setAttribute('aria-label', 'Copy code block');
      copyBtn.addEventListener('click', () => {
        const text = code.textContent;
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = '✅';
          setTimeout(() => { copyBtn.textContent = '📋'; }, 2000);
        }).catch(() => {
          copyBtn.textContent = '❌';
          setTimeout(() => { copyBtn.textContent = '📋'; }, 2000);
        });
      });
      pre.appendChild(copyBtn);

      const langSelector = document.createElement('select');
      langSelector.className = 'code-lang-selector';
      langSelector.setAttribute('aria-label', 'Change syntax highlighting language');
      langSelector.title = 'Change syntax highlighting language';
      const commonLangs = ['text', 'javascript', 'typescript', 'python', 'html', 'css', 'json', 'bash', 'sql', 'java', 'cpp', 'csharp', 'go', 'rust', 'php', 'ruby', 'yaml', 'markdown'];
      commonLangs.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l;
        opt.textContent = l;
        if (l === displayLang) opt.selected = true;
        langSelector.appendChild(opt);
      });
      langSelector.addEventListener('change', () => {
        const newLang = langSelector.value;
        code.className = `language-${newLang}`;
        badge.textContent = newLang;
        if (typeof hljs !== 'undefined') {
          try { hljs.highlightElement(code); } catch (_) { console.warn('[Renderer] lang selector hljs highlight failed'); }
        }
      });
      pre.appendChild(langSelector);
    });

    const mermaidBlocks = container.querySelectorAll('.mermaid');
    if (mermaidBlocks.length > 0 && typeof mermaid !== 'undefined') {
      mermaidBlocks.forEach(block => {
        const text = block.textContent.trim();
        if (!text) return;
        const id = 'mermaid-' + Utils.generateId();
        mermaid.render(id, text).then(({ svg }) => {
          block.innerHTML = svg;
        }).catch(err => {
          const msg = (err && (err.message || err.str || err)) || 'Syntax error in mermaid diagram';
          const escapedMsg = Utils.escapeHtml(String(msg));
          block.innerHTML = `<div style="position:relative;color:var(--color-danger);font-size:0.85rem;padding:10px 36px 10px 10px;text-align:left;background:var(--color-surface);border-radius:6px;overflow-x:auto;"><strong>⚠ Mermaid Error:</strong><br><span style="font-family:var(--font-mono);font-size:0.78rem;">${escapedMsg}</span></div>`;
          const errorDiv = block.firstElementChild;
          if (errorDiv) {
            const copyBtn = document.createElement('button');
            copyBtn.textContent = '📋';
            copyBtn.title = 'Copy error';
            copyBtn.style.cssText = 'position:absolute;top:6px;right:6px;background:rgba(255,255,255,0.1);border:none;color:#a6adc8;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:0.78rem;line-height:1.4;';
            copyBtn.addEventListener('click', () => {
              navigator.clipboard.writeText(String(msg)).then(() => {
                copyBtn.textContent = '✅';
                setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
              });
            });
            errorDiv.style.position = 'relative';
            errorDiv.appendChild(copyBtn);
          }
        });
      });
    }

    container.querySelectorAll('.chart-embed:not([data-initialized])').forEach(el => {
      el.dataset.initialized = 'true';
      try {
        const dataStr = decodeURIComponent(el.dataset.chartData || '');
        const config = JSON.parse(dataStr);
        const id = 'chart-' + Math.random().toString(36).slice(2, 8);
        el.id = id;
        el.innerHTML = '';
        const canvas = document.createElement('canvas');
        el.appendChild(canvas);
        if (typeof Chart !== 'undefined') {
          new Chart(canvas.getContext('2d'), config);
        }
      } catch (_) {
        console.warn('[Renderer] Chart rendering failed');
        el.textContent = '[Chart: could not render]';
      }
    });
  }

  async function renderSidebar(chats, activeId) {
    const list = document.getElementById('chat-list');
    const searchInput = document.querySelector('#sidebar-search input');
    const isSearchActive = searchInput && searchInput.value.trim();

    if (!chats || chats.length === 0) {
      if (isSearchActive) {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--color-text-muted);font-size:0.85rem;">No conversations match your search</div>';
      } else {
        list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--color-text-muted);font-size:0.85rem;">No conversations yet</div>';
      }
      return;
    }

    const folders = Store.loadFolders();
    const collapsedFolders = new Set(Store.loadCollapsedFolders());
    const folderMap = {};
    for (const f of folders) folderMap[f.id] = f;

    const uncategorized = [];
    const grouped = {};
    for (const chat of chats) {
      const fid = chat.folderId || '';
      if (!fid || !folderMap[fid]) {
        uncategorized.push(chat);
      } else {
        if (!grouped[fid]) grouped[fid] = [];
        grouped[fid].push(chat);
      }
    }

    let html = '';

    // Add folder button at the top
    html += '<button id="add-folder-btn" class="chat-folder-add-btn">+ New Folder</button>';

    // Folder groups
    for (const f of folders) {
      const group = grouped[f.id] || [];
      const safeName = Utils.escapeHtml(f.name);
      const isCollapsed = collapsedFolders.has(f.id);
      html += `
        <div class="chat-folder${isCollapsed ? ' collapsed' : ''}" data-folder-id="${f.id}">
          <div class="chat-folder-header" draggable="false">
            <span class="chat-folder-toggle">▼</span>
            <span class="chat-folder-name">${safeName}</span>
            <span class="chat-folder-count">${group.length}</span>
            <button class="chat-folder-rename-btn" title="Rename folder">✏️</button>
            <button class="chat-folder-delete-btn" title="Delete folder">✕</button>
          </div>
          <div class="chat-folder-children">
      `;
      for (const chat of group) {
        html += _chatListItemHtml(chat, activeId);
      }
      html += '</div></div>';
    }

    // Uncategorized
    if (uncategorized.length > 0) {
      if (folders.length > 0) {
        const isCollapsed = collapsedFolders.has(Store.UNCATEGORIZED_FOLDER_ID);
        html += `<div class="chat-folder${isCollapsed ? ' collapsed' : ''}" data-folder-id="${Store.UNCATEGORIZED_FOLDER_ID}">
          <div class="chat-folder-header">
            <span class="chat-folder-toggle">▼</span>
            <span class="chat-folder-name">Uncategorized</span>
            <span class="chat-folder-count">${uncategorized.length}</span>
          </div>
          <div class="chat-folder-children">
        `;
      }
      for (const chat of uncategorized) {
        html += _chatListItemHtml(chat, activeId);
      }
      if (folders.length > 0) {
        html += '</div></div>';
      }
    }

    list.innerHTML = html;
  }

  function _chatListItemHtml(chat, activeId) {
    const isActive = chat.id === activeId;
    const safeTitle = Utils.escapeHtml(chat.title);
    return `
      <div class="chat-list-item ${isActive ? 'active' : ''}" data-chat-id="${chat.id}" draggable="true" tabindex="0" role="button" aria-selected="${isActive}" aria-label="${safeTitle}">
        <div style="flex:1;min-width:0">
          <div class="chat-title" title="${safeTitle}">${safeTitle}</div>
        </div>
        <button class="chat-delete-btn" data-chat-id="${chat.id}" title="Delete chat" aria-label="Delete ${safeTitle}">✕</button>
        <span class="chat-date">${Utils.formatTime(chat.updatedAt)}</span>
      </div>
    `;
  }

  function renderHeader(model) {
    const badge = document.getElementById('model-badge');
    const profile = Store.getActiveProfile();
    const display = profile
      ? `${profile.name || 'Unnamed'} / ${model || profile.model || 'No model'}`
      : (model || 'No model configured');
    if (badge) {
      badge.textContent = display;
    }
  }

  function updateStreamingMessage(msgId, content, reasoning, stats) {
    const container = document.getElementById('chat-messages');
    const messageEl = container.querySelector(`.message[data-msg-id="${msgId}"]`);
    if (!messageEl) return;
    const bubble = messageEl.querySelector('.message-bubble');
    if (!bubble) return;

    // Save scroll state BEFORE modifying DOM (so we can compensate if user is scrolled up)
    const prevScrollTop = container.scrollTop;
    const prevScrollHeight = container.scrollHeight;
    const wasAtBottom = prevScrollHeight - prevScrollTop - container.clientHeight < 80;

    let reasoningHtml = '';
    if (reasoning) {
      const safeReasoning = Utils.escapeHtml(reasoning);
      reasoningHtml = `<details class="reasoning-block">
        <summary>🧠 Reasoning (click to expand)</summary>
        <div class="reasoning-content">${safeReasoning}</div>
      </details>`;
    }

    let contentHtml = '';
    if (content) {
      try {
        contentHtml = UI.renderMarkdown(content);
      } catch (_) {
        console.warn('[Renderer] message content markdown render failed');
        contentHtml = Utils.escapeHtml(content);
      }
    } else if (!reasoning) {
      contentHtml = '<em>…</em>';
    }

    bubble.innerHTML = reasoningHtml + contentHtml;

    if (stats) {
      let meta = messageEl.querySelector('.streaming-stats');
      if (!meta) {
        meta = document.createElement('span');
        meta.className = 'streaming-stats';
        meta.style.cssText = 'font-size:0.65rem;color:var(--color-text-muted);opacity:0.7;margin-left:auto;font-family:var(--font-mono);';
        const msgMeta = messageEl.querySelector('.message-meta');
        if (msgMeta) msgMeta.appendChild(meta);
      }
      const totalTokens = Utils.estimateTokens((content || '') + (reasoning || ''));
      meta.textContent = `${stats.tokens} chunks · ${totalTokens} tok · ${stats.speed} t/s`;
    }

    if (wasAtBottom) {
      scrollToBottom();
    } else {
      updateScrollBottomBtn();
    }
  }

  function togglePinInDOM(msgId) {
    const el = document.querySelector(`.message[data-msg-id="${msgId}"]`);
    if (!el) return;
    const isPinned = el.classList.toggle('pinned');
    const btn = el.querySelector('.msg-action-btn[data-action="pin"]');
    if (btn) {
      btn.textContent = isPinned ? '📌' : '📍';
      btn.title = isPinned ? 'Unpin' : 'Pin';
      btn.classList.toggle('pinned', isPinned);
    }
  }

  function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    const btn = document.getElementById('scroll-bottom-btn');
    requestAnimationFrame(() => {
      if (container.scrollHeight - container.scrollTop - container.clientHeight < 80) {
        container.scrollTop = container.scrollHeight;
      }
    });
    if (btn) btn.classList.remove('visible');
  }

  function updateScrollBottomBtn() {
    const container = document.getElementById('chat-messages');
    const btn = document.getElementById('scroll-bottom-btn');
    if (!container || !btn) return;
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    btn.classList.toggle('visible', !atBottom);
  }

  function updateContextTokens(total) {
    const el = document.getElementById('context-tokens');
    if (!el) return;
    if (total > 0) {
      const k = total / 1000;
      el.textContent = `~${k.toFixed(1)}K tok context`;
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  }

  function setupRangeSlider(inputId, displayId) {
    const input = document.getElementById(inputId);
    const display = document.getElementById(displayId);
    if (!input || !display) return;
    if (input.dataset.sliderInitialized) return;
    input.dataset.sliderInitialized = '1';
    input.addEventListener('input', () => {
      display.textContent = parseFloat(input.value).toFixed(input.step < 0.01 ? 2 : 1);
    });
  }

  function renderRightSidebar() {
    const chat = ChatManager.getCurrentChat();
    const settings = chat?.settings || {};

    const systemPrompt = document.getElementById('rs-system-prompt');
    const thinkingToggle = document.getElementById('center-thinking-toggle');
    const tempInput = document.getElementById('rs-temperature');
    const tempDisplay = document.getElementById('rs-temp-value');
    const maxTokens = document.getElementById('rs-max-tokens');
    const reasoningEffort = document.getElementById('rs-reasoning-effort');

    if (systemPrompt) systemPrompt.value = settings.systemPrompt || '';
    if (thinkingToggle) thinkingToggle.checked = !!settings.thinkingMode;
    if (tempInput) tempInput.value = settings.temperature ?? 0.7;
    if (tempDisplay) tempDisplay.textContent = (settings.temperature ?? 0.7).toFixed(1);
    if (maxTokens) maxTokens.value = settings.maxTokens ?? 8192;
    if (reasoningEffort) reasoningEffort.value = settings.reasoningEffort || 'medium';

    setupRangeSlider('rs-temperature', 'rs-temp-value');

    UI.populateRoleSelect();
    UI.populateProfileSelect();

    // Sync model filter to current chat's model
    const modelFilter = document.getElementById('rs-model-filter');
    if (modelFilter && chat?.model) {
      modelFilter.value = chat.model;
    }

    const roles = UI.getAllRoles();
    const sel = document.getElementById('rs-role-select');
    if (sel && systemPrompt.value) {
      const match = roles.find(r => r.prompt === systemPrompt.value);
      if (match) {
        sel.value = match.id;
      } else {
        sel.value = '';
      }
    }
  }

  function initScrollBottomBtn() {
    const btn = document.getElementById('scroll-bottom-btn');
    const container = document.getElementById('chat-messages');
    if (!btn || !container) return;

    btn.addEventListener('click', scrollToBottom);

    container.addEventListener('scroll', () => {
      updateScrollBottomBtn();
    }, { passive: true });
  }

  Object.assign(UI, {
    renderEmpty,
    destroyChartInstances,
    renderMessages,
    enhanceRenderedContent,
    renderSidebar,
    renderHeader,

    updateStreamingMessage,
    togglePinInDOM,
    scrollToBottom,
    updateScrollBottomBtn,
    updateContextTokens,
    setupRangeSlider,
    renderRightSidebar,
    initScrollBottomBtn
  });
})();
