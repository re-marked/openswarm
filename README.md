# OpenSwarm

Multi-agent @mention orchestrator CLI for [OpenClaw](https://openclaw.com).

Connect multiple AI agents (OpenClaw, Gemini, OpenAI, or any OpenAI-compatible API), type a message, and watch them collaborate through @mentions — with parallel execution, recursive nesting, tool visibility, session persistence, and rich terminal output.

```
npm install -g openswarm-cli
openswarm init
openswarm
```

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

## Install

```bash
npm install -g openswarm-cli
```

Requires Node.js 20+.

## Quick Start

### Option 1: Interactive setup (recommended)

```bash
# Create a project directory
mkdir my-swarm && cd my-swarm

# Run the setup wizard
openswarm init

# Add your API key
echo "GOOGLE_API_KEY=your-key-here" > .env

# Start chatting
openswarm
```

The wizard creates a `swarm.config.json` with your agents. By default it uses Gemini (free tier).

### Option 2: Manual config

Create `swarm.config.json`:

```json
{
  "agents": {
    "master": {
      "url": "https://generativelanguage.googleapis.com/v1beta/openai",
      "label": "Master",
      "color": "indigo",
      "model": "gemini-2.5-flash"
    },
    "researcher": {
      "url": "https://generativelanguage.googleapis.com/v1beta/openai",
      "label": "Researcher",
      "color": "green",
      "model": "gemini-2.5-flash"
    },
    "coder": {
      "url": "https://generativelanguage.googleapis.com/v1beta/openai",
      "label": "Coder",
      "color": "amber",
      "model": "gemini-2.5-flash"
    }
  },
  "master": "master"
}
```

Create `.env`:

```
GOOGLE_API_KEY=your-key-here
```

Run:

```bash
openswarm
```

### Option 3: Local OpenClaw agents

```bash
# Start OpenClaw instances + nginx proxy
docker compose -f examples/docker-compose.yml up

# Point to local agents
openswarm -c examples/swarm.config.local.json
```

## Features

### Parallel @mentions

When the master agent @mentions multiple specialists, they run in parallel. A live status line shows progress:

```
● Researcher: thinking...  ● Coder: streaming...
```

Results are collected and rendered in order once all agents finish.

### Deep nesting

Agents can @mention each other recursively — not just master → specialist. If the researcher needs code help, it can @mention the coder directly:

```
Master → @researcher "look into X"
  Researcher → @coder "implement Y"
    Coder responds
  Researcher synthesizes
Master synthesizes
```

Depth limit prevents infinite loops (default: 3 levels). Per-branch visited sets prevent cycles while allowing the same agent in different branches.

### Tool visibility

When agents use tools (web search, code execution, etc.), you see live spinners:

```
● Researcher: [web_search] searching...
```

### Auto-generated system prompts

You don't need to write system prompts. OpenSwarm auto-generates them based on your agent config:

- Master gets delegation instructions listing all team members
- Specialists get collaboration instructions with peer @mention syntax
- Custom `systemPrompt` in config overrides the auto-generated one

### Session persistence

Every conversation is auto-saved to `~/.openswarm/sessions/`. Resume any session:

```bash
# List past sessions
openswarm     # then type /sessions

# Resume a specific session
openswarm --session 20260223-abc123
```

Sessions save conversation histories so agents retain context when you resume.

### Markdown export

Export any conversation to a readable Markdown file:

```
/export
```

Writes `openswarm-{session-id}.md` to the current directory with agent responses, thread indicators, and tool usage.

### .env file support

OpenSwarm reads `.env` from the current directory automatically. Supports:

```bash
GOOGLE_API_KEY=your-key
OPENAI_API_KEY=sk-...
export SOME_VAR=value    # export prefix OK
KEY="quoted value"       # quotes stripped
# comments ignored
```

API keys from `.env` are injected into any agent that doesn't have its own `token` configured.

## CLI Reference

```
openswarm [options]
openswarm init
```

### Options

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--config <path>` | `-c` | `swarm.config.json` | Path to config file |
| `--session <id>` | `-s` | -- | Resume a saved session |
| `--verbose` | `-v` | `false` | Verbose output |

### Slash Commands

| Command | Description |
|---------|-------------|
| `/status` | Show connection status for all agents |
| `/sessions` | List saved sessions with timestamps |
| `/export` | Export conversation to Markdown |
| `/clear` | Clear the terminal |
| `/quit` | Exit (also `/exit` or Ctrl+C) |

## Config Reference

```json
{
  "agents": {
    "master": {
      "url": "https://generativelanguage.googleapis.com/v1beta/openai",
      "token": "optional-auth-token",
      "label": "Master",
      "color": "indigo",
      "model": "gemini-2.5-flash",
      "systemPrompt": "optional custom prompt"
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
| `agents` | object | required | Map of agent name → config |
| `agents.*.url` | string | required | Base URL for OpenAI-compatible chat completions API |
| `agents.*.token` | string | -- | Auth token (sent as Bearer header) |
| `agents.*.label` | string | required | Display name in terminal |
| `agents.*.color` | string | required | Terminal color: indigo, green, amber, cyan, purple, red, blue, pink |
| `agents.*.model` | string | -- | Model name (e.g. `gemini-2.5-flash`, `gpt-4o`) |
| `agents.*.systemPrompt` | string | auto | System prompt (auto-generated if not set) |
| `master` | string | required | Key of the coordinator agent |
| `maxMentionDepth` | number | 3 | Max depth of recursive @mention chains |
| `sessionPrefix` | string | `"openswarm"` | Prefix for session IDs |
| `timeout` | number | 120000 | Timeout per agent response (ms) |

## Compatible APIs

OpenSwarm works with any API that supports the OpenAI chat completions format:

| Provider | URL | Model example |
|----------|-----|---------------|
| Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| OpenClaw | `http://localhost:18789/v1` | -- (uses agent's configured model) |
| Any OpenAI-compatible | `https://your-endpoint/v1` | your-model |

## Architecture

```
User input
  │
  ▼
Master Agent (streams live)
  │
  ├── detects @mentions in response
  │
  ▼
Parallel: @researcher + @coder (buffered)
  │                        │
  ├── @coder (nested)      │
  │    └── responds         │
  ├── synthesizes           ▼
  │                     responds
  ▼
Master receives all results → synthesizes final answer
```

- **Master streams live** — you see tokens as they arrive
- **Mentioned agents buffer** — responses collected, then rendered in order (no interleaving)
- **Lazy connections** — agents connect only when first @mentioned
- **Connection dedup** — parallel mentions to the same agent share one connection attempt
- **Global safety valve** — max 20 total mentions per user message

## Development

```bash
git clone https://github.com/re-marked/openswarm.git
cd openswarm
npm install

# Dev mode (no build step)
npx tsx src/cli.ts

# Build
npm run build

# Type check
npm run type-check
```

## Dependencies

| Package | Why |
|---------|-----|
| `chalk` v5 | Terminal colors (ESM-native) |
| `ora` v8 | Spinners (ESM-native) |

2 runtime dependencies. That's it.

## License

MIT
