# aiCh@t

A minimalist chat UI for interacting with LLMs via a local provider endpoint.

## 🚀 Getting Started

### Prerequisites
- Python 3.x (includes `http.server` module)
- An LLM API endpoint compatible with OpenAI‑style chat completions (e.g., OpenAI, Azure, local Ollama server, etc.)

### 1. Start a local static server
From the folder containing `index.html` (the root of this project), run:

```bash
python -m http.server 8000
```

This will serve the UI at `http://localhost:8000`.

### 2. Open the app
Open your browser and navigate to `http://localhost:8000`. The app will load and you’ll see the sidebar, chat area, and header.

### 3. Configure your provider
1. Click the **Settings** button (gear icon ⚙️) in the top‑right header.
2. In the modal that appears:
   - **Profile Name** – give your configuration a name (e.g., “My Ollama”).
   - **API Endpoint** – the base URL of the provider (e.g., `http://localhost:11434/v1`).
   - **API Key** – your secret key (saved only in this browser’s localStorage). Not required for Ollama.
   - **Model** – the model identifier to use (e.g., `qwen3.5:9b`). You can also use the `↻ Fetch` button to list the available models.
3. (Optional) Use **Test Connection** to verify the endpoint and key work.
4. Press **Save Profile**. The profile becomes active immediately.

## 💬 Using the Chat

### Starting a conversation
- The app starts with an empty chat. Type your message in the input box at the bottom and press **Enter** (or click **Send**).
- The first user message automatically sets the chat title (truncated to 60 characters).

### Sending messages
- **Shift + Enter** inserts a newline inside the input box when you want to insert multiple separate lines.
- Press **Enter** (without Shift) to send the message.
- While the assistant is streaming a response, the **Send** button changes to a **Stop** button (■) – click it to abort generation.

### Message actions (hover over a message)
- ✏️ **Edit** – edit a user message and resend the conversation from that point.
- 📋 **Copy** – copy the message text to clipboard.
- 📍/📌 **Pin/Unpin** – pin a message to keep it visible when scrolling (purely visual).
- ↻ **Regenerate** – regenerate the assistant’s most recent response (keeps the conversation up to that point).

### Chat management (left sidebar)
- **New Chat** – click the **+ New Chat** button (or press **Ctrl/Cmd +N**) to start a fresh conversation.
- **Rename** – double‑click a chat title in the sidebar to edit it inline.
- **Delete** – click the ✕ button on a chat‑list item to delete it.
- **Search** – use the search box at the top of the sidebar (type to filter chats by title or content).
- **Sort** – choose sorting order from the dropdown (Newest, Oldest, A‑Z, Z‑A).
- **Folders** – drag chats onto a folder group in the sidebar; click a folder header to fold/unfold it.

### Advanced Settings (right sidebar)
Click the **Settings** (⚙️) button to open the right‑hand panel:

- **System Prompt** – set a custom system instruction that is prepended to every request.
- **Role** – select or manage predefined roles (system prompts) via the **Edit Roles** button.
- **Theme** – pick a color theme; toggle light/dark mode with the ☀️/🌙 button.
- **Provider** – switch between saved profiles or manage them with **Manage**.
- **Export / Import** – backup/restore chats or import a single chat JSON.
- **Advanced Settings** (collapsible):
  - **Temperature** – randomness of generation (0.0‑2.0).
  - **Max Tokens** – maximum number of tokens the model may generate.

These settings are saved per‑chat and affect subsequent generations.

### Token usage display
- The header shows an **estimated token count** for the whole conversation (e.g., `~12.5K tok context`).  
  This is a rough approximation (≈ 4 characters per token) intended for quick feedback.

### Data persistence
- Chats, profiles, custom roles, usage stats, and UI preferences are stored in the browser’s **IndexedDB** (chats) and **localStorage** (everything else). 

 ⚠️ _**So deleting browser history will delete your chat history and all settings.**_
- No data is sent to any external server except the configured LLM endpoint.

## 📂 Project Structure
```
aiChat/
├── index.html          # Main UI
├── css/                # Stylesheets (base, layout, components, themes, responsive)
├── js/                 # Application logic
│   ├── utils.js        # Helper functions
│   ├── store.js        # IndexedDB/localStorage abstraction
│   ├── api.js          # API wrapper for LLM providers
│   ├── chat.js         # Chat CRUD & message handling
│   ├── ui.js           # DOM manipulation & rendering
│   └── app.js          # Bootstrap & event wiring
└── README.md           # This file
```

## 🛠️ Customisation
- To change the default theme, edit `data-theme` attribute on the `<html>` tag in `index.html`.
- To adjust colors or fonts, modify the CSS variables in `css/base.css`.
- To add more built‑in themes, edit the `THEMES` array in `js/ui.js`.

## ⚠️ Security Note
API keys are stored only in the browser’s localStorage. Never share your browser profile or export the data if it contains sensitive keys.

---

Enjoy chatting with your AI models! If you have any questions or suggestions, feel free to notify author for consideration.

*aiCh@t made with ❤️ by Pranav Yaddanapudi*