# OpenSwarm

A group chat for your AI agents. Works with almost any API OpenClaw supports — Gemini, OpenAI, Ollama, Groq, OpenClaw, or your own endpoint. Agents collaborate through @mentions with parallel execution, recursive nesting, and rich terminal output.

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

### Step 2: Run the wizard

```bash
mkdir my-swarm && cd my-swarm
openswarm init
```

The wizard asks you to pick a provider, then walks you through creating agents. Defaults work great — just press Enter to get a 3-agent team (Master + Researcher + Coder).

**Supported providers out of the box:**

| # | Provider | Free? | What you need |
|---|----------|-------|---------------|
| 1 | **Gemini** | Yes | API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| 2 | **OpenAI** | No | API key from [platform.openai.com](https://platform.openai.com) |
| 3 | **Ollama** | Yes | [Ollama](https://ollama.com) running locally |
| 4 | **Groq** | Yes (rate limited) | API key from [console.groq.com](https://console.groq.com) |
| 5 | **OpenClaw** | Yes | OpenClaw instance running locally |
| 6 | **Custom** | — | Any OpenAI-compatible endpoint |

### Step 3: Add your API key

```bash
echo YOUR_API_KEY_VAR=your-key-here > .env
```

The wizard tells you which env var to use for your provider. Examples:

```bash
# Gemini
echo GOOGLE_API_KEY=AIza... > .env

# OpenAI
echo OPENAI_API_KEY=sk-... > .env

# Groq
echo GROQ_API_KEY=gsk_... > .env
```

Ollama and local OpenClaw don't need a key.

### Step 4: Start chatting

```bash
openswarm
```

---

## Mix and Match Providers

Each agent gets its own `url` and `model`. You can mix providers freely — master on Gemini, coder on OpenAI, researcher on local Ollama:

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
    },
    "coder": {
      "url": "https://api.openai.com/v1",
      "label": "Coder",
      "color": "amber",
      "model": "gpt-4o"
    }
  },
  "master": "master"
}
```

OpenSwarm reads all `*_API_KEY` env vars from `.env` and injects them into any agent that doesn't have its own `token` set.

Supported env vars: `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, `TOGETHER_API_KEY`, `FIREWORKS_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `OPENCLAW_GATEWAY_TOKEN`.

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

### Agent fields

| Field | Required | Description |
|-------|----------|-------------|
| `url` | Yes | OpenAI-compatible chat completions endpoint |
| `label` | Yes | Display name in terminal |
| `color` | Yes | Terminal color (`indigo`, `green`, `amber`, `cyan`, `purple`, `red`, `blue`, `pink`) |
| `model` | No | Model name (e.g. `gemini-2.5-flash`, `gpt-4o`, `llama3`) |
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

## Compatible APIs

Works with anything that speaks the OpenAI chat completions format (`/v1/chat/completions`):

| Provider | URL | Model examples |
|----------|-----|----------------|
| **Gemini** | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash`, `gemini-2.5-pro` |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini` |
| **Ollama** | `http://localhost:11434/v1` | `llama3`, `mistral`, `codellama` |
| **Groq** | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile`, `mixtral-8x7b-32768` |
| **DeepSeek** | `https://api.deepseek.com/v1` | `deepseek-chat`, `deepseek-coder` |
| **Together** | `https://api.together.xyz/v1` | `meta-llama/Llama-3-70b-chat-hf` |
| **Fireworks** | `https://api.fireworks.ai/inference/v1` | `accounts/fireworks/models/llama-v3p1-70b-instruct` |
| **Mistral** | `https://api.mistral.ai/v1` | `mistral-large-latest` |
| **OpenClaw** | `http://localhost:18789/v1` | (agent's own model) |
| **OpenRouter** | `https://openrouter.ai/api/v1` | any model on OpenRouter |

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
