// Tmux session and pane management

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { BackgroundPane } from "./types";

// Data directory for persistence
const DATA_DIR = join(homedir(), ".local", "share", "git-worktree-manager");
const BG_PANES_FILE = join(DATA_DIR, "background-panes.json");

// Track background panes (worktree path -> BackgroundPane)
const backgroundPanes = new Map<string, BackgroundPane>();

// Track the oak TUI pane ID
let oakPaneId: string | null = null;

// Debug function (can be overridden)
let debugFn: (...args: unknown[]) => void = () => {};

export function setDebugFn(fn: (...args: unknown[]) => void): void {
  debugFn = fn;
}

function debug(...args: unknown[]): void {
  debugFn(...args);
}

/**
 * Initialize the tmux manager - load persisted background panes
 */
export function initTmuxManager(): void {
  oakPaneId = getTmuxPaneId();
  debug("Oak pane ID:", oakPaneId);
  loadBackgroundPanes();
  cleanupStalePanes();
}

/**
 * Get the current tmux pane ID (oak TUI pane)
 */
export function getTmuxPaneId(): string | null {
  try {
    const paneId = execSync("tmux display-message -p '#{pane_id}'", {
      encoding: "utf-8",
    }).trim();
    return paneId;
  } catch {
    return null;
  }
}

/**
 * Get the leftmost pane ID at the top (the main work pane, not the TUI pane or opencode pane)
 */
export function getLeftPaneId(): string | null {
  try {
    const currentPane = oakPaneId || getTmuxPaneId();
    const allPanes = execSync(
      "tmux list-panes -F '#{pane_id} #{pane_left} #{pane_top}'",
      {
        encoding: "utf-8",
      },
    )
      .trim()
      .split("\n")
      .map((line) => {
        const parts = line.split(" ");
        return {
          id: parts[0],
          left: parseInt(parts[1]),
          top: parseInt(parts[2]),
        };
      });

    debug(
      "All panes:",
      allPanes.map((p) => `${p.id}(left=${p.left},top=${p.top})`).join(", "),
    );
    debug("Oak pane (excluded):", currentPane);

    const panes = allPanes.filter((p) => p.id !== currentPane); // Exclude TUI pane

    if (panes.length === 0) {
      debug("No panes left after filtering out TUI pane");
      return null;
    }

    // Find the topmost-leftmost pane (the main work pane)
    // First filter to panes at the top (top = 0), then find leftmost
    const topPanes = panes.filter((p) => p.top === 0);
    if (topPanes.length > 0) {
      topPanes.sort((a, b) => a.left - b.left);
      debug("Found top-left pane:", topPanes[0].id);
      return topPanes[0].id;
    }

    // Fallback: just find leftmost pane
    panes.sort((a, b) => a.left - b.left);
    debug("Fallback to leftmost pane:", panes[0].id);
    return panes[0].id;
  } catch (err) {
    debug("Error getting left pane:", err);
    return null;
  }
}

/**
 * Check if a pane exists
 */
function paneExists(paneId: string): boolean {
  try {
    const panes = execSync("tmux list-panes -a -F '#{pane_id}'", {
      encoding: "utf-8",
    })
      .trim()
      .split("\n");
    return panes.includes(paneId);
  } catch {
    return false;
  }
}

/**
 * Get all panes in the current window
 */
function getWindowPanes(): string[] {
  try {
    return execSync("tmux list-panes -F '#{pane_id}'", {
      encoding: "utf-8",
    })
      .trim()
      .split("\n");
  } catch {
    return [];
  }
}

/**
 * Check if worktree has a background pane
 */
export function hasBackgroundPane(worktreePath: string): boolean {
  const has = backgroundPanes.has(worktreePath);
  debug(
    `hasBackgroundPane check: ${worktreePath} = ${has} (tracked: ${Array.from(backgroundPanes.keys()).join(", ") || "none"})`,
  );
  return has;
}

/**
 * Get background pane for a worktree
 */
export function getBackgroundPane(
  worktreePath: string,
): BackgroundPane | undefined {
  return backgroundPanes.get(worktreePath);
}

/**
 * Get all background panes
 */
export function getAllBackgroundPanes(): Map<string, BackgroundPane> {
  return backgroundPanes;
}

/**
 * Switch to a worktree - creates new pane or recovers background pane
 */
