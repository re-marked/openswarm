# OpenSwarm

A group chat for your AI agents. Works with almost any API OpenClaw supports — Anthropic, Gemini, OpenAI, DeepSeek, Ollama, Groq, or your own endpoint. Agents collaborate through @mentions with parallel execution, recursive nesting, and self-replication.

```bash
npm install -g openswarm-cli
openswarm init
openswarm
```

---

## Demo

```
you > Research AI agent trends and build a demo

● Master: Let me get my team on this.
  @researcher look into the latest AI agent frameworks
  @coder build a quick demo CLI

  ● Researcher: thinking...  ● Coder: thinking...

● Researcher: Here's what I found...

● Coder: Here's an implementation...

● Master: Based on the team's findings, here's the full picture...
```

Each agent is a full OpenClaw instance with its own personality (SOUL.md), tools, and skills. Whatever model or provider you've configured in OpenClaw — Gemini, OpenAI, Anthropic, Ollama, or anything else — OpenSwarm uses it automatically.

---

## Features

### 🔍 Zero-Config Discovery
OpenSwarm automatically discovers running OpenClaw gateways on your machine. No manual port configuration needed.

### 🧬 Self-Replicating Agents
Agents can @mention ANY name to spawn a new specialist on-the-fly. If @philosopher doesn't exist yet, it gets created automatically with the master's model and gateway.

### ⚡ Parallel Execution
Multiple agents work simultaneously. When master @mentions three specialists, all three run at once.

### 🔁 Recursive Nesting
Agents can @mention other agents, who can @mention more agents (depth-limited to prevent loops).

### 🎨 Rich Terminal UI
- Live streaming from all agents
- Status indicators (thinking/streaming/tool use)
- Color-coded agents
- Tool use visibility

---

## Setup

### Step 1: Install

```bash
npm install -g openswarm-cli
```

Requires Node.js 20+ and [OpenClaw](https://github.com/nicepkg/openclaw) installed (`npm install -g openclaw`).

### Step 2: Start OpenClaw

OpenSwarm needs at least one OpenClaw gateway running:

```bash
openclaw gateway run
```

Or if you already have OpenClaw running with your normal workflow, you're good to go.

### Step 3: Initialize your swarm

```bash
mkdir my-swarm && cd my-swarm
openswarm init
```

The init wizard will:
1. Discover running OpenClaw gateways
2. Ask which one to use as the master
3. Create a `swarm.config.json` with your settings

### Step 4: Start chatting

```bash
openswarm
```

---

## How It Works

You type a message. The master agent reads it and decides which specialists to @mention. Mentioned agents run **in parallel**, respond, and the master synthesizes everything into a final answer.

```
You
 └─→ Master (streams live to your terminal)
      ├─→ @researcher (runs in parallel)  ─→ responds
      └─→ @coder (runs in parallel)       ─→ responds
           └─→ @researcher (nested!)      ─→ responds
      Master receives all results → final answer
```

### Key Behaviors

- **Zero-config discovery** — finds OpenClaw gateways automatically
- **Master streams live** — you see tokens as they arrive
- **Specialists run in parallel** — status line shows who's thinking/streaming
- **Self-replication** — @mention any name to spawn a new agent
- **Agents can @mention each other** — researcher → coder, coder → analyst, etc.
- **Depth limit** — prevents infinite @mention loops (default: 3 levels)
- **Tool visibility** — when agents use tools (web search, exec, etc.), you see live spinners
- **Lazy connections** — agents only connect when first @mentioned
- **Max 20 mentions per message** — safety valve against runaway chains

---

## CLI Commands

```bash
openswarm              # Start group chat
openswarm init         # Create a new swarm
openswarm --config <path>  # Use custom config file
openswarm --session <id>   # Resume a saved session
```

### Slash Commands (in chat)

| Command | What it does |
|---------|-------------|
| `/status` | Connection status for all agents |
| `/sessions` | List saved sessions with timestamps |
| `/export` | Export conversation to Markdown file |
| `/clear` | Clear terminal |
| `/quit` | Exit (also `/exit` or `Ctrl+C`) |

---

## Session Management

Every conversation auto-saves to `~/.openswarm/sessions/`.

```bash
# Inside the chat, list past sessions
/sessions

# Resume a session
openswarm --session 20260223-abc123

# Export to Markdown
/export
```

---

## Configuration

### Basic config

```json
{
  "agents": {
    "master": {
      "url": "http://localhost:18789/v1",
      "token": "your-gateway-token",
      "label": "Master",
      "color": "indigo"
    }
  },
  "master": "master",
  "maxMentionDepth": 3,
  "sessionPrefix": "openswarm",
  "timeout": 120000
}
```

### Agent fields

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes* | OpenClaw gateway endpoint (e.g., `http://localhost:18789/v1`) |
| `port` | Yes* | Port number (alternative to `url`) |
| `token` | No | Gateway auth token (auto-filled from `~/.openclaw/openclaw.json`) |
| `label` | Yes | Display name in terminal |
| `color` | Yes | Terminal color (`indigo`, `green`, `amber`, `cyan`, `purple`, `red`, `blue`, `pink`) |

*Either `url` or `port` is required.

### Top-level fields

| Field | Default | Description |
|-------|---------|-------------|
| `master` | required | Which agent coordinates the swarm |
| `maxMentionDepth` | `3` | Max depth of recursive @mention chains |
| `timeout` | `120000` | Timeout per agent response (ms) |
| `sessionPrefix` | `"openswarm"` | Prefix for session file names |

---

## Self-Replication

The master agent's system prompt tells it that it can @mention ANY name to create a new specialist on-the-fly.

When master writes `@philosopher explain Plato's cave`, and "philosopher" doesn't exist yet:

1. Orchestrator auto-creates it using master's gateway (same port/token/model)
2. Assigns a capitalized label ("Philosopher") and cycling color
3. Builds a swarm-identity system prompt with team roster
4. Fires `agent_spawned` event → renderer shows `◆ Spawned Philosopher (@philosopher)`
5. Saves updated `swarm.config.json` to disk (persists across sessions)
6. Connects and routes the message

Spawned agents can themselves @mention new agents (recursive replication, capped by `maxMentionDepth` and the 20-mention safety valve).

---

## Development

```bash
git clone https://github.com/re-marked/openswarm.git
cd openswarm
npm install

# Dev mode (TypeScript, no build step)
npm run dev

# Or with tsx directly
npx tsx src/cli.ts

# Build
npm run build

# Type check
npm run type-check
```

---

## License

MIT
