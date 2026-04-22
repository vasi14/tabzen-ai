# TabZen AI - Smart Tab Manager

TabZen AI is an intelligent browser extension that helps you manage your tabs efficiently. It uses Google's Gemini AI to automatically organize your tabs, group related content, and summarize information, allowing you to focus on what matters.

## Features

- **Smart Tab Grouping**: Automatically groups related tabs based on their content and purpose.
- **Duplicate Detection**: Identifies and helps you close duplicate or redundant tabs.
- **Tab Summarization**: Generates concise summaries of your open tabs or specific groups.
- **Tab Information**: Provides details about when tabs were last accessed.
- **User Confirmation**: Requires your approval before performing destructive actions like closing tabs.

## Getting Started

### Prerequisites

- Google Chrome browser
- A Google Gemini API Key

### Installation

1. **Clone the repository** (or download the source code).
2. **Open Chrome** and navigate to `chrome://extensions`.
3. **Enable Developer mode** (toggle switch in the top-right corner).
4. Click **Load unpacked**.
5. Select the `tabzen-ai` folder you downloaded/cloned.

### Configuration

1. Open the extension's options page (click the puzzle piece icon in the toolbar, find TabZen AI, and click the gear icon).
2. Enter your **Google Gemini API Key**.
3. Click **Save**.

## Usage

### Quick Actions

- **Group Tabs**: Right-click on a tab and select "Group tabs with TabZen AI".
- **Close Duplicates**: Click the TabZen AI icon in the toolbar and select "Close Duplicate Tabs".
- **Summarize Tabs**: Click the TabZen AI icon and select "Summarize Tabs".

### Using the Chat Interface

1. Click the **TabZen AI icon** in the toolbar.
2. Type your request in the chat window.
3. The AI will read your tabs, plan an action, and ask for confirmation if needed.

## Development

### Running Locally

1. Ensure you have the extension loaded in developer mode (see Installation).
2. Open the **Developer Tools** (F12) in the extension's popup window or background page.
3. Check the **Console** for logs and debugging information.

### API Key Management

To change the API key, you need to update the `GEMINI_API_KEY` in the `background.js` file.

```javascript
const GEMINI_API_KEY = "YOUR_NEW_API_KEY";
```

## License

MIT