# Claude Code - Source Code (Publicly Exposed via npm)

> **LEGAL DISCLAIMER:** This repository is provided strictly for **educational, research, and security analysis purposes** under the principles of **fair use** and **public interest**. See [Legal Notice](#legal-notice) below.

---

## Legal Notice

### Fair Use & Public Interest Justification

This source code was **not obtained through hacking, reverse engineering, or unauthorized access**. It was publicly and freely accessible to anyone via Anthropic's official npm registry due to an accidental inclusion of source map files in a published package. The code was:

1. **Published publicly** by Anthropic themselves (unintentionally) on the npm registry, a public package repository
2. **Freely downloadable** by anyone running `npm install` — no authentication, credentials, or circumvention of any access controls was required
3. **Extracted from source maps** — a standard, well-documented build artifact — using publicly available, legitimate tooling
4. **Already widely distributed** across the internet before this repository was created

### Legal Basis

- **No circumvention of access controls:** The source maps were shipped inside a publicly available npm package. No passwords, encryption, DRM, or access restrictions were bypassed. This means the **CFAA (Computer Fraud and Abuse Act)** and **DMCA anti-circumvention (Section 1201)** provisions are unlikely to apply.
- **No Terms of Service violation:** Downloading a public npm package and inspecting its contents is standard, expected behavior within the npm ecosystem.
- **Fair use (17 U.S.C. Section 107):** This repository is shared for purposes of security research, education, commentary, and analysis — all of which are favored under fair use doctrine. The purpose is non-commercial and transformative (analysis/research, not competing with Claude Code).
- **Public interest:** Understanding how AI coding tools operate, what data they access, and how their permission/safety systems work is a matter of significant public interest, particularly for security researchers and the developer community.
- **First Amendment protections:** Publishing and discussing publicly available code is protected speech, particularly when done for research and commentary purposes.

### DMCA / Takedown

If Anthropic or their legal representatives wish to request removal of this repository, they may file a **DMCA takedown request** through GitHub's standard process. This repository will comply with valid legal requests. Contact: file via [GitHub's DMCA process](https://docs.github.com/en/site-policy/content-removal-policies/dmca-takedown-policy).

### What This Repository Is NOT

- This is **NOT** a tool for piracy or commercial exploitation
- This is **NOT** intended to harm Anthropic or compete with their products
- This is **NOT** obtained through any illegal means
- This repository does **NOT** contain API keys, secrets, credentials, or any private user data

### Precedent

Accidental source code exposure via source maps, debug artifacts, or misconfigured deployments is a well-documented phenomenon. Similar incidents have occurred with major companies (e.g., Twitch, Samsung, Nintendo), and the security research community has consistently engaged in analysis of such leaks for public benefit without legal repercussion, provided no access controls were circumvented.

---

## How This Was Exposed

On **March 31, 2026**, security researcher **[Chaofan Shou (@Fried_rice)](https://twitter.com/Fried_rice)** discovered that the full Claude Code source code was exposed via a **source map file** (`.map`) left in Anthropic's **npm registry** package. Source maps are debug artifacts that map minified/bundled code back to original source — Anthropic accidentally shipped one in their published npm package, allowing anyone to reconstruct the entire original TypeScript codebase.

The extracted source was published as a zip file and shared publicly on Twitter/X.

## What Is Claude Code?

Claude Code is Anthropic's AI-powered coding assistant that runs as:
- A **CLI tool** in the terminal
- A **VS Code extension**
- A **JetBrains plugin**
- A **desktop app** (Mac/Windows)
- A **web app** (claude.ai/code)

It allows developers to interact with Claude directly in their development environment — Claude can read files, write code, run shell commands, search codebases, and perform complex multi-step software engineering tasks autonomously.

## Can This Be Switched to OpenAI Models?

**Short answer:** now **yes, experimentally**. The codebase is still largely Anthropic-shaped, but it can now be routed through OpenAI's Chat Completions API by enabling the OpenAI provider flag.

### How to enable it

Set these environment variables before launching the app:

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=your_api_key_here
export OPENAI_MODEL=gpt-4.1 # optional, defaults to gpt-4.1
```

### What changed

- **Provider selection now includes OpenAI**: `utils/model/providers.ts` recognizes `CLAUDE_CODE_USE_OPENAI=1`.
- **Model defaults can resolve to OpenAI models**: `utils/model/model.ts`, `utils/model/configs.ts`, and `utils/model/modelOptions.ts` now expose OpenAI-backed defaults such as `gpt-4.1` and `gpt-4.1-mini`.
- **The API client can adapt OpenAI responses into Anthropic-style events**: `services/api/client.ts` uses `services/api/openaiAdapter.ts` to translate OpenAI chat completions into the event/message shape the rest of the app already expects.

### Current limitations

This is still a compatibility layer, so some Claude-specific behaviors remain imperfect:

1. Claude-branded prompts and labels still exist in parts of the UI
2. advanced Anthropic-only beta features do not have OpenAI parity
3. the adapter currently targets the OpenAI Chat Completions API, not every OpenAI API surface

## Repository Stats

- **~1,900 TypeScript files**
- **~513,000 lines of code**
- Full client-side implementation — CLI, UI, tools, agent system, and more

## Architecture Overview

### Core Engine

| Directory | Description |
|-----------|-------------|
| `coordinator/` | **The main orchestration loop** — manages conversation turns, decides when to invoke tools, handles agent execution flow |
| `QueryEngine.ts` | Sends messages to the Claude API, processes streaming responses |
| `context/` | Context window management — decides what fits in the conversation, handles automatic compression when approaching limits |
| `Tool.ts` / `tools.ts` | Tool registration, dispatch, and base tool interface |

### Tools (The Core Power of Claude Code)

Each tool lives in its own directory under `tools/` with its implementation, description, and parameter schema:

| Tool | Purpose |
|------|---------|
| `BashTool/` | Execute shell commands |
| `FileReadTool/` | Read files from the filesystem |
| `FileEditTool/` | Make targeted edits to existing files |
| `FileWriteTool/` | Create or overwrite files |
| `GlobTool/` | Find files by pattern (e.g., `**/*.ts`) |
| `GrepTool/` | Search file contents with regex |
| `AgentTool/` | Spawn autonomous sub-agents for complex tasks |
| `WebSearchTool/` | Search the web |
| `WebFetchTool/` | Fetch content from URLs |
| `NotebookEditTool/` | Edit Jupyter notebooks |
| `TodoWriteTool/` | Track task progress |
| `ToolSearchTool/` | Dynamically discover deferred tools |
| `MCPTool/` | Call Model Context Protocol servers |
| `LSPTool/` | Language Server Protocol integration |
| `TaskCreateTool/` | Create background tasks |
| `EnterPlanModeTool/` | Switch to planning mode |
| `SkillTool/` | Execute reusable skill prompts |
| `SendMessageTool/` | Send messages to running sub-agents |

### Terminal UI (Custom Ink-based Renderer)

| Directory | Description |
|-----------|-------------|
| `ink/` | **Custom terminal rendering engine** built on Ink/React with Yoga layout. Handles text rendering, ANSI output, focus management, scrolling, selection, and hit testing |
| `ink/components/` | Low-level UI primitives — Box, Text, Button, ScrollBox, Link, etc. |
| `ink/hooks/` | React hooks for input handling, animation, terminal state |
| `ink/layout/` | Yoga-based flexbox layout engine for the terminal |
| `components/` | Higher-level UI — message display, diff views, prompt input, settings, permissions dialogs, spinners |
| `components/PromptInput/` | The input box where users type |
| `components/messages/` | How assistant/user messages render |
| `components/StructuredDiff/` | Rich diff display for file changes |
| `screens/` | Full-screen views |

### Slash Commands

The `commands/` directory contains **80+ slash commands**, each in its own folder:

- `/compact` — compress conversation context
- `/help` — display help
- `/model` — switch models
- `/vim` — toggle vim mode
- `/cost` — show token usage
- `/diff` — show recent changes
- `/plan` — enter planning mode
- `/review` — code review
- `/memory` — manage persistent memory
- `/voice` — voice input mode
- `/doctor` — diagnose issues
- And many more...

### Services

| Directory | Description |
|-----------|-------------|
| `services/api/` | Anthropic API client and communication |
| `services/mcp/` | MCP (Model Context Protocol) server management |
| `services/lsp/` | Language Server Protocol client for code intelligence |
| `services/compact/` | Conversation compaction/summarization |
| `services/oauth/` | OAuth authentication flow |
| `services/analytics/` | Usage analytics and telemetry |
| `services/extractMemories/` | Automatic memory extraction from conversations |
| `services/plugins/` | Plugin loading and management |
| `services/tips/` | Contextual tips system |

### Permissions & Safety

| Directory | Description |
|-----------|-------------|
| `hooks/toolPermission/` | Permission checking before tool execution |
| `utils/permissions/` | Permission rules and policies |
| `utils/sandbox/` | Sandboxing for command execution |
| `services/policyLimits/` | Rate limiting and policy enforcement |
| `services/remoteManagedSettings/` | Remote settings management for teams |

### Agent System

| Directory | Description |
|-----------|-------------|
| `tools/AgentTool/` | Sub-agent spawning — launches specialized agents for complex tasks |
| `tasks/LocalAgentTask/` | Runs agents locally as sub-processes |
| `tasks/RemoteAgentTask/` | Runs agents on remote infrastructure |
| `tasks/LocalShellTask/` | Shell-based task execution |
| `services/AgentSummary/` | Summarizes agent work |

### Persistence & State

| Directory | Description |
|-----------|-------------|
| `state/` | Application state management |
| `utils/settings/` | User and project settings (settings.json) |
| `memdir/` | Persistent memory directory system |
| `utils/memory/` | Memory read/write utilities |
| `migrations/` | Data format migrations |
| `keybindings/` | Keyboard shortcut configuration |

### Skills & Plugins

| Directory | Description |
|-----------|-------------|
| `skills/` | Skill system — reusable prompt templates (e.g., `/commit`, `/review-pr`) |
| `plugins/` | Plugin architecture for extending functionality |
| `services/plugins/` | Plugin loading, validation, and lifecycle |

### Other Notable Directories

| Directory | Description |
|-----------|-------------|
| `bridge/` | Bridge for desktop/web app communication (session management, JWT auth, polling) |
| `remote/` | Remote execution support |
| `server/` | Server mode for programmatic access |
| `entrypoints/` | App entry points (CLI, SDK) |
| `vim/` | Full vim emulation (motions, operators, text objects) |
| `voice/` | Voice input support |
| `buddy/` | Companion sprite system (fun feature) |
| `cli/` | CLI argument parsing and transport layer |
| `native-ts/` | Native module bindings (color-diff, file-index, yoga-layout) |
| `schemas/` | JSON schemas for configuration |
| `types/` | TypeScript type definitions |

### Key Entry Points

- **`main.tsx`** — Application entry point, bootstraps the Ink-based terminal UI
- **`coordinator/coordinatorMode.ts`** — The core conversation loop
- **`QueryEngine.ts`** — API query engine
- **`tools.ts`** — Tool registry
- **`context.ts`** — Context management
- **`commands.ts`** — Command registry

## Notable Implementation Details

- **Built with TypeScript** and React (via Ink for terminal rendering)
- **Yoga layout engine** for flexbox-style terminal UI
- **Custom vim emulation** with full motion/operator/text-object support
- **MCP (Model Context Protocol)** support for connecting external tool servers
- **LSP integration** for code intelligence features
- **Plugin system** for community extensions
- **Persistent memory** system across conversations
- **Sub-agent architecture** for parallelizing complex tasks
- **Source map file** in npm package is what led to this leak

## Intellectual Property Notice

This source code is the intellectual property of **Anthropic, PBC**. It was not intentionally open-sourced. Anthropic retains all rights, including copyright, over this code.

This repository does not claim any ownership or license over the code. It is shared solely under fair use principles for:
- **Security research** — understanding AI tool safety mechanisms
- **Education** — studying large-scale TypeScript/AI application architecture
- **Public interest** — transparency into how AI coding assistants operate

**If you are Anthropic or represent Anthropic:** Please see the [DMCA / Takedown](#dmca--takedown) section above. This repository will promptly comply with valid takedown requests.

**If you are a user of this code:** Do not use this code for commercial purposes, to build competing products, or in any way that infringes on Anthropic's intellectual property rights. This code is for reading, learning, and research only.
