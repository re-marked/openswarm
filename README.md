# OpenSwarm

A group chat for your AI agents. Works with almost any API OpenClaw supports — Anhtropic, Gemini, OpenAI, DeepSeek, Ollama, Groq, or your own endpoint. Agents collaborate through @mentions with parallel execution, recursive nesting, and rich terminal output.

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

Each agent is a full OpenClaw instance with its own personality (SOUL.md), tools, and skills.
Whatever model or provider you've configured in OpenClaw — Gemini, OpenAI, Anthropic, Ollama,
or anything else — OpenSwarm uses it automatically.

---

## Setup

### Step 1: Install

```bash
npm install -g openswarm-cli
```

Requires Node.js 20+ and [OpenClaw](https://github.com/nicepkg/openclaw) installed (`npm install -g openclaw`).

### Step 2: Initialize

```bash
mkdir my-swarm && cd my-swarm
openswarm init
```

The wizard asks how many agents, their names, colors, and one-sentence roles.
No model or API key questions — that's OpenClaw's domain.

<<<<<<< HEAD
**Supported providers out of the box:**

| # | Provider | Free? | What you need |
|---|----------|-------|---------------|
| 1 | **Gemini** | Yes | API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| 2 | **Anthropic** | No | API key from [platform.claude.com](https://platform.claude.com) |
| 3 | **OpenAI** | No | API key from [platform.openai.com](https://platform.openai.com) |
| 4 | **Ollama** | Yes | [Ollama](https://ollama.com) running locally |
| 5 | **Groq** | Yes (rate limited) | API key from [console.groq.com](https://console.groq.com) |
| 7 | **Custom** | — | Any compatible endpoint |

### Step 3: Add your API key

```bash
echo YOUR_API_KEY_VAR=your-key-here > .env
=======
Creates:
```
agents/
  master/
    openclaw.json           # Gateway config
    workspace/
      SOUL.md               # Personality + @mention instructions
      AGENTS.md             # Workspace rules
  researcher/
    openclaw.json
    workspace/
      SOUL.md
      AGENTS.md
  coder/
    openclaw.json
    workspace/
      SOUL.md
      AGENTS.md
swarm.config.json           # Workspace paths + labels + colors
>>>>>>> 3931be1 (docs: rewrite README with OpenClaw-first narrative)
```

### Step 3: Configure your agents

Each agent needs a model configured via OpenClaw:

```bash
# Option A: Log in with your OpenClaw account
cd agents/master && openclaw login

# Option B: Edit openclaw.json directly
# Add to agents/master/openclaw.json:
#   "agents": { "defaults": { "model": { "primary": "openai/gpt-4o" } } }

# Option C: Use any provider — Gemini, Anthropic, Ollama, etc.
# See OpenClaw docs for provider configuration
```

### Step 4: Start chatting

```bash
openswarm
```

OpenSwarm spawns an OpenClaw gateway for each agent, waits for them to start,
then drops you into a group chat REPL.

---

## How It Works

You type a message. The master agent reads it and decides which specialists to
@mention. Mentioned agents run **in parallel**, respond, and the master
synthesizes everything into a final answer.

```
You
 └─→ Master (streams live to your terminal)
      ├─→ @researcher (runs in parallel)  ─→ responds
      └─→ @coder (runs in parallel)       ─→ responds
           └─→ @researcher (nested!)      ─→ responds
      Master receives all results → final answer
```

### Key behaviors

- **Master streams live** — you see tokens as they arrive
- **Specialists run in parallel** — a status line shows who's thinking/streaming
- **Agents can @mention each other** — researcher → coder, coder → analyst, etc.
- **Depth limit** — prevents infinite @mention loops (default: 3 levels)
- **Tool visibility** — when agents use tools (web search, exec, etc.), you see live spinners
- **Lazy connections** — agents only connect when first @mentioned
- **Max 20 mentions per message** — safety valve against runaway chains

---

## CLI Commands

```
openswarm              # Start group chat (spawns agents automatically)
openswarm init         # Create a new swarm
openswarm up           # Spawn agents in background
openswarm down         # Stop background agents
```

### Flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--config <path>` | `-c` | `swarm.config.json` | Config file path |
| `--session <id>` | `-s` | — | Resume a saved session |
| `--verbose` | `-v` | `false` | Verbose output |

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

# Resume a session (agents remember the full conversation)
openswarm --session 20260223-abc123

# Export to Markdown
/export
```

---

## Configuration

### OpenClaw mode (primary)

Each agent points to an OpenClaw workspace directory:

```json
{
  "agents": {
    "master": {
      "workspace": "./agents/master",
      "label": "Master",
      "color": "indigo"
    },
    "researcher": {
      "workspace": "./agents/researcher",
      "label": "Researcher",
      "color": "green"
    },
    "coder": {
      "workspace": "./agents/coder",
      "label": "Coder",
      "color": "amber"
    }
  },
  "master": "master"
}
```

No URL, model, token, or systemPrompt needed — OpenClaw handles all of that
inside the workspace via `openclaw.json` and `SOUL.md`.

### Direct API mode (backwards compatible)

If an agent has `url` instead of `workspace`, it works as a direct API connection
without OpenClaw:

```json
{
  "agents": {
    "quick": {
      "url": "https://generativelanguage.googleapis.com/v1beta/openai",
      "model": "gemini-2.5-flash",
      "label": "Quick",
      "color": "cyan"
    }
  },
  "master": "quick"
}
```

You can mix modes — some agents as OpenClaw workspaces, others as direct API.

### Agent fields

| Field | Mode | Description |
|-------|------|-------------|
| `workspace` | OpenClaw | Path to OpenClaw workspace dir |
| `url` | Direct API | OpenAI-compatible endpoint |
| `label` | Both | Display name in terminal |
| `color` | Both | Terminal color (`indigo`, `green`, `amber`, `cyan`, `purple`, `red`, `blue`, `pink`) |
| `model` | Direct API | Model name |
| `token` | Direct API | Auth token (auto-filled from `.env`) |
| `systemPrompt` | Direct API | Custom system prompt |

### Top-level fields

| Field | Default | Description |
|-------|---------|-------------|
| `master` | required | Which agent coordinates |
| `maxMentionDepth` | `3` | Max depth of recursive @mention chains |
| `timeout` | `120000` | Timeout per agent response in ms |
| `sessionPrefix` | `"openswarm"` | Prefix for session file names |

---

## Advanced: Direct API Mode

For lightweight use without OpenClaw installed, you can point agents directly at
any OpenAI-compatible API:

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
      "url": "http://localhost:11434/v1",
      "label": "Researcher",
      "color": "green",
      "model": "llama3"
    }
  },
  "master": "master"
}
```

Add your API key to `.env`:

```bash
echo GOOGLE_API_KEY=AIza... > .env
```

Supported env vars: `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`,
`ANTHROPIC_API_KEY`, `TOGETHER_API_KEY`, `FIREWORKS_API_KEY`, `DEEPSEEK_API_KEY`,
`MISTRAL_API_KEY`, `OPENCLAW_GATEWAY_TOKEN`.

---

## Development

```bash
git clone https://github.com/re-marked/openswarm.git
cd openswarm
npm install

# Dev mode (TypeScript, no build step)
npx tsx src/cli.ts

# Build
npm run build

# Type check
npm run type-check
```

2 runtime dependencies: `chalk` (colors) and `ora` (spinners). That's it.

---

## License

MIT
