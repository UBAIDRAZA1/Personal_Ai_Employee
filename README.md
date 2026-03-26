# Personal AI Employee

An autonomous AI employee system that integrates with WhatsApp and file systems to perform tasks, send emails, and manage approvals.

## Features

- **WhatsApp Integration** - Receive and respond to tasks via WhatsApp
- **File System Watcher** - Monitor vault directories for task files
- **Approval System** - Manage task approvals before execution
- **Email Capabilities** - Send emails autonomously
- **AI-Powered** - Uses Gemini AI for intelligent task processing

## Project Structure

```
personal-ai-employee/
├── AI_Employee_Vault/     # Task storage and management
│   ├── Inbox/            # New tasks
│   ├── Needs_Action/     # Tasks requiring attention
│   ├── Done/             # Completed tasks
│   ├── Logs/             # Activity logs
│   ├── Plans/            # Task plans
│   ├── Pending_Approval/ # Awaiting approval
│   └── Approved/         # Approved tasks
├── mcp_servers/          # MCP server implementations
├── watchers/             # File and message watchers
├── utils/                # Utility functions
└── .env                  # Environment configuration
```

## Setup

### Prerequisites

- Node.js 18+
- npm

### Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env`:
```
GEMINI_API_KEY=your_api_key_here
```

3. Create vault directories:
```bash
node create_vault_subdirs.js
node create_new_vault_subdirs.js
```

## Usage

### Start All Services

```bash
npm start
```

This runs:
- WhatsApp MCP Server
- File System Watcher
- Approval Watcher
- WhatsApp Auto Responder

### Individual Services

```bash
# WhatsApp MCP Server
npm run whatsapp-mcp

# File System Watcher
npm run file-system-watcher

# Approval Watcher
npm run approval-watcher

# WhatsApp Auto Responder
npm run whatsapp-auto-responder
```

## How It Works

1. **Task Input**: Send a WhatsApp message or create a task file in `AI_Employee_Vault/Inbox/`
2. **Task Processing**: The system reads and processes the task using AI
3. **Approval**: Tasks requiring approval are placed in `Pending_Approval/`
4. **Execution**: Approved tasks are executed and results are logged
5. **Completion**: Completed tasks are moved to `Done/`

## Task File Format

```markdown
---
to: recipient@example.com
subject: Task Subject
keyword: task-keyword
---
# Task Description

Details about what needs to be done.
```

## License

MIT


# Run Command
C:\Users\Administrator\Desktop\Hackathon 0>
     node watchers/fileSystemWatcher.js

     node mcp_servers\email_mcp.js

     node "C:\Users\Administrator\Desktop\Hackathon 0\watchers\approvalWatcher.js"

     node mcp_servers/whatsapp_mcp.js

     node utils/dashboardUpdater.js

     type "C:\Users\Administrator\Desktop\Hackathon 0\AI_Employee_Vault\Dashboard.md"

C:\Users\Administrator\Desktop\Hackathon 0\watchers>
     node whatsappWatcher.js


Weekly briefing generate karne ke liye:

      cd "C:\Users\Administrator\Desktop\Hackathon 0"
      node utils/briefingGenerator.js --force

  Phir check karein ke kya Briefings folder ban gaya:

     dir "C:\Users\Administrator\Desktop\Hackathon 0\AI_Employee_Vault\Briefings\"
"# Personal_Ai_Employee" 
