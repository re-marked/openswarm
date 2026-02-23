# OpenSwarm

Multi-agent @mention orchestrator CLI for [OpenClaw](https://openclaw.com).

Connect to real OpenClaw instances (or any other API), type a message, and watch agents collaborate through @mentions with rich colored terminal output.

```
you > Can you research the latest AI agent trends and build a demo?

● Master: Let me get my team on this.
@researcher can you look into the latest AI agent frameworks?
@coder can you build a quick demo CLI?

● Researcher: Here's what I found...

● Coder: Here's a quick implementation...

● Master: Based on the team's findings, here's the full picture...
```

## Quick Start

### 1. Start local OpenClaw agents

```bash
# Set your Google API key
export GOOGLE_API_KEY=your-key-here

# Start 3 OpenClaw instances + nginx proxy
docker compose -f examples/docker-compose.yml up
```

This starts:
- **Master** — coordinator who delegates via @mentions
- **Researcher** — web search and fact-finding
- **Coder** — code writing and debugging
- **Proxy** — nginx reverse proxy (required for Docker Desktop on Windows)

### 2. Run the CLI

```bash
npm install
npx tsx src/cli.ts -c examples/swarm.config.local.json
```

### 3. Or use Gemini directly (no Docker)

```bash
export GOOGLE_API_KEY=your-key-here
npx tsx src/cli.ts -c examples/swarm.config.gemini.json
```

## Architecture

```
User types message
  |
CLI sends to Master (HTTP chat completions)
  |
Master responds: "Let me ask @researcher about this..."
  |
Orchestrator detects @researcher
  |
Connects to Researcher -> sends message -> gets response
  |
Sends "[Thread] @researcher replied: ..." back to Master
  |
Master synthesizes -> displayed to user
```

Key features:
- **Sequential @mentions**: Agents are queried one at a time for clean terminal output
- **Lazy connections**: Specialist agents connect only when first @mentioned
- **Deduplication**: Same agent won't be @mentioned twice in one conversation
- **Depth limit**: Prevents infinite @mention loops (default: 3 rounds)
- **Markdown rendering**: Bold, italic, code blocks, headers rendered in terminal
- **Works with any OpenAI-compatible API**: OpenClaw, Gemini, OpenAI, etc.

## Config Reference

Create a config file (or use `-c path`):

```json
{
  "agents": {
    "master": {
      "url": "http://localhost:28789/v1",
      "token": "optional-auth-token",
      "label": "Master",
      "color": "indigo"
    },
    "researcher": {
      "url": "http://localhost:28790/v1",
      "label": "Researcher",
      "color": "green"
    }
  },
  "master": "master",
  "maxMentionDepth": 3,
  "sessionPrefix": "openswarm",
  "timeout": 120000
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agents` | object | required | Map of agent name to config |
| `agents.*.url` | string | required | Base URL for chat completions API |
| `agents.*.token` | string | -- | Optional auth token (Bearer) |
| `agents.*.label` | string | required | Display name in terminal |
| `agents.*.color` | string | required | Terminal color: indigo, green, amber, cyan, purple, red, blue, pink |
| `agents.*.model` | string | -- | Model name (for direct API use) |
| `agents.*.systemPrompt` | string | -- | System prompt (for direct API use) |
| `master` | string | required | Key of the master agent in the agents map |
| `maxMentionDepth` | number | 3 | Max rounds of @mention routing |
| `sessionPrefix` | string | "openswarm" | Prefix for session keys |
| `timeout` | number | 120000 | Timeout per agent turn (ms) |

## CLI Commands

| Command | Description |
|---------|-------------|
| `/quit` | Exit the CLI |
| `/status` | Show connection status for all agents |
| `/clear` | Clear the terminal |
| `Ctrl+C` | Graceful shutdown |

## Dependencies

| Package | Why |
|---------|-----|
| `chalk` v5 | Terminal colors (ESM-native) |
| `ora` v8 | Spinners (ESM-native) |

2 runtime deps. That's it.

## Changelog

- **threadId on thread events**: `thread_start`, `thread_message`, and `thread_end` events now carry a `threadId` string for correlating concurrent threads.
