# swarm-cli

Multi-agent @mention orchestrator CLI for [OpenClaw](https://openclaw.com).

Connect to real OpenClaw instances, type a message, and watch agents collaborate through @mentions with rich colored terminal output.

```
you > Can you research the latest AI agent trends and build a demo?

Master ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Let me get my team on this. @researcher can you look into the latest
AI agent frameworks and trends? @coder can you build a quick demo CLI?

  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ┃ Thread: Master → @Researcher
  ┃
  ┃ Researcher
  ┃ Here's what I found...
  ┃
  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ┃ Thread: Master → @Coder
  ┃
  ┃ Coder
  ┃ Here's a quick implementation...
  ┃
  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Based on the team's findings, here's the full picture...
```

## Quick Start

### 1. Start local OpenClaw agents

```bash
docker compose -f examples/docker-compose.yml up
```

This starts 3 OpenClaw instances:
- **Master** (port 18789) — coordinator who delegates via @mentions
- **Researcher** (port 18790) — web search and fact-finding
- **Coder** (port 18791) — code writing and debugging

### 2. Run the CLI

```bash
# Install deps
npm install

# Run with the local config
npx tsx src/cli.ts -c examples/swarm.config.local.json
```

### 3. Chat

Type a message. The master agent will respond, and if it @mentions a specialist, the CLI will route the conversation automatically.

## Architecture

```
User types message
  ↓
CLI sends to Master (WebSocket)
  ↓
Master responds: "Let me ask @researcher about this..."
  ↓
Orchestrator detects @researcher
  ↓
Opens lazy WS to Researcher → sends message → gets real response
  ↓
Renders thread in terminal (colored, indented)
  ↓
Sends "[Thread] @researcher replied: ..." back to Master
  ↓
Master synthesizes → displayed to user
```

Key features:
- **Parallel @mentions**: Multiple agents are queried simultaneously
- **Lazy connections**: Specialist agents connect only when first @mentioned
- **Deduplication**: Same agent won't be @mentioned twice in one conversation
- **Depth limit**: Prevents infinite @mention loops (default: 3 rounds)
- **Long-lived connections**: WebSocket connections persist across messages

## Config Reference

Create a `swarm.config.json` (or use `-c path`):

```json
{
  "agents": {
    "master": {
      "url": "ws://localhost:18789",
      "token": "optional-auth-token",
      "label": "Master",
      "color": "indigo"
    },
    "researcher": {
      "url": "ws://localhost:18790",
      "label": "Researcher",
      "color": "green"
    }
  },
  "master": "master",
  "maxMentionDepth": 3,
  "sessionPrefix": "swarm",
  "timeout": 120000
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agents` | object | required | Map of agent name → config |
| `agents.*.url` | string | required | WebSocket URL (`ws://` or `wss://`) |
| `agents.*.token` | string | — | Optional auth token |
| `agents.*.label` | string | required | Display name in terminal |
| `agents.*.color` | string | required | Terminal color: indigo, green, amber, cyan, purple, red, blue, pink |
| `master` | string | required | Key of the master agent in the agents map |
| `maxMentionDepth` | number | 3 | Max rounds of @mention routing |
| `sessionPrefix` | string | "swarm" | Prefix for session keys |
| `timeout` | number | 120000 | Timeout per agent turn (ms) |

## Remote Agents

Works with Fly.io-deployed agents too:

```json
{
  "agents": {
    "master": {
      "url": "wss://my-master-agent.fly.dev",
      "token": "my-gateway-token",
      "label": "Master",
      "color": "indigo"
    }
  }
}
```

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
| `ws` | WebSocket client for OpenClaw protocol |
| `chalk` v5 | Terminal colors (ESM-native) |
| `ora` v8 | Spinners (ESM-native) |

3 runtime deps. That's it.
