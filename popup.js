document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const saveKeyBtn = document.getElementById('saveKeyBtn');
  const keyStatus = document.getElementById('keyStatus');
  const promptInput = document.getElementById('promptInput');
  const runAgentBtn = document.getElementById('runAgentBtn');
  const consoleOutput = document.getElementById('consoleOutput');
  const btnText = runAgentBtn.querySelector('.btn-text');
  const loader = runAgentBtn.querySelector('.loader');

  // Load existing API Key
  chrome.storage.local.get(['geminiApiKey'], (result) => {
    if (result.geminiApiKey) {
      apiKeyInput.value = result.geminiApiKey;
    }
  });

  // Save API Key
  saveKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
      chrome.storage.local.set({ geminiApiKey: key }, () => {
        keyStatus.textContent = 'API Key saved successfully!';
        keyStatus.className = 'status-msg success';
        setTimeout(() => { keyStatus.textContent = ''; }, 3000);
      });
    } else {
      keyStatus.textContent = 'Please enter a valid key.';
      keyStatus.className = 'status-msg error';
    }
  });

  // Run Agent
  runAgentBtn.addEventListener('click', () => {
    const prompt = promptInput.value.trim() || 'Organize my tabs into workspaces and close duplicates.';
    
    // Check key
    chrome.storage.local.get(['geminiApiKey'], (result) => {
      if (!result.geminiApiKey) {
        appendLog('System', 'Error: Please save your Gemini API Key first.', 'error-log');
        return;
      }

      setLoading(true);
      consoleOutput.innerHTML = ''; // Clear previous
      appendLog('User', prompt, 'user');

      // Send to background service worker
      chrome.runtime.sendMessage({ 
        action: 'RUN_AGENT', 
        payload: prompt 
      });
    });
  });

  // Listen for logs from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'AGENT_LOG') {
      appendLog(message.source, message.text, message.logType);
    }
    
    if (message.type === 'AGENT_COMPLETE') {
      setLoading(false);
      appendLog('Agent', message.text, 'final-response');
    }

    if (message.type === 'AGENT_ERROR') {
      setLoading(false);
      appendLog('System', message.text, 'error-log');
    }

    if (message.type === 'CONFIRM_REQUIREMENT') {
      appendLog('Agent', `Waiting for confirmation: ${message.text}`, 'system');
      const isConfirmed = confirm(`TabZen Agent needs confirmation:\n${message.text}`);
      appendLog('User', isConfirmed ? 'Confirmed' : 'Denied', 'user');
      sendResponse({ confirmed: isConfirmed });
      return true; // Keeps the message channel open for sendResponse
    }
  });

  function setLoading(isLoading) {
    runAgentBtn.disabled = isLoading;
    if (isLoading) {
      btnText.classList.add('hidden');
      loader.classList.remove('hidden');
    } else {
      btnText.classList.remove('hidden');
      loader.classList.add('hidden');
    }
  }

  function appendLog(source, text, styleClass) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${styleClass}`;
    
    let prefix = '';
    switch(styleClass) {
      case 'user': prefix = '👤 User: '; break;
      case 'thought': prefix = '🤔 Thought: '; break;
      case 'tool-call': prefix = '🛠️ Tool Call: '; break;
      case 'tool-result': prefix = '↪ Function Result: '; break;
      case 'final-response': prefix = '✨ Done: '; break;
      case 'error-log': prefix = '❌ Error: '; break;
      default: prefix = `[${source}] `;
    }

    entry.textContent = `${prefix}${text}`;
    consoleOutput.appendChild(entry);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }
});
