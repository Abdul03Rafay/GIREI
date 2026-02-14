// Error handler to catch startup issues
window.onerror = function (message, source, lineno, colno, error) {
    console.error("Window Error:", message, lineno, error);
    // Alert removed for better UX
};

const chatHistory = document.getElementById('chat-history');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');

if (!chatHistory || !messageInput || !sendBtn) {
    alert("Critical Error: Missing DOM elements! Check IDs in index.html");
    console.error("Missing elements:", { chatHistory, messageInput, sendBtn });
}

console.log("Renderer loaded. Elements found.");

// Variables marked, DOMPurify, hljs are handled by the dependency manager below
// let searchTool; // Removed for Ollama API usage

// Initialize Dependencies
(function initDeps() {
    try {
        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');

            // Expose Electron API
            window.electronAPI = {
                toggleTray: (enabled) => ipcRenderer.invoke('toggle-tray', enabled),
                minimize: () => ipcRenderer.send('minimize-window'),
                close: () => ipcRenderer.send('close-window'),
                saveHistory: (history) => ipcRenderer.invoke('save-history', history),
                loadHistory: () => ipcRenderer.invoke('load-history')
            };

            const _marked = require('marked');
            if (_marked && _marked.parse) marked = _marked;
            else if (_marked && _marked.marked) marked = _marked.marked;

            hljs = require('highlight.js');

            // try {
            //     searchTool = require('duck-duck-scrape');
            // } catch (e) {
            //     console.warn("Search tool require failed:", e);
            // }

            try {
                // Handle dompurify factory
                const createDOMPurify = require('dompurify');
                if (typeof createDOMPurify === 'function') {
                    DOMPurify = createDOMPurify(window);
                } else {
                    DOMPurify = createDOMPurify;
                }
            } catch (e) { console.warn("Require dompurify failed:", e); }
        }
    } catch (e) {
        console.warn('Require failed, switching to CDN globals:', e);
    }

    // Fallback to window globals
    if (!marked && window.marked) marked = window.marked;
    if (!hljs && window.hljs) hljs = window.hljs;
    if (!DOMPurify && window.DOMPurify) DOMPurify = window.DOMPurify;

    // Safety for DOMPurify factory in global scope
    if (typeof DOMPurify === 'function' && !DOMPurify.sanitize) {
        try { DOMPurify = DOMPurify(window); } catch (e) { }
    }

    console.log("Rich text status:", { marked: !!marked, hljs: !!hljs, dompurify: !!DOMPurify });

    if (marked && hljs) {
        marked.setOptions({
            highlight: function (code, lang) {
                const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                return hljs.highlight(code, { language }).value;
            },
            langPrefix: 'hljs language-',
        });
    }
})();

const MODEL_NAME = 'deepseek-r1:7b';
const API_URL = 'http://localhost:11434/api/generate';

// Auto-resize textarea
messageInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
    if (this.value === '') {
        this.style.height = 'auto';
    }
});

function formatMessage(text) {
    if (!marked) return text.replace(/\n/g, '<br>');

    // Strip <think> tags logic
    // Strip <think> tags logic
    // 1. Regex strip complete tags
    let cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    cleanText = cleanText.replace(/&lt;think&gt;[\s\S]*?&lt;\/think&gt;/gi, '').trim();

    // 2. Hide incomplete think tag (at the end of string)
    // If we're streaming, we might see "<think>..." without closing.
    // We want to hide that pending content.
    cleanText = cleanText.replace(/<think>[\s\S]*/gi, '').trim();
    cleanText = cleanText.replace(/&lt;think&gt;[\s\S]*/gi, '').trim();

    // 2. Protect Math
    let content = cleanText;
    const displayMath = [];
    content = content.replace(/(\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])/g, (m, full, a, b) => {
        const tex = (a || b || '').trim();
        displayMath.push(tex);
        return `%%%DISPLAY${displayMath.length - 1}%%%`;
    });

    const inlineMath = [];
    content = content.replace(/(\$([^\$\n]+?)\$|\\\(([\s\S]+?)\\\))/g, (m, full, a, b) => {
        const tex = (a || b || '').trim();
        inlineMath.push(tex);
        return `%%%INLINE${inlineMath.length - 1}%%%`;
    });

    // 3. Parse Markdown
    let html;
    try {
        html = marked.parse(content);

        // 4. Sanitize (Allow think tags so CSS can hide them if regex missed)
        if (DOMPurify && typeof DOMPurify.sanitize === 'function') {
            html = DOMPurify.sanitize(html, { ADD_TAGS: ['think'] });
        }
    } catch (e) {
        console.error("Markdown parse error:", e);
        html = content;
    }

    // 5. Restore Math for MathJax
    html = html.replace(/%%%DISPLAY(\d+)%%%/g, (m, i) => `$$${displayMath[i]}$$`);
    html = html.replace(/%%%INLINE(\d+)%%%/g, (m, i) => `\\(${inlineMath[i]}\\)`);

    return html;
}

