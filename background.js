const PRIMARY_MODEL = 'gemini-3.1-flash-lite-preview';
const FALLBACK_MODEL = 'gemini-2.5-flash-lite';

function getApiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

// Helper: send logs to popup UI
function sendLog(type, text, logType, source = 'Agent') {
  chrome.runtime.sendMessage({
    type: type,
    text: text,
    logType: logType,
    source: source
  }).catch(() => { /* ignore if popup closed */ });
}

// -----------------------------------------
// CUSTOM TOOLS IMPLEMENTATION
// -----------------------------------------

async function get_open_tabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.map(t => ({
    id: t.id,
    title: t.title,
    url: t.url,
    active: t.active,
    groupId: t.groupId
  }));
}

function requestUserConfirmation(messageText) {
  return new Promise((resolve) => {
    // Send message to the UI (which is now in a tab) to show a confirm dialog
    chrome.runtime.sendMessage({
      type: 'CONFIRM_REQUIREMENT',
      text: messageText
    }, (response) => {
      resolve(response && response.confirmed);
    });
  });
}

async function close_tabs(args) {
  const tabIds = args.tab_ids;
  if (!tabIds || tabIds.length === 0) return { error: "No tab IDs provided" };

  try {
    const tabsToClose = [];
    for (const tid of tabIds) {
      try {
        const t = await chrome.tabs.get(tid);
        tabsToClose.push(`- ${t.title || t.url}`);
      } catch (e) {
        tabsToClose.push(`- Tab ID: ${tid}`);
      }
    }
    const tabListStr = tabsToClose.join('\n');
    const confirmed = await requestUserConfirmation(`Close these ${tabIds.length} tabs?\n${tabListStr}`);
    if (!confirmed) {
      return { success: false, message: "User denied the request to close these tabs." };
    }
    await chrome.tabs.remove(tabIds);
    return { success: true, message: `Closed ${tabIds.length} tabs` };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function group_tabs_by_intent(args) {
  const { intent_name, tab_ids } = args;
  if (!tab_ids || tab_ids.length === 0) return { error: "No tab IDs provided" };

  try {
    const groupId = await chrome.tabs.group({ tabIds: tab_ids });
    await chrome.tabGroups.update(groupId, {
      title: intent_name,
      collapsed: true
    });
    return { success: true, message: `Grouped ${tab_ids.length} tabs under intent '${intent_name}'` };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function summarize_inactive_tabs(args) {
  // We approximate "inactive" by looking at tabs not currently active
  // Since extension context without extended permissions can't track long lastAccessed well
  // we just summarize all tabs that aren't the currently active one.
  const tabs = await chrome.tabs.query({ currentWindow: true, active: false });
  const summaries = tabs.map(t => `${t.id}: ${t.title} (${t.url})`);
  return {
    success: true,
    inactive_tabs_count: tabs.length,
    tabs_data: summaries.slice(0, 50) // limit to not overflow context
  };
}

async function ungroup_tabs(args) {
  const { tab_ids } = args;
  if (!tab_ids || tab_ids.length === 0) return { error: "No tab IDs provided" };

  try {
    await chrome.tabs.ungroup(tab_ids);
    return { success: true, message: `Ungrouped ${tab_ids.length} tabs` };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function get_tab_last_accessed(args) {
  const { tab_id } = args;
  if (!tab_id) return { error: "No tab ID provided" };

  try {
    const tab = await chrome.tabs.get(tab_id);
    if (!tab.lastAccessed) {
      return { success: false, message: "Last accessed information is not available for this tab." };
    }
    const lastAccess = new Date(tab.lastAccessed);
    const now = new Date();

    return {
      success: true,
      tab_title: tab.title,
      last_accessed_local: lastAccess.toLocaleString(),
      current_time_local: now.toLocaleString()
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

async function summarize_group_tabs(args) {
  const { group_id } = args;
  if (group_id === undefined) return { error: "No group ID provided" };

  try {
    const tabs = await chrome.tabs.query({ groupId: group_id });
    if (tabs.length === 0) return { error: "No tabs found in this group." };

    let content = "";
    for (const t of tabs) {
      if (t.url && t.url.startsWith('http')) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: t.id },
            func: () => {
              const body = document.body;
              return body ? body.innerText.substring(0, 5000) : "";
            }
          });
          const text = results && results[0] ? results[0].result : "";
          content += `\n\n--- TAB: ${t.title} (${t.url}) ---\n${text}\n`;
        } catch (e) {
          content += `\n\n--- TAB: ${t.title} (${t.url}) ---\n[Could not read content: ${e.message}]\n`;
        }
      } else {
        content += `\n\n--- TAB: ${t.title} (${t.url}) ---\n[Cannot read text from non-http URLs]\n`;
      }
    }

    return {
      success: true,
      message: "Here is the extracted content from the tabs. Read it carefully. You MUST now generate a single unified one-page Markdown summary of the key findings spanning across all of these tabs. Keep your final summary response between 200 to 250 words and display it with proper formatting and structure",
      scraped_content: content.substring(0, 40000)
    };
  } catch (err) {
    return { success: false, error: err.toString() };
  }
}

const custom_functions = {
  get_open_tabs,
  close_tabs,
  group_tabs_by_intent,
  summarize_inactive_tabs,
  ungroup_tabs,
  get_tab_last_accessed,
  summarize_group_tabs
};

// -----------------------------------------
// GEMINI TOOL SCHEMAS
// -----------------------------------------
const agentTools = [{
  functionDeclarations: [
    {
      name: "get_open_tabs",
      description: "Retrieves a list of all currently open tabs in the active window. Information includes ID, title, and URL.",
    },
    {
      name: "close_tabs",
      description: "Closes specific tabs based on their IDs. Useful for removing duplicates or irrelevant tabs.",
      parameters: {
        type: "OBJECT",
        properties: {
          tab_ids: { type: "ARRAY", items: { type: "NUMBER" }, description: "Array of tab IDs to close" }
        },
        required: ["tab_ids"]
      }
    },
    {
      name: "group_tabs_by_intent",
      description: "Groups a list of tabs together into a Chrome Tab Group with a specific intent/name.",
      parameters: {
        type: "OBJECT",
        properties: {
          intent_name: { type: "STRING", description: "The logical category or intent name for the group (e.g., 'Work', 'Social', 'Research')" },
          tab_ids: { type: "ARRAY", items: { type: "NUMBER" }, description: "Array of tab IDs to put into this group" }
        },
        required: ["intent_name", "tab_ids"]
      }
    },
    {
      name: "summarize_inactive_tabs",
      description: "Gets the data of inactive tabs so the agent can decide whether they should be grouped or closed.",
    },
    {
      name: "ungroup_tabs",
      description: "Removes specific tabs from their current group, making them separate standalone tabs without any grouping.",
      parameters: {
        type: "OBJECT",
        properties: {
          tab_ids: { type: "ARRAY", items: { type: "NUMBER" }, description: "Array of tab IDs to ungroup" }
        },
        required: ["tab_ids"]
      }
    },
    {
      name: "get_tab_last_accessed",
      description: "Gets the last time a specific tab was active or used. Use this when the user asks when they last used or accessed a certain tab.",
      parameters: {
        type: "OBJECT",
        properties: {
          tab_id: { type: "NUMBER", description: "The ID of the tab to check" }
        },
        required: ["tab_id"]
      }
    },
    {
      name: "summarize_group_tabs",
      description: "Extracts textual content from all tabs in a specific tab group so that you can generate a comprehensive summary of those tabs. Use this when the user asks you to summarize a group of tabs.",
      parameters: {
        type: "OBJECT",
        properties: {
          group_id: { type: "NUMBER", description: "The ID of the tab group to summarize." }
        },
        required: ["group_id"]
      }
    }
  ]
}];

const systemInstruction = {
  parts: [{ text: "You are TabZen AI, a specialized agent that organizes browser tabs. You have access to tools that can read open tabs, close duplicates, and group them into logic workspaces. When given a request, ALWAYS start by reading the open tabs using the get_open_tabs tool. After reviewing the tabs, formulate a plan to organize them. Group related tabs and strictly close any identical duplicates (same URL or highly similar). If there are existing groupings in the browser, give preference to those before creating 'new' groups. If the user asks to ungroup tabs, use the ungroup_tabs tool so that they are separate tabs without any groupings; do NOT create a new group called 'Ungrouped'. If the user asks for a summary of inactive tabs, use summarize_inactive_tabs. If the user asks when a specific tab was last used or active, use the get_tab_last_accessed tool to retrieve this information. If the user asks to summarize a group of tabs, use the summarize_group_tabs tool to extract the content, and then strictly generate a one-page Markdown summary of the key findings across all of them (ensure the summary is under 700-800 words). Explain your reasoning briefly before using tools. Stop using tools only when the user's task is fully complete." }]
};

// -----------------------------------------
// AGENT LOOP
// -----------------------------------------

async function runAgent(prompt, apiKey) {
  sendLog('AGENT_LOG', 'Starting agent loop...', 'system');

  // Explicit instruction: "Each time your Query stores 'ALL' past interaction"
  let conversationHistory = [];

  // Initial user prompt
  conversationHistory.push({
    role: 'user',
    parts: [{ text: prompt }]
  });

  let agentIsRunning = true;
  let loopCount = 0;
  const maxLoops = 10; // safety breaker

  while (agentIsRunning && loopCount < maxLoops) {
    loopCount++;

    // Call LLM
    try {
      const bodyPayload = JSON.stringify({
        systemInstruction: systemInstruction,
        contents: conversationHistory,
        tools: agentTools
      });

      let data;
      let usedModel = PRIMARY_MODEL;

      const makeRequest = async (modelName) => {
        const response = await fetch(`${getApiUrl(modelName)}?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyPayload
        });
        const resData = await response.json();
        if (resData.error) {
          throw new Error(resData.error.message);
        }
        return resData;
      };

      try {
        data = await makeRequest(PRIMARY_MODEL);
      } catch (primaryErr) {
        sendLog('AGENT_LOG', `Primary model error (${PRIMARY_MODEL}): ${primaryErr.message}. Retrying with fallback model...`, 'system');
        usedModel = FALLBACK_MODEL;
        data = await makeRequest(FALLBACK_MODEL);
      }

      const modelPart = data.candidates[0].content.parts[0];

      // Store the model's output in history
      conversationHistory.push({
        role: 'model',
        parts: data.candidates[0].content.parts
      });

      // Handle Text output (Thoughts/Reasoning)
      if (modelPart.text) {
        sendLog('AGENT_LOG', modelPart.text, 'thought');

        // If it's purely text and no function call, it means the agent finished its job
        if (data.candidates[0].content.parts.length === 1) {
          sendLog('AGENT_COMPLETE', modelPart.text, 'final-response');
          agentIsRunning = false;
          break;
        }
      }

      // Handle Function Calls
      const functionCallPart = data.candidates[0].content.parts.find(p => p.functionCall);
      if (functionCallPart) {
        const fnCall = functionCallPart.functionCall;
        const fnName = fnCall.name;
        const fnArgs = fnCall.args || {};

        sendLog('AGENT_LOG', `${fnName}(${JSON.stringify(fnArgs)})`, 'tool-call');

        // Execute tool
        let result;
        if (custom_functions[fnName]) {
          result = await custom_functions[fnName](fnArgs);
        } else {
          result = { error: `Function ${fnName} not found` };
        }

        sendLog('AGENT_LOG', JSON.stringify(result), 'tool-result');

        // Append tool result to history (the "Tool Result -> Query" part of the loop)
        conversationHistory.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: fnName,
              response: { result: result }
            }
          }]
        });
      }

    } catch (err) {
      sendLog('AGENT_ERROR', err.toString(), 'error-log');
      agentIsRunning = false;
    }
  }

  if (loopCount >= maxLoops) {
    sendLog('AGENT_ERROR', 'Agent reached maximum loop count (safety limit).', 'error-log');
  }
}

// -----------------------------------------
// MESSAGE LISTENER (Trigger from Popup)
// -----------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'RUN_AGENT') {
    chrome.storage.local.get(['geminiApiKey'], (result) => {
      if (result.geminiApiKey) {
        runAgent(message.payload, result.geminiApiKey);
      } else {
        sendLog('AGENT_ERROR', 'No API key provided', 'error-log');
      }
    });
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
});
