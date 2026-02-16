---
name: oak-tree-skill
description: Manage git worktrees with a TUI. Use this skill when: "oak" "worktree" "git worktree" "manage worktrees" "worktree manager"
---

# Purpose

A TUI-based git worktree manager that opens in a tmux pane, showing recent projects and git worktrees for the current directory.

## Variables

SKILL_DIR: The directory containing this skill
DATA_FILE: ~/.local/share/git-worktree-manager/recent-projects.json

## Instructions

This skill launches a terminal UI in a 30% width tmux pane on the right side. The TUI displays:

1. A list of recent projects (directories where the manager was previously started)
2. A list of git worktrees in the current directory

The TUI is built with OpenTUI (@opentui/core) and provides a visual overview of worktrees.

## Workflow

> Execute the following steps in order, top to bottom:

### Step 1: Check for existing instance

```bash
~/.config/opencode/skills/oak-tui-skill/scripts/launch.sh --check-only
```

If output contains `EXISTING_INSTANCE_DETECTED`, go to Step 2. Otherwise, go to Step 3.

### Step 2: Handle existing instance

Use the `question` tool to ask the user:

- **"Restart here (Recommended)"** - Kill existing instance and open fresh TUI in this tmux window
- **"Dev Mode"** - Kill existing and open in dev mode with watch (for development)
- **"Cancel"** - Do nothing, keep existing instance

If user chooses "Cancel", stop here. Otherwise, kill existing instance:

```bash
~/.config/opencode/skills/oak-tui-skill/scripts/launch.sh --kill
```

### Step 3: Launch the TUI

**Normal Mode** (30% width pane on the right of current pane):

```bash
~/.config/opencode/skills/oak-tui-skill/scripts/launch.sh
```

**Dev Mode** with watch (auto-reload on file changes):

```bash
~/.config/opencode/skills/oak-tui-skill/scripts/launch.sh --dev
```

**Debug Mode** (with verbose logging):

```bash
~/.config/opencode/skills/oak-tui-skill/scripts/launch.sh --dev --debug
```

## Development

### Restart TUI

To restart the TUI after making changes:

1. **Kill existing**: `~/.config/opencode/skills/oak-tui-skill/scripts/launch.sh --kill`
2. **Relaunch**: `~/.config/opencode/skills/oak-tui-skill/scripts/launch.sh --dev`

Or simply run the launch script again - it will kill existing instances automatically.

**WARNING**: Do NOT use `tmux kill-pane -t :.+` as it may kill the wrong pane (including your current session).

### Debug Mode

To enable debug logging for the TUI itself, pass the `--debug` flag to the TUI:

```bash
bun run scripts/worktree-tui.ts --debug
```

Debug logs are written to `~/.local/share/git-worktree-manager/debug.log`. View them with:

```bash
tail -f ~/.local/share/git-worktree-manager/debug.log
```

### Single Instance

The TUI supports single-instance mode. If you launch the TUI while another instance is already running:

- The new instance sends a reload command to the existing one
- The existing instance reloads with the new directory
- The new instance exits immediately

This prevents multiple TUI instances from cluttering your tmux panes.

### Launch Script Options

The `scripts/launch.sh` script supports the following options:

| Option         | Description                                                                        |
| -------------- | ---------------------------------------------------------------------------------- |
| `--check-only` | Check if instance is running, output `EXISTING_INSTANCE_DETECTED` or `NO_INSTANCE` |
| `--kill`       | Kill existing TUI processes and clean up socket                                    |
| `--dev`        | Launch in dev mode with file watching                                              |
| `--debug`      | Enable verbose logging for the launch script itself                                |