function addMessage(text, type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    if (type === 'ai' || type === 'system') {
        bubble.innerHTML = formatMessage(text);

        if (hljs) {
            bubble.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
        }

        // MathJax Typeset
        if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
            window.MathJax.typesetPromise([bubble]).catch(err => console.log('MathJax error:', err));
        } else {
            setTimeout(() => {
                if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
                    window.MathJax.typesetPromise([bubble]).catch(e => null);
                }
            }, 1000);
        }
    } else {
        bubble.textContent = text;
    }

    messageDiv.appendChild(bubble);
    chatHistory.appendChild(messageDiv);
    chatHistory.scrollTop = chatHistory.scrollHeight;
    return bubble;
}

// Conversation History Tracking
let conversationHistory = [];

async function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;

    messageInput.value = '';
    messageInput.style.height = 'auto';

    addMessage(text, 'user');

    // Add to history
    conversationHistory.push({ role: 'user', content: text });

    // Save state
    if (window.electronAPI) {
        window.electronAPI.saveHistory(conversationHistory);
    }

    // Loading Animation
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message ai';
    const loadingBubble = document.createElement('div');
    loadingBubble.className = 'bubble';
    loadingBubble.innerHTML = `
    <div class="siri-container">
        <div class="siri-blob blob-1"></div>
        <div class="siri-blob blob-2"></div>
        <div class="siri-blob blob-3"></div>
    </div>`;
    loadingDiv.appendChild(loadingBubble);
    chatHistory.appendChild(loadingDiv);

    // Auto-scroll to bottom on send
    chatHistory.scrollTop = chatHistory.scrollHeight;

    try {
        // Call Python Backend
        // Pass the model name to the backend if supported, or just rely on backend default.
        // Since backend was hardcoded, let's update it to accept model param?
        // Actually, the backend 'chat_endpoint' didn't accept model param in the previous step.
        // We need to update backend server.py to accept 'model' field.
        // Let's send it anyway, hoping we update server.py next.

        const modelToUse = window.currentActiveModel || MODEL_NAME;
        const useWebSearch = localStorage.getItem('webSearch') === 'true';
        const systemPrompt = localStorage.getItem('systemPrompt') || null;
        const temperature = parseFloat(localStorage.getItem('temperature') || 0.7);

        const response = await fetch('http://localhost:8000/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: conversationHistory,
                model: modelToUse,
                web_search: useWebSearch,
                temperature: temperature,
                system_prompt: systemPrompt
            })
        });

        if (!response.ok) throw new Error(`Backend Error: ${response.statusText}`);

        // Streaming Handler
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let accumulatedText = "";
        let isFirstMsg = true;

        // Smart Scrolling Helper
        const isAtBottom = () => {
            return (chatHistory.scrollHeight - chatHistory.scrollTop - chatHistory.clientHeight) < 50;
        };
        let shouldAutoScroll = true; // Default to true initially

        // Removed loading animation remove call from here

        // We will create the AI message bubble ONLY when we get data
        let aiBubble = null;
        let rawAiResponse = "";

        while (true) {
            const { done, value } = await reader.read();

            // Check scroll position RIGHT after data arrives, before we modify the DOM.
            // This ensures if user scrolls up while we were waiting for network, we respect it.
            shouldAutoScroll = isAtBottom();

            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            accumulatedText += chunk;
            rawAiResponse += chunk;

            if (isFirstMsg) {
                // Remove loading animation only AFTER we get the first chunk
                if (loadingDiv.parentNode) chatHistory.removeChild(loadingDiv);

                // Create bubble now that we have content
                aiBubble = addMessage("", 'ai');
                isFirstMsg = false;

                // Force scroll on first chunk
                shouldAutoScroll = true;
            }

            // Update UI
            if (aiBubble) {
                aiBubble.innerHTML = formatMessage(accumulatedText);

                // Re-highlight code blocks
                if (hljs) {
                    aiBubble.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
                }
            }

            if (shouldAutoScroll) {
                chatHistory.scrollTop = chatHistory.scrollHeight;
            }
        }

        // Final MathJax Typeset after stream
        if (window.MathJax && typeof window.MathJax.typesetPromise === 'function') {
            window.MathJax.typesetPromise([aiBubble]).catch(e => null);
        }

        // Add full AI response to history
        conversationHistory.push({ role: 'assistant', content: rawAiResponse });

        // Save state
        if (window.electronAPI) {
            window.electronAPI.saveHistory(conversationHistory);
        }

    } catch (error) {
        console.error(error);
        if (typeof loadingDiv !== 'undefined' && loadingDiv.parentNode) chatHistory.removeChild(loadingDiv);
        addMessage(`Error: Could not connect to Backend. Make sure 'start_app.sh' is running.`, 'system');
    }
}

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Initial Greeting removed from here, moved to loadHistory logic to avoid duplicate greetings
window.addEventListener('DOMContentLoaded', async () => {
    // addMessage("Hey, Rafay what can I help you with?", 'ai');

    // Window Controls
    const minBtn = document.getElementById('min-btn');
    const closeBtn = document.getElementById('close-btn');

    if (minBtn && window.electronAPI) {
        minBtn.onclick = () => window.electronAPI.minimize();
    }
    if (closeBtn && window.electronAPI) {
        closeBtn.onclick = () => window.electronAPI.close();
    }

    // Model Management
    const headerTitle = document.getElementById('theme-toggle-text');
    const modelDropdown = document.getElementById('model-dropdown');
    let currentModel = 'deepseek-r1:7b';
    let availableModels = [];

    // Settings Tab Management
    const settingsTab = document.getElementById('settings-tab');
    const chatContainer = document.getElementById('chat-history');

    // LOAD HISTORY
    if (window.electronAPI) {
        try {
            const savedHistory = await window.electronAPI.loadHistory();
            if (savedHistory && Array.isArray(savedHistory) && savedHistory.length > 0) {
                conversationHistory = savedHistory;
                // Re-render
                conversationHistory.forEach(msg => {
                    addMessage(msg.content, msg.role === 'assistant' ? 'ai' : msg.role);
                });
            } else {
                addMessage("Hey, Rafay what can I help you with?", 'ai');
            }
        } catch (e) {
            console.error("Failed to load history", e);
            addMessage("Hey, Rafay what can I help you with?", 'ai');
        }
    } else {
        addMessage("Hey, Rafay what can I help you with?", 'ai');
    }

    // FETCH MODELS ON STARTUP (Non-blocking)
    fetchModels();

    // Fetch models from Ollama
    async function fetchModels() {
        try {
            const response = await fetch('http://localhost:11434/api/tags');
            if (response.ok) {
                const data = await response.json();
                availableModels = data.models.map(m => m.name);
                console.log("Available models:", availableModels);

                // Ensure current model is in list or pick first
                if (!availableModels.includes(currentModel) && availableModels.length > 0) {
                    currentModel = availableModels[0];
                }
                updateHeader();
                renderModelList();
            }
        } catch (e) {
            console.error("Failed to fetch models:", e);
        }
    }

    function updateHeader() {
        if (headerTitle) {
            headerTitle.textContent = currentModel;
        }
        window.currentActiveModel = currentModel;
    }

    function renderModelList() {
        if (!modelDropdown) return;
        modelDropdown.innerHTML = '';
        availableModels.forEach(model => {
            const item = document.createElement('div');
            item.className = `model-item ${model === currentModel ? 'active' : ''}`;
            item.textContent = model;
            item.onclick = (e) => {
                e.stopPropagation();
                currentModel = model;
                updateHeader();
                renderModelList(); // Re-render to update active state
                modelDropdown.classList.add('hidden');
            };
            modelDropdown.appendChild(item);
        });
    }

    // Toggle dropdown
    if (headerTitle) {
        headerTitle.onclick = (e) => {
            e.stopPropagation();
            modelDropdown.classList.toggle('hidden');
        };
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
        if (modelDropdown && !modelDropdown.classList.contains('hidden')) {
            modelDropdown.classList.add('hidden');
        }
    });

    // Pull Down Settings Tab Logic (Overscroll)
    let isSettingsOpen = false;

    function openSettings() {
        isSettingsOpen = true;
        settingsTab.classList.add('visible');
    }

    function closeSettings() {
        isSettingsOpen = false;
        settingsTab.classList.remove('visible');
    }

    // Pull Down Logic & Scroll Up to Close
    window.addEventListener('wheel', (e) => {
        if (!isSettingsOpen) {
            // Pull Down to Open (at top)
            if (chatContainer && chatContainer.scrollTop === 0 && e.deltaY < -40) {
                openSettings();
            }
        } else {
            // Push Up to Close (scrolling down logically pushes content up?)
            // If we are just scrolling normally on the page (deltaY > 0)
            // and NOT hovering the settings content (which has its own scroll)
            // Let's rely on the Close Button and Click Outside for now to be safe.
            // But user asked for "scroll back up and closed".
            // If they mean "Reverse the pull down gesture":
            // Pull Down (deltaY < 0) -> Open.
            // "Scroll Back Up" -> deltaY > 0?
            // Let's implement deltaY > 30 closes it if we are at top.
            if (settingsTab.scrollTop === 0 && e.deltaY > 20) {
                closeSettings();
            }
        }
    });

    // Close Button Removed per user request
    // if (closeSettingsBtn) ... removed

    // Close when clicking outside specific elements
    document.addEventListener('click', (e) => {
        // If settings are open, and we click OUTSIDE the settings-content (the white box)
        if (isSettingsOpen) {
            const content = settingsTab.querySelector('.settings-content');
            if (content && !content.contains(e.target) && !e.target.closest('#theme-toggle-text')) {
                closeSettings();
            }
        }
    });

    // Load saved settings
    const savedWebSearch = localStorage.getItem('webSearch') === 'true';
    const savedMenuBar = localStorage.getItem('menuBar') === 'true';
    const savedTemp = localStorage.getItem('temperature') || 0.7;
    const savedPrompt = localStorage.getItem('systemPrompt') || '';

    // Initialize UI
    // Transparency Slider Removed

    if (webSearchToggle) {
        webSearchToggle.checked = savedWebSearch;
        webSearchToggle.addEventListener('change', (e) => {
            localStorage.setItem('webSearch', e.target.checked);
        });
    }

    if (menubarToggle) {
        menubarToggle.checked = savedMenuBar;
        window.electronAPI && window.electronAPI.toggleTray(savedMenuBar); // Initial State

        menubarToggle.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            localStorage.setItem('menuBar', isChecked);
            if (window.electronAPI) {
                window.electronAPI.toggleTray(isChecked);
            }
        });
    }

    function updateTransparency(val) {
        // Map 0-100 slider to 0.1-0.9 opacity range (inverted or direct? "Transparency" slider usually means higher val = more transparent)
        // Let's say 0 = opaque (alpha 1), 100 = transparent (alpha 0)
        // But for background visibility, maybe "Opacity" is better. Let's assume "Transparency" label means:
        // 0% -> Fully Visible (Normal)
        // 100% -> Invisible

        // Use css variable --bg-opacity if strictly using CSS, or update background color directly.
        // Current CSS uses rgba(), let's try to update the --bg-color and --input-bg with new alpha.
        // Easier: Set a CSS variable for the alpha channel.

        // Calculating Alpha:
        // 100% Transparency = 0 Alpha
        // 0% Transparency = 1 Alpha (or whatever max was)

        // Only adjusting background mostly.
        // Let's interpret slider: 0 = Darkest/Most Opaque, 100 = Most Transparent

        // Base Alpha for Dark Mode is roughly 0.8
        const maxAlpha = 0.95;
        const minAlpha = 0.1;

        // val 0 -> maxAlpha
        // val 100 -> minAlpha
        const alpha = maxAlpha - ((val / 100) * (maxAlpha - minAlpha));

        // We need to update CSS variables that use RGBA.
        // This is tricky with pre-defined rgba colors.
        // Alternative: Update the alpha of specific elements via JS.

        document.documentElement.style.setProperty('--bg-alpha', alpha);

        // We need to update CSS to use this variable.
        // For now, let's inject a style rule or update specific props.
        // Let's update the body background or .app-container

        // Actually, styles.css uses hardcoded rgba.
        // Let's override --dropdown-bg and --bubble-user etc if we want global transparency?
        // User asked for "chat app window background".
        // That is .settings-tab (which has bg) and .app-container (which is transparent).
        // If app-container is transparent, the window itself determines.
        // If we want to change window transparency, we might need Electron setOpacity, 
        // OR we just change the background color of the body to be more/less opaque.

        // Since main.js has transparent: true, the body background controls it.
        // body background is transparent.
        // .app-container is transparent.
        // So the user sees desktop.
        // To make it LESS transparent (more opaque), we add a background color.

        // Let's set a background color on .app-container with dynamic alpha.
        // Dark mode: Black, Light mode: White.

        const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const baseColor = isDark ? '0, 0, 0' : '255, 255, 255';

        // Update a new variable
        document.body.style.backgroundColor = `rgba(${baseColor}, ${alpha})`; // Actually body is usually transparent.
        // Let's target .app-container
        const appContainer = document.querySelector('.app-container');
        if (appContainer) {
            appContainer.style.backgroundColor = `rgba(${baseColor}, ${1 - alpha})`; // Wait, transparency slider...
            // Slider 100 = Transparent -> Alpha 0
            // Slider 0 = Opaque -> Alpha 1

            // The slider value "20" (default) -> Mostly Opaque? Or mostly transparent?
            // Usually "Transparency" 20% means 80% Opaque.

            // Let's treat Value as "% Transparency".
            // Alpha = 1 - (Value / 100).
            // But we want to keep it "Glassy".
            // Let's clamp it.

            const calculatedAlpha = 1 - (val / 100);
            appContainer.style.backgroundColor = `rgba(${baseColor}, ${Math.max(0.05, calculatedAlpha * 0.9)})`;
        }
    }

    function updateHeader() {
        if (headerTitle) {
            headerTitle.textContent = currentModel;
        }
        if (settingsModelName) {
            settingsModelName.textContent = currentModel;
        }
        window.currentActiveModel = currentModel;
    }

    // Model Downloader Logic
    const popularModels = [
        "deepseek-r1:1.5b", "deepseek-r1:7b", "deepseek-r1:8b", "deepseek-r1:14b",
        "llama3.2", "mistral", "gemma:2b", "phi3", "tinyllama"
    ];

    const downloaderList = document.getElementById('model-downloader');
    const downloadStatus = document.getElementById('download-status');

    if (downloaderList) {
        popularModels.forEach(m => {
            const div = document.createElement('div');
            div.className = 'download-item';
            div.innerHTML = `<span>${m}</span> <small>Download</small>`;
            div.onclick = () => pullModel(m);
            downloaderList.appendChild(div);
        });
    }

    async function pullModel(modelName) {
        if (!downloadStatus) return;
        downloadStatus.classList.remove('hidden');
        downloadStatus.textContent = `Starting download for ${modelName}...`;

        try {
            const response = await fetch('http://localhost:8000/pull', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: modelName })
            });

            if (!response.ok) throw new Error("Pull failed");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(l => l.trim());

                for (const line of lines) {
                    try {
                        const data = JSON.parse(line);
                        if (data.status) {
                            let statusText = `Downloading ${modelName}: ${data.status}`;
                            if (data.completed && data.total) {
                                const pct = Math.round((data.completed / data.total) * 100);
                                statusText += ` (${pct}%)`;
                            }
                            downloadStatus.textContent = statusText;
                        }
                    } catch (e) { }
                }
            }
            downloadStatus.textContent = `Successfully downloaded ${modelName}!`;
            setTimeout(() => {
                downloadStatus.classList.add('hidden');
                fetchModels(); // Refresh list
            }, 3000);

        } catch (e) {
            downloadStatus.textContent = `Error: ${e.message}`;
        }
    }

    // Stats Updater
    setInterval(async () => {
        if (!settingsTab || !settingsTab.classList.contains('visible')) return; // Only update if visible
        try {
            const res = await fetch('http://localhost:8000/stats');
            if (res.ok) {
                const data = await res.json();
                if (memStats) {
                    memStats.textContent = `CPU: ${data.cpu_percent}% | RAM: ${data.system_memory_percent}% | Ollama: ${data.ollama_memory_mb}MB`;
                }
            }
        } catch (e) { }
    }, 2000); // Faster updates

    // Blur Logic: Toggle class on chat-history and input-area when settings visible
    // We need to inject this into the scroll handler
    const blurTargets = [chatContainer, document.querySelector('.input-area'), document.querySelector('.chat-header')];

    function toggleBlur(shouldBlur) {
        blurTargets.forEach(el => {
            if (el) {
                if (shouldBlur) el.classList.add('blur-content');
                else el.classList.remove('blur-content');
            }
        });
    }

    // Override the existing wheel handler logic slightly
    // We already have:
    // if (chatContainer.scrollTop === 0 && e.deltaY < -30 && !isSettingsOpen) { ... }

    // We can just add a MutationObserver on settingsTab to detect class change? 
    // Or simpler: just modifying the existing event listener?
    // Since I can't easily find the existing listener function reference to remove it, I will just append a new observer logic to sync blur state.

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.target.classList.contains('visible')) {
                toggleBlur(true);
            } else {
                toggleBlur(false);
            }
        });
    });

    if (settingsTab) {
        observer.observe(settingsTab, { attributes: true, attributeFilter: ['class'] });
    }
});
