#!/bin/bash
# Oak TUI Launcher Script
# Finds the correct tmux pane and launches the TUI next to it

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
SOCKET_PATH="$HOME/.local/share/oak-tui/tui.sock"
DEBUG=${DEBUG:-0}

log() {
    if [[ "$DEBUG" == "1" ]]; then
        echo "[oak-launch] $*" >&2
    fi
}

error() {
    echo "[oak-launch ERROR] $*" >&2
}

# Parse arguments
MODE="normal"
DEBUG_FLAG=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --dev)
            MODE="dev"
            shift
            ;;
        --debug)
            DEBUG=1
            DEBUG_FLAG="--debug"
            shift
            ;;
        --restart)
            log "Sending restart command to existing TUI instance..."
            if ! bun run "$SKILL_DIR/scripts/send-restart.ts"; then
                error "Failed to send restart command (is TUI running?)"
                exit 1
            fi
            echo "Restart command sent successfully"
            exit 0
            ;;
        --check-only)
            # Check if instance is running
            if [[ -S "$SOCKET_PATH" ]]; then
                echo "EXISTING_INSTANCE_DETECTED"
                exit 0
            else
                echo "NO_INSTANCE"
                exit 0
            fi
            ;;
        --kill)
            log "Killing existing TUI processes..."
            pkill -9 -f "worktree-tui" 2>/dev/null || true
            pkill -9 -f "bun.*worktree" 2>/dev/null || true
            pkill -9 -f "bun.*oak" 2>/dev/null || true
            rm -f "$SOCKET_PATH" 2>/dev/null || true
            # NOTE: Do NOT kill oak-bg session - it contains user's background panes
            sleep 0.3
            echo "Killed"
            exit 0
            ;;
        --status)
            echo "=== Oak TUI Status ==="
            echo "Socket: $([ -S "$SOCKET_PATH" ] && echo "exists" || echo "not found")"
            echo "Processes:"
            pgrep -a -f "worktree-tui" 2>/dev/null || echo "  No worktree-tui processes"
            echo "Tmux panes with bun:"
            tmux list-panes -a -F "  #{session_name}:#{window_index}.#{pane_index} #{pane_id} #{pane_current_command}" 2>/dev/null | grep -i bun || echo "  None"
            exit 0
            ;;
        *)
            shift
            ;;
    esac
done

log "Mode: $MODE"
log "Skill dir: $SKILL_DIR"

# Check if we're in tmux
if [[ -z "$TMUX" ]]; then
    error "Not running inside tmux"
    exit 1
fi

# Get current pane info
CURRENT_PANE=$(tmux display-message -p '#{pane_id}')
CURRENT_WINDOW=$(tmux display-message -p '#{window_index}')
CURRENT_SESSION=$(tmux display-message -p '#{session_name}')

# Safety check: never run in oak-bg session
if [[ "$CURRENT_SESSION" == "oak-bg" ]]; then
    error "Refusing to launch in oak-bg session (background session)"
    exit 1
fi

log "Current session: $CURRENT_SESSION"
log "Current window: $CURRENT_WINDOW"
log "Current pane: $CURRENT_PANE"

# Verify the pane exists
if ! tmux list-panes -F '#{pane_id}' | grep -q "^${CURRENT_PANE}$"; then
    error "Current pane $CURRENT_PANE not found in pane list"
    log "Available panes:"
    tmux list-panes -F '#{pane_id} #{pane_current_command}' >&2
    exit 1
fi

# Kill any existing TUI processes
log "Cleaning up existing instances..."
pkill -9 -f "worktree-tui" 2>/dev/null || true
pkill -9 -f "bun.*worktree" 2>/dev/null || true
rm -f "$SOCKET_PATH" 2>/dev/null || true
sleep 0.3

# Build the command based on mode
if [[ "$MODE" == "dev" ]]; then
    BASE_CMD="cd '$SKILL_DIR' && bun run --watch scripts/worktree-tui.ts $DEBUG_FLAG"
else
    BASE_CMD="cd '$(pwd)' && bun run '$SKILL_DIR/scripts/worktree-tui.ts' $DEBUG_FLAG"
fi

# Wrap in a loop that restarts on exit code 42
CMD="while true; do $BASE_CMD; EXIT_CODE=\$?; if [ \$EXIT_CODE -ne 42 ]; then exit \$EXIT_CODE; fi; sleep 0.1; done"

log "Command: $CMD"

# Split the current pane horizontally (right side, 30% width)
log "Splitting pane $CURRENT_PANE..."

# Use -P -F to get the new pane ID
NEW_PANE=$(tmux split-window -t "$CURRENT_PANE" -h -l 30% -P -F '#{pane_id}' "bash -c '$CMD'" 2>&1)

if [[ $? -ne 0 ]]; then
    error "Failed to split pane: $NEW_PANE"
    exit 1
fi

if [[ -z "$NEW_PANE" ]]; then
    error "split-window returned empty pane ID"
    exit 1
fi

log "Created new pane: $NEW_PANE"

# Set the pane title to "Oak"
tmux select-pane -t "$NEW_PANE" -T "Oak"
log "Set pane title to 'Oak'"

# Verify the new pane exists
sleep 0.5
if tmux list-panes -a -F '#{pane_id}' | grep -q "^${NEW_PANE}$"; then
    log "Verified pane $NEW_PANE exists"
    echo "Oak TUI started in pane $NEW_PANE (window $CURRENT_SESSION:$CURRENT_WINDOW)"
else
    error "New pane $NEW_PANE not found after creation"
    log "Current panes:"
    tmux list-panes -a -F '#{session_name}:#{window_index} #{pane_id} #{pane_current_command}' >&2
    exit 1
fi
