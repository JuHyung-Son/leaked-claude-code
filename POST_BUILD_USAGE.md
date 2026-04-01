# Post-build Usage Guide

This document covers how to use Claude Code **after it has already been built or installed**.

The repository snapshot does not include a single top-level build guide, so this page focuses on the commands that can be verified directly from the CLI entrypoints in the source tree.

## Basic launch

Start an interactive session:

```bash
claude
```

Start an interactive session with an initial prompt:

```bash
claude "summarize this repository"
```

Show CLI help:

```bash
claude --help
```

Show the current version:

```bash
claude --version
```

## Non-interactive mode

Print a response and exit:

```bash
claude -p "explain what this project does"
```

Useful print-mode options:

```bash
claude -p "generate a changelog summary" --output-format text
claude -p "return JSON" --output-format json
claude -p "stream the answer" --output-format stream-json
```

## Continue or resume a session

Continue the most recent conversation in the current directory:

```bash
claude -c
```

Resume a session by ID:

```bash
claude -r <session-id>
```

Open the interactive resume picker:

```bash
claude -r
```

## Authentication

Log in:

```bash
claude auth login
```

Show authentication status:

```bash
claude auth status
claude auth status --text
```

Log out:

```bash
claude auth logout
```

## OpenAI-backed usage

If you want to route the compatibility layer through OpenAI, set the environment variables **before launching** the CLI:

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=your_api_key_here
export OPENAI_MODEL=gpt-5.4
```

Then start Claude Code normally:

```bash
claude
```

## Maintenance commands

Check installation or updater health:

```bash
claude doctor
```

Check for updates:

```bash
claude update
```

Install the native build:

```bash
claude install
claude install stable
claude install latest
```

## MCP server management

Start the MCP server:

```bash
claude mcp serve
```

List configured MCP servers:

```bash
claude mcp list
```

Show details for one MCP server:

```bash
claude mcp get <name>
```

Add an MCP server from JSON:

```bash
claude mcp add-json <name> '<json>'
```

Remove an MCP server:

```bash
claude mcp remove <name>
```

Import MCP servers from Claude Desktop:

```bash
claude mcp add-from-claude-desktop
```

Reset project-scoped MCP approval choices:

```bash
claude mcp reset-project-choices
```

## Plugin management

List installed plugins:

```bash
claude plugin list
```

Validate a plugin manifest:

```bash
claude plugin validate <path>
```

Install a plugin:

```bash
claude plugin install <plugin>
```

Uninstall a plugin:

```bash
claude plugin uninstall <plugin>
```

Enable or disable a plugin:

```bash
claude plugin enable <plugin>
claude plugin disable <plugin>
```

Update a plugin:

```bash
claude plugin update <plugin>
```

## Background and remote-oriented commands

Some command paths are also exposed directly from the CLI bootstrap:

```bash
claude remote-control
claude daemon
claude ps
claude logs <session-id>
claude attach <session-id>
claude kill <session-id>
```

Availability can depend on feature flags or environment setup in the build you are running.

## In-session slash commands

Once the interactive UI is open, slash commands are available inside the prompt box.

Common examples:

- `/help`
- `/model`
- `/cost`
- `/diff`
- `/plan`
- `/review`
- `/doctor`
- `/usage`

Some slash commands can vary by account type, provider, or enabled feature set in the build you are running.

## Practical first-run examples

Interactive:

```bash
claude "review the latest changes in this repository"
```

Print mode:

```bash
claude -p "summarize the architecture of the current project"
```

OpenAI compatibility mode:

```bash
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=your_api_key_here
claude -p "explain the main entrypoints in this codebase"
```
