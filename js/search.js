/* ═══════════════════════════════════════════════
   search.js — In-chat text search
   ═══════════════════════════════════════════════ */

;(() => {
  const UI = window.UI = window.UI || {};

  let searchResults = [];
  let searchActiveIdx = -1;

  function initChatSearch() {
    const input = document.getElementById('chat-search-input');
    const prevBtn = document.getElementById('chat-search-prev');
    const nextBtn = document.getElementById('chat-search-next');
    const closeBtn = document.getElementById('chat-search-close');

    if (!input) return;

    input.addEventListener('input', () => searchInChat());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          navigateSearch(-1);
        } else {
          navigateSearch(1);
        }
      }
    });

    if (prevBtn) prevBtn.addEventListener('click', () => navigateSearch(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => navigateSearch(1));
    if (closeBtn) closeBtn.addEventListener('click', closeChatSearch);
  }

  function searchInChat() {
    const input = document.getElementById('chat-search-input');
    const countEl = document.getElementById('chat-search-count');
    const container = document.getElementById('chat-messages');
    if (!input || !countEl || !container) return;

    const query = input.value.trim().toLowerCase();
    searchResults = [];
    searchActiveIdx = -1;

    container.querySelectorAll('.chat-search-highlight, .chat-search-active').forEach(el => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent), el);
        parent.normalize();
      }
    });

    if (!query) {
      countEl.textContent = '0/0';
      return;
    }

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent || node.parentNode.closest('.message-meta, .message-actions, .reasoning-content')) continue;
      const text = node.textContent.toLowerCase();
      let idx = 0;
      while ((idx = text.indexOf(query, idx)) !== -1) {
        searchResults.push({ node, start: idx, length: query.length });
        idx += query.length;
      }
    }

    for (let i = searchResults.length - 1; i >= 0; i--) {
      const r = searchResults[i];
      const textNode = r.node;
      const parent = textNode.parentNode;
      if (!parent) continue;
      // Split after match (result unused — splitText modifies in place)
      textNode.splitText(r.start + r.length);
      // Split before match — textNode now contains only the matched text
      const matchText = textNode.splitText(r.start);
      const mark = document.createElement('mark');
      mark.className = 'chat-search-highlight';
      mark.textContent = matchText.textContent;
      matchText.replaceWith(mark);
    }

    countEl.textContent = searchResults.length + '/' + searchResults.length;
    if (searchResults.length > 0) {
      navigateSearch(1);
    }
  }

  function navigateSearch(dir) {
    if (searchResults.length === 0) return;
    const container = document.getElementById('chat-messages');
    if (!container) return;
    const active = container.querySelector('.chat-search-active');
    if (active) {
      active.classList.remove('chat-search-active');
      active.classList.add('chat-search-highlight');
    }

    searchActiveIdx += dir;
    if (searchActiveIdx < 0) searchActiveIdx = searchResults.length - 1;
    if (searchActiveIdx >= searchResults.length) searchActiveIdx = 0;

    const marks = container.querySelectorAll('.chat-search-highlight, .chat-search-active');
    if (marks[searchActiveIdx]) {
      const mark = marks[searchActiveIdx];
      mark.classList.remove('chat-search-highlight');
      mark.classList.add('chat-search-active');
      mark.scrollIntoView({ block: 'center' });
    }

    const countEl = document.getElementById('chat-search-count');
    if (countEl) {
      countEl.textContent = (searchActiveIdx + 1) + '/' + searchResults.length;
    }
  }

  function closeChatSearch() {
    const bar = document.getElementById('chat-search-bar');
    const input = document.getElementById('chat-search-input');
    if (bar) bar.classList.add('hidden');
    if (input) input.value = '';
    searchResults = [];
    searchActiveIdx = -1;
    const container = document.getElementById('chat-messages');
    if (container) {
      container.querySelectorAll('.chat-search-highlight, .chat-search-active').forEach(el => {
        const parent = el.parentNode;
        if (parent) {
          parent.replaceChild(document.createTextNode(el.textContent), el);
          parent.normalize();
        }
      });
    }
  }

  Object.assign(UI, {
    initChatSearch,
    searchInChat,
    navigateSearch,
    closeChatSearch
  });
})();
