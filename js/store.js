/* ═══════════════════════════════════════════════
   store.js — IndexedDB + localStorage abstraction
   ═══════════════════════════════════════════════ */

const Store = (() => {
  'use strict';

  const CHATS_KEY = 'chai-chats';
  const PROFILES_KEY = 'chai-profiles';
  const ACTIVE_PROFILE_KEY = 'chai-active-profile';
  const USAGE_KEY = 'chai-usage';

  /* ── Crypto helpers for API key encryption ── */

  /* ── Crypto helpers for API key encryption ── */
  let _cryptoKey = null;
  let _cryptoInitPromise = null;
  let _profilesDecrypted = null;

  async function _ensureCrypto() {
    if (_cryptoInitPromise) return _cryptoInitPromise;
    _cryptoInitPromise = (async () => {
      try {
        const stored = sessionStorage.getItem('chai-enc-key');
        if (stored) {
          const raw = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
          _cryptoKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
        } else {
          _cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
          const exported = await crypto.subtle.exportKey('raw', _cryptoKey);
          sessionStorage.setItem('chai-enc-key', btoa(String.fromCharCode(...new Uint8Array(exported))));
        }
        // Load decrypted cache (decrypts any ~enc~ keys in localStorage)
        await _reloadDecryptedCache();
        // Re-save any profiles with unencrypted keys so they become encrypted
        if (_profilesDecrypted) {
          const hasUnencrypted = _profilesDecrypted.some(p => p.apiKey && !p.apiKey.startsWith('~enc~'));
          if (hasUnencrypted) {
            await _saveProfilesEncrypted(_profilesDecrypted);
          }
        }
      } catch (err) {
        console.warn('[Store] Crypto init failed, keys stored in plaintext:', err);
      }
    })();
    return _cryptoInitPromise;
  }

  async function _reloadDecryptedCache() {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) { _profilesDecrypted = null; return; }
    try {
      const profiles = JSON.parse(raw);
      if (_cryptoKey) {
        for (const p of profiles) {
          if (p.apiKey && p.apiKey.startsWith('~enc~')) {
            try {
              const data = Uint8Array.from(atob(p.apiKey.slice(5)), c => c.charCodeAt(0));
              const iv = data.slice(0, 12);
              const ct = data.slice(12);
              const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, _cryptoKey, ct);
              p.apiKey = new TextDecoder().decode(decrypted);
            } catch (_) { p.apiKey = ''; }
          }
        }
      }
      _profilesDecrypted = profiles;
    } catch (_) { _profilesDecrypted = null; }
  }

  async function _encrypt(plaintext) {
    if (!plaintext || !_cryptoKey) return plaintext;
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(plaintext);
      const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, _cryptoKey, encoded);
      const combined = new Uint8Array(iv.length + ciphertext.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(ciphertext), iv.length);
      return '~enc~' + btoa(String.fromCharCode(...combined));
    } catch (_) { return plaintext; }
  }

  async function _saveProfilesEncrypted(profiles) {
    const toStore = await Promise.all(profiles.map(async p => ({
      ...p,
      apiKey: p.apiKey ? await _encrypt(p.apiKey) : ''
    })));
    localStorage.setItem(PROFILES_KEY, JSON.stringify(toStore));
  }

  /* ── Folders (localStorage) ── */
  const FOLDERS_KEY = 'chai-folders';
  const UNCATEGORIZED_FOLDER_ID = 'uncategorized';
  const COLLAPSED_FOLDERS_KEY = 'chai-collapsed-folders';

  function loadFolders() {
    try {
      const raw = localStorage.getItem(FOLDERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function saveFolders(folders) {
    try {
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
    } catch (err) {
      console.error('[Store] Failed to save folders:', err);
    }
  }

  function loadCollapsedFolders() {
    try {
      const raw = localStorage.getItem(COLLAPSED_FOLDERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function saveCollapsedFolders(folderIds) {
    try {
      localStorage.setItem(COLLAPSED_FOLDERS_KEY, JSON.stringify(folderIds));
    } catch (err) {
      console.error('[Store] Failed to save collapsed folders:', err);
    }
  }

  function setFolderCollapsed(folderId, collapsed) {
    const folderIds = loadCollapsedFolders();
    const idx = folderIds.indexOf(folderId);
    if (collapsed && idx === -1) {
      folderIds.push(folderId);
    } else if (!collapsed && idx !== -1) {
      folderIds.splice(idx, 1);
    }
    saveCollapsedFolders(folderIds);
  }

  function toggleFolderCollapsed(folderId) {
    const folderIds = loadCollapsedFolders();
    const collapsed = folderIds.includes(folderId);
    setFolderCollapsed(folderId, !collapsed);
    return !collapsed;
  }

  function isFolderCollapsed(folderId) {
    return loadCollapsedFolders().includes(folderId);
  }

  function addFolder(name) {
    const folders = loadFolders();
    const folder = { id: Utils.generateId(), name: name.trim(), createdAt: Date.now() };
    folders.push(folder);
    saveFolders(folders);
    return folder;
  }

  function renameFolder(id, name) {
    const folders = loadFolders();
    const folder = folders.find(f => f.id === id);
    if (!folder) return;
    folder.name = name.trim();
    saveFolders(folders);
  }

  async function deleteFolder(id) {
    let folders = loadFolders();
    folders = folders.filter(f => f.id !== id);
    saveFolders(folders);
    setFolderCollapsed(id, false);
    // Also remove folder reference from chats that belong to it (targeted, not a full scan)
    try {
      const index = await _loadIndex();
      const affected = index.filter(e => e.folderId === id);
      if (affected.length === 0) return;
      const keys = affected.map(e => _chatKey(e.id));
      const chats = await idbKeyval.getMany(keys);
      const entries = [];
      chats.forEach((chat, i) => {
        if (!chat) return;
        delete chat.folderId;
        entries.push([keys[i], chat]);
      });
      if (entries.length) await idbKeyval.setMany(entries);
      for (const e of affected) e.folderId = '';
      await _saveIndex(index);
    } catch (err) {
      console.error('[Store] Failed to clear folder references:', err);
    }
  }

  async function setChatFolder(chatId, folderId) {
    const chat = await idbKeyval.get(_chatKey(chatId));
    if (!chat) return;
    if (folderId) {
      chat.folderId = folderId;
    } else {
      delete chat.folderId;
    }
    await idbKeyval.set(_chatKey(chatId), chat);
    await _updateIndexEntry(chat);
  }

  /* ── Profiles (localStorage, API keys encrypted at rest) ── */
  function loadProfiles() {
    // Return from decrypted cache if available
    if (_profilesDecrypted) return _profilesDecrypted;
    try {
      const raw = localStorage.getItem(PROFILES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  async function saveProfiles(profiles) {
    await _ensureCrypto();
    _profilesDecrypted = profiles.map(p => ({ ...p }));
    try {
      await _saveProfilesEncrypted(profiles);
    } catch (err) {
      console.error('[Store] Failed to save profiles:', err);
    }
  }

  function getActiveProfileId() {
    return localStorage.getItem(ACTIVE_PROFILE_KEY) || null;
  }

  function setActiveProfileId(id) {
    try {
      localStorage.setItem(ACTIVE_PROFILE_KEY, id);
    } catch (err) {
      console.error('[Store] Failed to save active profile id:', err);
    }
  }

  function getActiveProfile() {
    const profiles = loadProfiles();
    const activeId = getActiveProfileId();
    return profiles.find(p => p.id === activeId) || profiles[0] || null;
  }

  // Legacy migration — run once on first load
  async function migrateLegacyConfig() {
    const legacyRaw = localStorage.getItem('chai-config');
    if (!legacyRaw || localStorage.getItem(PROFILES_KEY)) return;
    try {
      const config = JSON.parse(legacyRaw);
      const profile = {
        id: Date.now().toString(36),
        name: 'Default',
        endpoint: config.endpoint || '',
        apiKey: config.apiKey || '',
        model: config.model || 'gpt-3.5-turbo',
        createdAt: Date.now()
      };
      await saveProfiles([profile]);
      setActiveProfileId(profile.id);
      localStorage.removeItem('chai-config');
    } catch (_) {
      console.debug('[Store] Legacy config parsing failed (non-critical)');
    }
  }

  function loadConfig() {
    // If no profiles exist yet, create a default one so loadConfig never returns null
    const existingProfiles = loadProfiles();
    if (existingProfiles.length === 0) {
      const defaultProfile = {
        id: Date.now().toString(36),
        name: 'Default',
        endpoint: '',
        apiKey: '',
        model: 'gpt-3.5-turbo',
        createdAt: Date.now()
      };
      _profilesDecrypted = [defaultProfile];
      try {
        localStorage.setItem(PROFILES_KEY, JSON.stringify([{ ...defaultProfile, apiKey: '' }]));
      } catch (_) {}
      setActiveProfileId(defaultProfile.id);
      return defaultProfile;
    }

    return getActiveProfile();
  }

  async function saveConfig(config) {
    // Redirect to profiles system
    let profiles = loadProfiles();
    let profile = getActiveProfile();
    if (!profile) {
      // Create a new profile if none exists
      profile = {
        id: Date.now().toString(36),
        name: 'Default',
        endpoint: '',
        apiKey: '',
        model: 'gpt-3.5-turbo',
        createdAt: Date.now()
      };
      profiles.push(profile);
      setActiveProfileId(profile.id);
    }
    profile.endpoint = config.endpoint || '';
    profile.apiKey = config.apiKey || '';
    profile.model = config.model || 'gpt-3.5-turbo';
    await saveProfiles(profiles);
  }

  /* ── Usage stats (localStorage) ── */
  function loadUsage() {
    try {
      const raw = localStorage.getItem(USAGE_KEY);
      return raw ? JSON.parse(raw) : { totalTokens: 0, requests: 0 };
    } catch (_) { return { totalTokens: 0, requests: 0 }; }
  }

  function saveUsage(usage) {
    try {
      localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
    } catch (err) {
      console.error('[Store] Failed to save usage:', err);
    }
  }

  function addUsage(tokens) {
    const usage = loadUsage();
    usage.totalTokens += tokens;
    usage.requests += 1;
    saveUsage(usage);
    return usage;
  }

  /* ── Custom roles (localStorage) ── */
  const ROLES_KEY = 'chai-custom-roles';

  function loadCustomRoles() {
    try {
      const raw = localStorage.getItem(ROLES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function saveCustomRoles(roles) {
    try {
      localStorage.setItem(ROLES_KEY, JSON.stringify(roles));
    } catch (err) {
      console.error('[Store] Failed to save custom roles:', err);
    }
  }

  function addCustomRole(name, systemPrompt) {
    const roles = loadCustomRoles();
    const existing = roles.find(r => r.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.systemPrompt = systemPrompt;
    } else {
      roles.push({ id: Date.now().toString(36), name, systemPrompt });
    }
    saveCustomRoles(roles);
    return roles;
  }

  function deleteCustomRole(id) {
    let roles = loadCustomRoles();
    roles = roles.filter(r => r.id !== id);
    saveCustomRoles(roles);
    return roles;
  }

  /* ── Hidden defaults tracking (localStorage) ── */
  const HIDDEN_DEFAULTS_KEY = 'chai-hidden-defaults';

  function loadHiddenDefaults() {
    try {
      const raw = localStorage.getItem(HIDDEN_DEFAULTS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function addHiddenDefault(name) {
    const hidden = loadHiddenDefaults();
    if (!hidden.includes(name)) {
      hidden.push(name);
      try {
        localStorage.setItem(HIDDEN_DEFAULTS_KEY, JSON.stringify(hidden));
      } catch (err) {
        console.error('[Store] Failed to save hidden defaults:', err);
      }
    }
  }

  function removeHiddenDefault(name) {
    let hidden = loadHiddenDefaults();
    hidden = hidden.filter(h => h !== name);
    try {
      localStorage.setItem(HIDDEN_DEFAULTS_KEY, JSON.stringify(hidden));
    } catch (err) {
      console.error('[Store] Failed to save hidden defaults:', err);
    }
  }

  /* ── Chats (IndexedDB via idb-keyval) ──
     Each chat is stored under its own key (`chai-chat-<id>`) instead of one
     giant array, so a single edit/pin/rename doesn't require reading and
     rewriting every chat's full message history. A small metadata-only
     index (CHATS_INDEX_KEY) is kept alongside for cheap listing/sorting/search
     without loading full message bodies. ── */

  const CHATS_INDEX_KEY = 'chai-chats-index';

  function _chatKey(id) {
    return `chai-chat-${id}`;
  }

  function _indexEntryFromChat(chat) {
    return {
      id: chat.id,
      title: chat.title,
      model: chat.model,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      archived: !!chat.archived,
      tags: chat.tags || [],
      folderId: chat.folderId || '',
      preview: chat.messages && chat.messages.length > 0
        ? Utils.truncate(chat.messages[chat.messages.length - 1].content, 150)
        : ''
    };
  }

  async function _loadIndex() {
    try {
      return (await idbKeyval.get(CHATS_INDEX_KEY)) || [];
    } catch (err) {
      console.error('[Store] Failed to load chat index:', err);
      return [];
    }
  }

  async function _saveIndex(index) {
    try {
      await idbKeyval.set(CHATS_INDEX_KEY, index);
    } catch (err) {
      console.error('[Store] Failed to save chat index:', err);
      throw err;
    }
  }

  async function _updateIndexEntry(chat) {
    const index = await _loadIndex();
    const entry = _indexEntryFromChat(chat);
    const idx = index.findIndex(e => e.id === chat.id);
    if (idx >= 0) {
      index[idx] = entry;
    } else {
      index.unshift(entry);
    }
    await _saveIndex(index);
  }

  // One-time migration from the old single-blob storage format.
  async function migrateLegacyChatStorage() {
    try {
      const legacy = await idbKeyval.get(CHATS_KEY);
      if (!legacy || !Array.isArray(legacy) || legacy.length === 0) {
        if (legacy) await idbKeyval.del(CHATS_KEY);
        return;
      }
      const existingIndex = await idbKeyval.get(CHATS_INDEX_KEY);
      if (existingIndex) {
        // Already migrated previously; just clear the stale legacy blob.
        await idbKeyval.del(CHATS_KEY);
        return;
      }
      const entries = legacy.map(chat => [_chatKey(chat.id), chat]);
      const index = legacy.map(_indexEntryFromChat);
      await idbKeyval.setMany(entries);
      await _saveIndex(index);
      await idbKeyval.del(CHATS_KEY);
    } catch (err) {
      console.error('[Store] Legacy chat migration failed:', err);
    }
  }

  async function listChats(opts) {
    const index = await _loadIndex();
    if (!index.length) return [];

    const options = Object.assign({ sortBy: 'updatedAt', sortDir: 'desc', includeArchived: false, filterTag: '' }, opts || {});

    let filtered = index;

    // Filter archived
    if (!options.includeArchived) {
      filtered = filtered.filter(c => !c.archived);
    }

    // Filter by tag
    if (options.filterTag) {
      filtered = filtered.filter(c => c.tags && c.tags.includes(options.filterTag));
    }

    // Sort (copy first so we don't mutate the cached index order)
    filtered = filtered.slice();
    const sortDir = options.sortDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      if (options.sortBy === 'title') {
        return sortDir * (a.title || '').localeCompare(b.title || '');
      }
      if (options.sortBy === 'createdAt') {
        return sortDir * ((a.createdAt || 0) - (b.createdAt || 0));
      }
      // default: updatedAt
      return sortDir * ((a.updatedAt || 0) - (b.updatedAt || 0));
    });

    return filtered.map(c => Object.assign({}, c));
  }

  async function getChat(id) {
    try {
      return (await idbKeyval.get(_chatKey(id))) || null;
    } catch (err) {
      console.error('[Store] Failed to load chat:', err);
      return null;
    }
  }

  async function saveChat(chat, opts) {
    const existing = await idbKeyval.get(_chatKey(chat.id));
    if (!existing) {
      chat.createdAt = chat.createdAt || Date.now();
    }
    if (!opts?.skipTimestamp) {
      chat.updatedAt = Date.now();
    }
    try {
      await idbKeyval.set(_chatKey(chat.id), chat);
      await _updateIndexEntry(chat);
    } catch (err) {
      console.error('[Store] IndexedDB write failed:', err);
      throw err;
    }
  }

  async function deleteChat(id) {
    try {
      await idbKeyval.del(_chatKey(id));
      const index = await _loadIndex();
      await _saveIndex(index.filter(e => e.id !== id));
    } catch (err) {
      console.error('[Store] Failed to delete chat:', err);
      throw err;
    }
  }

  /* ── Rename a chat without changing updatedAt ── */
  async function renameChat(id, newTitle) {
    const chat = await idbKeyval.get(_chatKey(id));
    if (!chat) return;
    chat.title = newTitle.trim() || chat.title;
    // Do NOT update updatedAt — renaming shouldn't change sort order
    await idbKeyval.set(_chatKey(id), chat);
    await _updateIndexEntry(chat);
  }

  /* ── Toggle archive status ── */
  async function toggleArchive(id) {
    const chat = await idbKeyval.get(_chatKey(id));
    if (!chat) return;
    chat.archived = !chat.archived;
    chat.updatedAt = Date.now();
    await idbKeyval.set(_chatKey(id), chat);
    await _updateIndexEntry(chat);
  }

  /* ── Add tag to a chat ── */
  async function addTag(id, tag) {
    if (!tag.trim()) return;
    const chat = await idbKeyval.get(_chatKey(id));
    if (!chat) return;
    if (!chat.tags) chat.tags = [];
    const t = tag.trim().toLowerCase();
    if (!chat.tags.includes(t)) {
      chat.tags.push(t);
      await idbKeyval.set(_chatKey(id), chat);
      await _updateIndexEntry(chat);
    }
  }

  /* ── Remove tag from a chat ── */
  async function removeTag(id, tag) {
    const chat = await idbKeyval.get(_chatKey(id));
    if (!chat || !chat.tags) return;
    chat.tags = chat.tags.filter(t => t !== tag);
    await idbKeyval.set(_chatKey(id), chat);
    await _updateIndexEntry(chat);
  }

  /* ── Bulk operations ── */
  async function bulkDelete(ids) {
    if (!ids || !ids.length) return;
    await idbKeyval.delMany(ids.map(_chatKey));
    const index = await _loadIndex();
    await _saveIndex(index.filter(e => !ids.includes(e.id)));
  }

  async function bulkArchive(ids, archived) {
    if (!ids || !ids.length) return;
    const keys = ids.map(_chatKey);
    const chats = await idbKeyval.getMany(keys);
    const entries = [];
    chats.forEach((chat, i) => {
      if (!chat) return;
      chat.archived = archived;
      chat.updatedAt = Date.now();
      entries.push([keys[i], chat]);
    });
    if (!entries.length) return;
    await idbKeyval.setMany(entries);
    const index = await _loadIndex();
    for (const [, chat] of entries) {
      const idx = index.findIndex(e => e.id === chat.id);
      if (idx >= 0) index[idx] = _indexEntryFromChat(chat);
    }
    await _saveIndex(index);
  }

  // Full-text search still needs message content, so it loads full chat
  // bodies — but only once per search action, not on every mutation.
  async function searchChats(query) {
    if (!query || !query.trim()) return [];
    const index = await _loadIndex();
    if (!index.length) return [];
    const q = query.toLowerCase();

    // Cheap pass: title/tag matches don't need the full chat body.
    const results = [];
    const needsBodyCheck = [];
    for (const entry of index) {
      if ((entry.title || '').toLowerCase().includes(q)) {
        results.push(Object.assign({}, entry));
      } else {
        needsBodyCheck.push(entry);
      }
    }

    if (needsBodyCheck.length) {
      const keys = needsBodyCheck.map(e => _chatKey(e.id));
      const chats = await idbKeyval.getMany(keys);
      chats.forEach((chat, i) => {
        if (!chat || !chat.messages) return;
        const match = chat.messages.some(m => m.content && m.content.toLowerCase().includes(q));
        if (match) results.push(_indexEntryFromChat(chat));
      });
    }

    return results;
  }

  async function getAllChatsFull() {
    const index = await _loadIndex();
    if (!index.length) return [];
    const chats = await idbKeyval.getMany(index.map(e => _chatKey(e.id)));
    return chats.filter(Boolean);
  }

  // Used by "Restore backup" — wholesale replace of all chat data.
  async function replaceAllChats(chats) {
    const oldIndex = await _loadIndex();
    const list = Array.isArray(chats) ? chats : [];
    // Write new data first so old data is never lost on failure
    if (list.length) {
      await idbKeyval.setMany(list.map(chat => [_chatKey(chat.id), chat]));
    }
    await _saveIndex(list.map(_indexEntryFromChat));
    // Only delete old entries after the new data is safely written
    if (oldIndex.length) {
      // Avoid deleting entries that were just written (same ID = overwritten)
      const newIds = new Set(list.map(c => c.id));
      const toDelete = oldIndex.filter(e => !newIds.has(e.id)).map(e => _chatKey(e.id));
      if (toDelete.length) {
        await idbKeyval.delMany(toDelete);
      }
    }
  }

  return {
   initCrypto: _ensureCrypto, UNCATEGORIZED_FOLDER_ID,
   migrateLegacyConfig, migrateLegacyChatStorage, loadConfig, saveConfig, loadProfiles, saveProfiles, getActiveProfileId, setActiveProfileId, getActiveProfile,
   loadFolders, saveFolders, loadCollapsedFolders, saveCollapsedFolders, setFolderCollapsed, toggleFolderCollapsed, isFolderCollapsed,
   addFolder, renameFolder, deleteFolder, setChatFolder,
   loadUsage, saveUsage, addUsage,
   loadCustomRoles, saveCustomRoles, addCustomRole, deleteCustomRole,
   loadHiddenDefaults, addHiddenDefault, removeHiddenDefault,
   listChats, getChat, saveChat, deleteChat,
   renameChat, searchChats, getAllChatsFull, replaceAllChats, toggleArchive,
   addTag, removeTag, bulkDelete, bulkArchive
  };
})();

// Explicit global (rather than relying on classic-script implicit scope sharing).
window.Store = Store;