export function switchToWorktree(
  worktreePath: string,
  projectPath: string,
): void {
  debug("switchToWorktree:", worktreePath);

  const leftPaneId = getLeftPaneId();
  debug("Current left pane:", leftPaneId);

  // Check if this worktree has a background pane
  if (hasBackgroundPane(worktreePath)) {
    debug("Recovering background pane for:", worktreePath);
    recoverBackgroundPane(worktreePath, leftPaneId);
    return;
  }

  // Create a new pane for this worktree
  debug("Creating new pane for:", worktreePath);

  if (!leftPaneId) {
    // No left pane, just create one
    createPaneAtPath(worktreePath, projectPath);
    return;
  }

  // Strategy:
  // 1. Create new pane FIRST (while we still have space from the left pane)
  // 2. Move old left pane to detached background session
  // 3. Track the old pane by its cwd

  try {
    // Get current pane's working directory for tracking
    const paneCwd = execSync(
      `tmux display-message -p -t ${leftPaneId} '#{pane_current_path}'`,
      { encoding: "utf-8" },
    ).trim();

    // Ensure background session exists (detached)
    ensureBackgroundSession();

    debug("Creating new pane at:", worktreePath);

    // Create new pane by splitting the LEFT pane (not the oak pane)
    // This creates a new pane next to the existing left pane
    // Use -h for horizontal split, -l 50% to split evenly
    const newPaneId = execSync(
      `tmux split-window -h -t ${leftPaneId} -c "${worktreePath}" -P -F '#{pane_id}'`,
      { encoding: "utf-8" },
    ).trim();

    debug("New pane created:", newPaneId);

    // Small delay to let tmux complete the split
    execSync("sleep 0.1");

    debug("Moving old left pane to background session:", leftPaneId);

    // Move the OLD left pane to the detached background session
    // Use break-pane to create a NEW WINDOW in oak-bg (avoids "pane too small" error)
    execSync(`tmux break-pane -d -s ${leftPaneId} -t oak-bg:`);

    // Small delay to let tmux complete the move
    execSync("sleep 0.1");

    debug("Tracking background pane");

    // break-pane preserves the pane ID, so use leftPaneId directly
    // (no need to query oak-bg which could return wrong pane if multiple exist)
    const bgPaneId = leftPaneId;

    // Track the backgrounded pane by its ORIGINAL cwd (where it came from)
    // The green dot will appear next to the worktree matching this path
    // When user clicks on that worktree, we recover this pane
    const bgPane: BackgroundPane = {
      paneId: bgPaneId,
      worktreePath: paneCwd,
      projectPath: projectPath,
      createdAt: Date.now(),
    };

    backgroundPanes.set(paneCwd, bgPane);
    saveBackgroundPanes();

    debug("Tracking background pane:", bgPaneId, "for path:", paneCwd);
  } catch (err) {
    debug("Error in switchToWorktree:", err);
    // Don't fallback to cd - it can target the wrong pane (agent pane)
    // Just log the error and let the user retry
  }
}

/**
 * Ensure the background session exists (detached)
 */
function ensureBackgroundSession(): void {
  try {
    execSync("tmux has-session -t oak-bg 2>/dev/null", {
      encoding: "utf-8",
    });
  } catch {
    // Background session doesn't exist, create it detached
    execSync("tmux new-session -d -s oak-bg -x 80 -y 24");
  }
}

/**
 * Ensure the background window exists (legacy - not used)
 */
function ensureBackgroundWindow(): void {
  try {
    execSync("tmux list-windows -F '#{window_name}' | grep -q '^oak-bg$'", {
      encoding: "utf-8",
    });
  } catch {
    // Background window doesn't exist, create it
    debug("Creating background window");
    execSync("tmux new-window -d -n 'oak-bg'");
  }
}

/**
 * Create a new pane at the specified path
 */
function createPaneAtPath(worktreePath: string, projectPath: string): void {
  debug("Creating pane at:", worktreePath);

  try {
    const oakPane = oakPaneId || getTmuxPaneId();

    // Create a new pane to the left of oak, at the worktree path
    execSync(`tmux split-window -h -b -t ${oakPane} -c "${worktreePath}"`);

    debug("New pane created at:", worktreePath);
  } catch (err) {
    debug("Error creating pane:", err);
  }
}

/**
 * Recover a background pane
 */
