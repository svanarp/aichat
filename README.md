# aiCh@t

A minimalist chat UI for interacting with LLMs via a local provider endpoint.

## Getting Started

### Prerequisites
- Python 3.x (includes `http.server` module)
- An LLM API endpoint compatible with OpenAI-style chat completions (e.g., OpenAI, Azure, local Ollama server, etc.)

### 1. Start a local static server
From the folder containing `index.html` (the root of this project), run:

```bash
python -m http.server 8000
```

This will serve the UI at `http://localhost:8000`.

### 2. Open the app
Open your browser and navigate to `http://localhost:8000`. The app will load and you'll see the sidebar, chat area, and header.

### 3. Configure your provider
1. Click the **Settings** button (gear icon ⚙️) in the top-right header to open the right sidebar.
2. In the **Provider** section, select a profile from the dropdown or click **Manage** to open the profile manager.
3. In the profile manager modal:
   - **Profile Name** - give your configuration a name (e.g., "My Ollama").
   - **API Endpoint** - the base URL of the provider (e.g., `http://localhost:11434/v1`).
   - **API Key** - your secret key (saved only in this browser's localStorage, encrypted at rest). Not required for Ollama.
   - **Model** - the model identifier to use (e.g., `qwen3.5:9b`). You can also use the **↻ Fetch** button to list available models from the endpoint.
4. Use **Test** to verify the endpoint and key work.
5. Press **Save**. The profile becomes active immediately.

## Using the Chat

### Starting a conversation
- The app starts with an empty chat. Type your message in the input box at the bottom and press **Enter** (or click **Send**).
- The first user message automatically sets the chat title (truncated to 60 characters).

### Sending messages
- **Shift+Enter** inserts a newline inside the input box when you want to insert multiple separate lines.
- Press **Enter** (without Shift) to send the message.
- While the assistant is streaming a response, the **Send** button changes to a **Stop** button (■) - click it to abort generation.

### Message actions (hover over a message)
- ✏️ **Edit** - edit a user message and resend the conversation from that point.
- 📋 **Copy** - copy the message text to clipboard.
- 📍/📌 **Pin/Unpin** - pin a message to keep it visible when scrolling (purely visual).
- 🔄 **Regenerate** - regenerate the assistant's most recent response (keeps the conversation up to that point).
- 🔀 **Fork** - fork the conversation from this message into a new chat.

### Chat management (left sidebar)
- **New Chat** - click the **+ New Chat** button to start a fresh conversation.
- **Rename** - double-click a chat title in the sidebar to edit it inline.
- **Delete** - click the ✕ button on a chat-list item to delete it.
- **Search** - use the search box at the top of the sidebar (type to filter chats by title or content).
- **Sort** - choose sorting order from the dropdown (Newest, Oldest, A-Z, Z-A).
- **Folders** - click **+ New Folder** to create a folder group; drag chats onto a folder to organize them; click a folder header to fold/unfold it; rename or delete folders with the ✏️/✕ buttons.

### In-chat search
- Press **Ctrl+F** (or **Cmd+F**) to open the in-chat search bar.
- Type to highlight all matches in the current conversation.
- Use **Enter**/**Shift+Enter** or the ▲/▼ buttons to navigate between matches.
- Press **Escape** or click ✕ to close.

### Keyboard shortcuts
| Shortcut | Action |
|---|---|
| `Enter` | Send message |
| `Shift+Enter` | New line in input |
| `Ctrl/Cmd+/` | New chat |
| `Ctrl/Cmd+,` | Open provider config |
| `Ctrl/Cmd+F` | Search in current chat |
| `Ctrl/Cmd+Shift+F` | Focus sidebar search |
| `/` | Focus message input |
| `Escape` | Close modal / close in-chat search |

### Settings (right sidebar)
Click the **Settings** (⚙️) button to open the right-hand panel:

- **System Prompt** - set a custom system instruction that is prepended to every request.
- **Persona** - select or manage predefined personas (system prompts) via the **Manage** button. 10 built-in personas are available (Helpful Assistant, Creative Writer, Code Expert, Data Analyst, Patient Tutor, Translator & Linguist, Debate Partner, Storyteller, Business Consultant, Philosopher), plus custom ones you create.
- **Theme** - pick from 10 color themes (Aurora Flux, Ocean Ember, Graphite Candy, Mint Galaxy, Sakura Tech, Citrus Garden, Lavender Forest, Neon Noir, Solar Mirage, Retro Arcade); toggle light/dark mode with the ☀️/🌙 button.
- **Provider** - switch between saved profiles or manage them with **Manage**.
- **Model** - searchable model selector with **↻ Fetch** button to load available models from the endpoint.
- **Export / Import** (collapsible):
  - Export current chat as **JSON**, **HTML**, or **Markdown**.
  - **Backup All** - download all chats, profiles, personas, and settings.
  - **Restore** - restore from a backup file (overwrites all data).
  - **Import Chat JSON** - import a single chat from a JSON file.
- **Advanced Settings** (collapsible):
  - **Temperature** - randomness of generation (0.0-2.0).
  - **Max Tokens** - maximum number of tokens the model may generate.
  - **Reasoning Effort** - Low/Medium/High (for models that support reasoning).

These settings are saved per-chat and affect subsequent generations.

### Thinking mode
- Toggle the **🧠 Think** checkbox below the input to enable a concise reasoning summary when useful.
- When enabled, the system prompt includes a directive to use deliberate reasoning.
- Reasoning content is displayed in a collapsible `<details>` block within the assistant's message.

### Token usage display
- The header shows an **estimated token count** for the whole conversation (e.g., `~12.5K tok context`).
- Each message shows character count, word count, and estimated/actual token count.
- Streaming messages display real-time chunk count and speed (t/s).
- Total usage stats are tracked across all sessions.

### Data persistence
- Chats are stored in the browser's **IndexedDB** (individual keys per chat for efficient updates).
- Profiles, personas, usage stats, folders, and UI preferences are stored in **localStorage**.
- API keys are **encrypted at rest** using AES-GCM with a per-session key stored in sessionStorage.

> **⚠️ _Deleting browser history will delete your chat history and all settings._**
- No data is sent to any external server except the configured LLM endpoint.

## Project Structure
```
aiChat/
├── index.html              # Main UI
├── css/
│   ├── base.css            # CSS variables, resets, typography
│   ├── layout.css          # Grid, sidebar, header, input area
│   ├── components.css      # Messages, buttons, modals, toasts
│   ├── themes.css          # 10 color themes (light + dark variants)
│   └── responsive.css      # Mobile/tablet breakpoints
├── js/
│   ├── utils.js            # Helper functions (IDs, dates, tokens, escaping)
│   ├── store.js            # IndexedDB + localStorage abstraction (chats, profiles, folders, roles)
│   ├── api.js              # OpenAI-compatible API client with streaming
│   ├── chat.js             # Chat CRUD, message operations, streaming orchestration
│   ├── ui.js               # Markdown rendering, sanitization, roles, toasts, input stats
│   ├── renderer.js         # DOM rendering (messages, sidebar, header, code blocks, charts, mermaid)
│   ├── search.js           # In-chat text search with highlighting
│   ├── theme.js            # Theme & mode management (10 themes, light/dark)
│   ├── theme-boot.js       # Apply saved theme before first paint (avoids FOUC)
│   ├── modals.js           # Modal dialogs (profile manager, persona manager, confirm, prompt)
│   ├── export.js           # Export/import/backup (JSON, HTML, Markdown)
│   └── app.js              # Bootstrap, event wiring, keyboard shortcuts, draft management
├── vendor/                 # Third-party libraries (vendored for offline use)
│   ├── idb-keyval/         # IndexedDB key-value wrapper
│   ├── marked/             # Markdown parser
│   ├── dompurify/          # HTML sanitizer
│   ├── highlightjs/        # Syntax highlighting
│   ├── mermaid/            # Diagram rendering
│   ├── chartjs/            # Chart rendering
│   └── github-markdown/    # GitHub-flavored markdown CSS
└── README.md               # This file
```

## Features

### Rich message rendering
- **Markdown** - full markdown support via `marked` + `DOMPurify` sanitization.
- **Syntax highlighting** - code blocks highlighted via `highlight.js` with language badge, copy button, and language selector.
- **Mermaid diagrams** - render ````mermaid code blocks as rendered diagrams.
- **Chart.js** - render ````chart or ````chart.js code blocks as interactive charts.
- **Reasoning blocks** - `reasoning`, `thought`, `thinking`, `<think>`, `<reasoning>`, and `|<channel>thought|` blocks rendered as collapsible details.
- **Streaming** - real-time token-by-token streaming with speed indicator.

### Security
- **Content Security Policy** - strict CSP in `<meta>` tag (`default-src 'self'`).
- **API key encryption** - keys encrypted with AES-GCM, key stored in sessionStorage.
- **HTML sanitization** - all rendered markdown sanitized via DOMPurify with allow-listed tags and attributes.
- **Safe links** - only `http:`, `https:`, and `mailto:` URLs allowed; all links open with `noopener noreferrer`.

### Accessibility
- Skip-to-main-content link.
- ARIA labels and roles throughout.
- Keyboard-navigable chat list (arrow keys).
- Focus trapping in modal dialogs.
- Screen-reader-friendly live region for chat messages.

## Customisation
- To change the default theme, edit `data-theme` attribute on the `<html>` tag in `index.html`.
- To adjust colors or fonts, modify the CSS variables in `css/base.css` and `css/themes.css`.
- To add more built-in themes, edit the `THEMES` array in `js/theme.js`.
- To add or modify built-in personas, edit the `DEFAULT_ROLES` array in `js/ui.js`.

## Security Note
API keys are encrypted at rest using AES-GCM and stored in the browser's localStorage. The encryption key exists only in sessionStorage and is discarded when the browser tab is closed. 
> Never share your browser profile or exported data as it may contains sensitive keys.

---

Enjoy chatting with your AI models! If you have any questions or suggestions, feel free to notify author for consideration.
