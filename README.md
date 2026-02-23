# OpenSwarm

A group chat for your AI agents. Connect OpenClaw, Gemini, OpenAI, or any OpenAI-compatible API — agents collaborate through @mentions with parallel execution, recursive nesting, and rich terminal output.

```bash
npm install -g openswarm-cli
openswarm init
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

---

## Setup (2 minutes)

### Step 1: Install

```bash
npm install -g openswarm-cli
```

Requires Node.js 20+.

### Step 2: Get a Gemini API key (free)

Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and create a key. It's free.

### Step 3: Create your swarm

```bash
mkdir my-swarm && cd my-swarm
openswarm init
```

The wizard asks how many agents you want, their names, and roles. Defaults work great — just press Enter through everything to get a 3-agent team (Master + Researcher + Coder) using Gemini.

### Step 4: Add your API key

```bash
echo GOOGLE_API_KEY=your-key-here > .env
```

Replace `your-key-here` with the key from Step 2.

### Step 5: Start chatting

```bash
openswarm
```

That's it. Ask a question and watch your agents collaborate.

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

### Key behaviors

- **Master streams live** — you see tokens as they arrive
- **Specialists run in parallel** — a status line shows who's thinking/streaming
- **Agents can @mention each other** — not just master → specialist, but researcher → coder too
- **Depth limit** — prevents infinite @mention loops (default: 3 levels)
- **Auto-generated prompts** — master gets delegation instructions, specialists get collaboration instructions, all based on your config. No prompt engineering needed
- **Tool visibility** — when agents use tools (web search, etc.), you see live spinners
- **Lazy connections** — agents only connect when first @mentioned
- **Max 20 mentions per message** — safety valve against runaway chains

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

## Slash Commands

| Command | What it does |
|---------|-------------|
| `/status` | Connection status for all agents |
| `/sessions` | List saved sessions with timestamps |
| `/export` | Export conversation to Markdown file |
| `/clear` | Clear terminal |
| `/quit` | Exit (also `/exit` or `Ctrl+C`) |

---

## Configuration

`openswarm init` generates `swarm.config.json` for you. Here's the full format if you want to edit it manually:

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
  "master": "master",
  "maxMentionDepth": 3,
  "timeout": 120000
}
```

### Agent fields

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | OpenAI-compatible chat completions endpoint |
| `label` | Yes | Display name in terminal |
| `color` | Yes | Terminal color (`indigo`, `green`, `amber`, `cyan`, `purple`, `red`, `blue`, `pink`) |
| `model` | No | Model name (e.g. `gemini-2.5-flash`, `gpt-4o`) |
| `token` | No | Auth token (Bearer header). Auto-filled from `.env` if not set |
| `systemPrompt` | No | Custom system prompt. Auto-generated if not set |

### Top-level fields

| Field | Default | Description |
|-------|---------|-------------|
| `master` | required | Which agent is the coordinator |
| `maxMentionDepth` | `3` | Max depth of recursive @mention chains |
| `timeout` | `120000` | Timeout per agent response in ms |
| `sessionPrefix` | `"openswarm"` | Prefix for session file names |

---

## .env File

OpenSwarm reads `.env` from the current directory automatically:

```bash
GOOGLE_API_KEY=your-gemini-key
OPENAI_API_KEY=sk-your-openai-key
```

Keys are injected into any agent that doesn't have its own `token` set in the config. Supports comments (`#`), `export` prefix, and quoted values.

---

## Compatible APIs

Works with anything that speaks the OpenAI chat completions format:

| Provider | URL | Model |
|----------|-----|-------|
| **Gemini** | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash` |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o` |
| **OpenClaw** | `http://localhost:18789/v1` | (agent's own model) |
| **Ollama** | `http://localhost:11434/v1` | `llama3` |
| **Any compatible** | `https://your-endpoint/v1` | your-model |

You can mix providers — master on Gemini, coder on OpenAI, researcher on a local Ollama. Each agent gets its own `url` and `model`.

---

## CLI Flags

```
openswarm [flags]
openswarm init
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--config <path>` | `-c` | `swarm.config.json` | Config file path |
| `--session <id>` | `-s` | — | Resume a saved session |
| `--verbose` | `-v` | `false` | Verbose output |

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