function recoverBackgroundPane(
  worktreePath: string,
  currentLeftPaneId: string | null,
): void {
  const bgPane = backgroundPanes.get(worktreePath);
  if (!bgPane) {
    debug("No background pane found for:", worktreePath);
    return;
  }

  debug("Recovering pane:", bgPane.paneId);

  try {
    // Check if the background pane still exists
    if (!paneExists(bgPane.paneId)) {
      debug("Background pane no longer exists, removing from tracking");
      backgroundPanes.delete(worktreePath);
      saveBackgroundPanes();
      return;
    }

    if (currentLeftPaneId) {
      // IMPORTANT: Capture cwd and dimensions BEFORE any pane operations
      // because pane IDs can shift after join-pane/break-pane
      const paneCwd = execSync(
        `tmux display-message -p -t ${currentLeftPaneId} '#{pane_current_path}'`,
        { encoding: "utf-8" },
      ).trim();

      const paneWidth = execSync(
        `tmux display-message -p -t ${currentLeftPaneId} '#{pane_width}'`,
        { encoding: "utf-8" },
      ).trim();

      debug("Current left pane cwd:", paneCwd);
      debug("Current left pane width:", paneWidth);

      // Ensure background session exists
      ensureBackgroundSession();

      // First, bring the recovered pane back using join-pane
      // This joins the background pane to the left of the oak pane
      const oakPane = oakPaneId || getTmuxPaneId();
      execSync(
        `tmux join-pane -h -b -l ${paneWidth} -t ${oakPane} -s ${bgPane.paneId}`,
      );
      execSync("sleep 0.1");

      debug("Recovered pane joined to main window");

      // Now move the old left pane to background using break-pane
      // Note: break-pane preserves the pane ID, so we use currentLeftPaneId
      execSync(`tmux break-pane -d -s ${currentLeftPaneId} -t oak-bg:`);
      execSync("sleep 0.1");

      // The pane ID is preserved after break-pane
      const newBgPaneId = currentLeftPaneId;

      debug("Moved current pane to background:", newBgPaneId);

      debug("Recovered pane moved to main window");

      // Remove the recovered pane from tracking FIRST
      // (before adding new one, in case paths are the same)
      backgroundPanes.delete(worktreePath);

      // Track the newly backgrounded pane
      const newBgPane: BackgroundPane = {
        paneId: newBgPaneId,
        worktreePath: paneCwd,
        projectPath: paneCwd,
        createdAt: Date.now(),
      };
      backgroundPanes.set(paneCwd, newBgPane);

      debug("Tracking new background pane:", newBgPaneId, "for path:", paneCwd);
      saveBackgroundPanes();
    } else {
      // No current left pane, just move the background pane to main window
      const oakPane = oakPaneId || getTmuxPaneId();
      execSync(`tmux move-pane -h -b -t ${oakPane} -s ${bgPane.paneId}`);

      // Remove the recovered pane from tracking
      backgroundPanes.delete(worktreePath);
      saveBackgroundPanes();
    }

    debug("Pane recovered successfully");
  } catch (err) {
    debug("Error recovering pane:", err);
    // Clean up invalid entry
    backgroundPanes.delete(worktreePath);
    saveBackgroundPanes();
  }
}

/**
 * Load background panes from file
 */
function loadBackgroundPanes(): void {
  try {
    if (existsSync(BG_PANES_FILE)) {
      const data = JSON.parse(readFileSync(BG_PANES_FILE, "utf-8"));
      backgroundPanes.clear();
      for (const [key, value] of Object.entries(data)) {
        backgroundPanes.set(key, value as BackgroundPane);
      }
      debug("Loaded background panes:", backgroundPanes.size);
    }
  } catch (err) {
    debug("Error loading background panes:", err);
  }
}

/**
 * Save background panes to file
 */
function saveBackgroundPanes(): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    const data: Record<string, BackgroundPane> = {};
    for (const [key, value] of backgroundPanes) {
      data[key] = value;
    }
    writeFileSync(BG_PANES_FILE, JSON.stringify(data, null, 2));
    debug("Saved background panes:", backgroundPanes.size);
  } catch (err) {
    debug("Error saving background panes:", err);
  }
}

/**
 * Clean up stale panes that no longer exist
 */
function cleanupStalePanes(): void {
  debug("Cleaning up stale panes");
  const toRemove: string[] = [];

  for (const [path, bgPane] of backgroundPanes) {
    if (!paneExists(bgPane.paneId)) {
      debug("Removing stale pane:", path, bgPane.paneId);
      toRemove.push(path);
    }
  }

  for (const path of toRemove) {
    backgroundPanes.delete(path);
  }

  if (toRemove.length > 0) {
    saveBackgroundPanes();
  }

  debug("Cleanup complete, remaining panes:", backgroundPanes.size);
}

/**
 * Legacy function for compatibility - just sends cd command
 */
export function switchToProject(projectPath: string): void {
  debug("switchToProject (legacy):", projectPath);

  const leftPaneId = getLeftPaneId();
  if (!leftPaneId) {
    debug("Could not find left pane");
    return;
  }

  try {
    execSync(`tmux send-keys -t ${leftPaneId} 'cd "${projectPath}"' C-m`);
    debug("Sent cd command to left pane");
  } catch (err) {
    debug("Error sending cd command:", err);
  }
}
