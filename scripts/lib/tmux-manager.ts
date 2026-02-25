// Tmux session and pane management

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { BackgroundPane } from "./types";
import { getCommandsForWorktree } from "./config-manager";
import { DATA_DIR } from "./constants";
import { debug, setDebugFn } from "./debug-utils";

export { debug, setDebugFn };

// Data directory for persistence
const BG_PANES_FILE = join(DATA_DIR, "background-panes.json");

// Track background panes (unique ID -> BackgroundPane)
// Changed to support multiple panes per worktree
const backgroundPanes = new Map<string, BackgroundPane>();

// Track the oak TUI pane ID
let oakPaneId: string | null = null;

/**
 * Initialize the tmux manager - load persisted background panes
 */
export function initTmuxManager(): void {
  oakPaneId = getTmuxPaneId();
  debug("Oak pane ID:", oakPaneId);
  loadBackgroundPanes();
  cleanupStalePanes();
  discoverOrphanedPanes();
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

interface PaneInfo {
  readonly id: string;
  readonly left: number;
  readonly top: number;
}

/**
 * Get the leftmost pane ID at the top (the main work pane, not the TUI pane or opencode pane)
 */
export function getLeftPaneId(): string | null {
  try {
    const currentPane = oakPaneId ?? getTmuxPaneId();
    const allPanes: PaneInfo[] = execSync(
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
      allPanes
        .map((p: Readonly<PaneInfo>) => `${p.id}(left=${p.left},top=${p.top})`)
        .join(", "),
    );
    debug("Oak pane (excluded):", currentPane);

    const panes = allPanes.filter(
      (p: Readonly<PaneInfo>) => p.id !== currentPane,
    ); // Exclude TUI pane

    if (panes.length === 0) {
      debug("No panes left after filtering out TUI pane");
      return null;
    }

    // Find the topmost-leftmost pane (the main work pane)
    // First filter to panes at the top (top = 0), then find leftmost
    const topPanes = panes.filter((p: Readonly<PaneInfo>) => p.top === 0);
    if (topPanes.length > 0) {
      const sortedTopPanes = [...topPanes].sort(
        (a: Readonly<PaneInfo>, b: Readonly<PaneInfo>) => a.left - b.left,
      );
      debug("Found top-left pane:", sortedTopPanes[0].id);
      return sortedTopPanes[0].id;
    }

    // Fallback: just find leftmost pane
    const sortedPanes = [...panes].sort(
      (a: Readonly<PaneInfo>, b: Readonly<PaneInfo>) => a.left - b.left,
    );
    debug("Fallback to leftmost pane:", sortedPanes[0].id);
    return sortedPanes[0].id;
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
 * Check if a pane is in the oak-bg session
 */
function paneInBackgroundSession(paneId: string): boolean {
  try {
    const output = execSync(
      `tmux list-panes -t oak-bg -a -F '#{pane_id}' 2>/dev/null`,
      {
        encoding: "utf-8",
      },
    )
      .trim()
      .split("\n");
    return output.includes(paneId);
  } catch {
    return false;
  }
}

/**
 * Check if worktree has a background pane (in oak-bg session)
 * Supports hierarchical matching - checks if pane's worktreePath matches or is a subdirectory
 */
export function hasBackgroundPane(worktreePath: string): boolean {
  const normalizedPath = worktreePath.endsWith("/")
    ? worktreePath
    : worktreePath + "/";

  for (const [_key, bgPane] of backgroundPanes) {
    // Check if this pane's worktreePath matches the target worktree
    // Match if:
    // 1. Exact match: bgPane.worktreePath === worktreePath
    // 2. Subdirectory: bgPane.worktreePath starts with worktreePath/
    const paneNormalizedPath = bgPane.worktreePath.endsWith("/")
      ? bgPane.worktreePath
      : bgPane.worktreePath + "/";

    const isMatch =
      bgPane.worktreePath === worktreePath ||
      paneNormalizedPath.startsWith(normalizedPath);

    if (isMatch) {
      // Verify the pane still exists AND is in oak-bg session
      if (
        paneExists(bgPane.paneId) &&
        paneInBackgroundSession(bgPane.paneId)
      ) {
        debug(
          `hasBackgroundPane: found pane ${bgPane.paneId} for ${worktreePath} (stored at ${bgPane.worktreePath})`,
        );
        return true;
      } else {
        debug(
          `hasBackgroundPane: stale entry for ${bgPane.worktreePath} (pane ${bgPane.paneId} not in oak-bg)`,
        );
        // Remove stale entry
        backgroundPanes.delete(_key);
        saveBackgroundPanes();
      }
    }
  }

  debug(`hasBackgroundPane: no match for ${worktreePath}`);
  return false;
}

/**
 * Get the current worktree path (from the active left pane)
 */
export function getCurrentWorktreePath(): string | null {
  const leftPaneId = getLeftPaneId();
  if (leftPaneId == null) return null;

  try {
    const paneCwd = execSync(
      `tmux display-message -p -t ${leftPaneId} '#{pane_current_path}'`,
      { encoding: "utf-8" },
    ).trim();
    debug("Current worktree path:", paneCwd);
    return paneCwd;
  } catch {
    return null;
  }
}

/**
 * Get background pane for a worktree (first match if multiple exist)
 */
export function getBackgroundPane(
  worktreePath: string,
): BackgroundPane | undefined {
  for (const [_key, bgPane] of backgroundPanes) {
    if (bgPane.worktreePath === worktreePath) {
      return bgPane;
    }
  }
  return undefined;
}

/**
 * Get all background panes
 */
export function getAllBackgroundPanes(): Map<string, BackgroundPane> {
  return backgroundPanes;
}

/**
 * Execute commands in a tmux pane
 */
function executeCommandsInPane(
  paneId: string,
  commands: string[],
  delay = 100,
): void {
  if (commands.length === 0) return;

  debug(`Executing ${commands.length} commands in pane ${paneId}`);

  for (const command of commands) {
    try {
      // Send the command to the pane
      execSync(`tmux send-keys -t ${paneId} ${JSON.stringify(command)} Enter`, {
        encoding: "utf-8",
      });

      // Small delay between commands
      if (delay > 0) {
        execSync(`sleep ${delay / 1000}`, { encoding: "utf-8" });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      debug(`Failed to execute command in pane: ${errorMessage}`);
    }
  }
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

  // Check if we're already in the target worktree - do nothing
  const currentPath = getCurrentWorktreePath();
  if (currentPath === worktreePath) {
    debug("Already in target worktree, doing nothing");
    return;
  }

  // Check if this worktree has a background pane
  if (hasBackgroundPane(worktreePath)) {
    debug("Recovering background pane for:", worktreePath);
    recoverBackgroundPane(worktreePath, leftPaneId);
    return;
  }

  // Create a new pane for this worktree
  debug("Creating new pane for:", worktreePath);

  if (leftPaneId == null) {
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

    debug("Left pane cwd before move:", paneCwd);

    // Capture oak pane width BEFORE any operations so we can restore it
    const oakPane = oakPaneId ?? getTmuxPaneId();
    const oakPaneWidth = execSync(
      `tmux display-message -p -t ${oakPane} '#{pane_width}'`,
      { encoding: "utf-8" },
    ).trim();
    debug("Oak pane width before switch:", oakPaneWidth);

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

    // Execute configured commands in the new pane
    const commands = getCommandsForWorktree(worktreePath, projectPath);
    if (commands.length > 0) {
      executeCommandsInPane(newPaneId, commands);
    }

    debug("Moving old left pane to background session:", leftPaneId);

    // Move the OLD left pane to the detached background session
    // Use break-pane to create a NEW WINDOW in oak-bg (avoids "pane too small" error)
    execSync(`tmux break-pane -d -s ${leftPaneId} -t oak-bg:`);

    // Small delay to let tmux complete the move
    execSync("sleep 0.1");

    debug("Tracking background pane");

    // The pane ID is preserved after break-pane
    const newBgPaneId = leftPaneId;

    // Restore oak pane width after the switch
    execSync(`tmux resize-pane -t ${oakPane} -x ${oakPaneWidth}`);
    debug("Restored oak pane width to:", oakPaneWidth);

    // Track the backgrounded pane by its ORIGINAL cwd (where it came from)
    // Use paneId as key to support multiple panes per worktree
    const bgPane: BackgroundPane = {
      paneId: newBgPaneId,
      worktreePath: paneCwd,
      projectPath: projectPath,
      createdAt: Date.now(),
    };

    backgroundPanes.set(newBgPaneId, bgPane);
    saveBackgroundPanes();

    debug("Tracking background pane:", newBgPaneId, "for path:", paneCwd);
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
 * Create a new pane at the specified path
 */
function createPaneAtPath(
  worktreePath: string,
  projectPath: string,
): string | null {
  debug("Creating pane at:", worktreePath);

  try {
    const oakPane = oakPaneId ?? getTmuxPaneId();

    // Create a new pane to the left of oak, at the worktree path
    execSync(`tmux split-window -h -b -t ${oakPane} -c "${worktreePath}"`);

    debug("New pane created at:", worktreePath);

    // Get the pane ID of the newly created pane (left pane)
    const leftPaneId = getLeftPaneId();
    if (leftPaneId !== null && leftPaneId !== "") {
      // Execute configured commands
      const commands = getCommandsForWorktree(worktreePath, projectPath);
      if (commands.length > 0) {
        executeCommandsInPane(leftPaneId, commands);
      }
      return leftPaneId;
    }

    return null;
  } catch (err) {
    debug("Error creating pane:", err);
    return null;
  }
}

/**
 * Recover a background pane
 */
/**
 * Find a background pane for the given worktree path.
 * Supports hierarchical matching - if no exact match, finds panes in subdirectories.
 * Returns the first match if multiple exist.
 */
function findBackgroundPaneForWorktree(
  worktreePath: string,
): { paneId: string } | undefined {
  const normalizedPath = worktreePath.endsWith("/")
    ? worktreePath
    : worktreePath + "/";

  // First try exact match
  for (const [_key, bgPane] of backgroundPanes) {
    if (bgPane.worktreePath === worktreePath) {
      return { paneId: bgPane.paneId };
    }
  }

  // Then try to find any pane in a subdirectory
  for (const [_key, bgPane] of backgroundPanes) {
    const paneNormalizedPath = bgPane.worktreePath.endsWith("/")
      ? bgPane.worktreePath
      : bgPane.worktreePath + "/";

    if (paneNormalizedPath.startsWith(normalizedPath)) {
      return { paneId: bgPane.paneId };
    }
  }

  return undefined;
}

function recoverBackgroundPane(
  worktreePath: string,
  currentLeftPaneId: string | null,
): void {
  const bgPaneInfo = findBackgroundPaneForWorktree(worktreePath);
  if (bgPaneInfo === undefined) {
    debug("No background pane found for:", worktreePath);
    return;
  }

  const { paneId: bgPaneId } = bgPaneInfo;

  debug("Recovering pane:", bgPaneId);

  try {
    // Check if the background pane still exists
    if (!paneExists(bgPaneId)) {
      debug("Background pane no longer exists, removing from tracking");
      backgroundPanes.delete(bgPaneId);
      saveBackgroundPanes();
      return;
    }

    if (currentLeftPaneId != null && currentLeftPaneId !== "") {
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

      // Capture oak pane width BEFORE any operations so we can restore it
      const oakPane = oakPaneId ?? getTmuxPaneId();
      const oakPaneWidth = execSync(
        `tmux display-message -p -t ${oakPane} '#{pane_width}'`,
        { encoding: "utf-8" },
      ).trim();
      debug("Oak pane width before recover:", oakPaneWidth);

      // Ensure background session exists
      ensureBackgroundSession();

      // First, bring the recovered pane back using join-pane
      // This joins the background pane to the left of the oak pane
      execSync(
        `tmux join-pane -h -b -l ${paneWidth} -t ${oakPane} -s ${bgPaneId}`,
      );
      execSync("sleep 0.1");

      debug("Recovered pane joined to main window");

      // Now move the old left pane to background using break-pane
      // Note: break-pane preserves the pane ID, so we use currentLeftPaneId
      execSync(`tmux break-pane -d -s ${currentLeftPaneId} -t oak-bg:`);
      execSync("sleep 0.1");

      // Restore oak pane width after the switch
      execSync(`tmux resize-pane -t ${oakPane} -x ${oakPaneWidth}`);
      debug("Restored oak pane width to:", oakPaneWidth);

      // The pane ID is preserved after break-pane
      const newBgPaneId = currentLeftPaneId;

      debug("Moved current pane to background:", newBgPaneId);

      debug("Recovered pane moved to main window");

      // Remove the recovered pane from tracking FIRST
      backgroundPanes.delete(bgPaneId);

      // Track the newly backgrounded pane
      // Use paneId as key to support multiple panes per worktree
      const newBgPane: BackgroundPane = {
        paneId: newBgPaneId,
        worktreePath: paneCwd,
        projectPath: paneCwd,
        createdAt: Date.now(),
      };
      backgroundPanes.set(newBgPaneId, newBgPane);

      debug("Tracking new background pane:", newBgPaneId, "for path:", paneCwd);
      saveBackgroundPanes();
    } else {
      // No current left pane, just move the background pane to main window
      const oakPane = oakPaneId ?? getTmuxPaneId();
      execSync(`tmux move-pane -h -b -t ${oakPane} -s ${bgPaneId}`);

      // Remove the recovered pane from tracking
      backgroundPanes.delete(bgPaneId);
      saveBackgroundPanes();
    }

    debug("Pane recovered successfully");
  } catch (err) {
    debug("Error recovering pane:", err);
    // Clean up invalid entry
    backgroundPanes.delete(bgPaneId);
    saveBackgroundPanes();
  }
}

/**
 * Type guard for background panes data
 */
function isBackgroundPanesData(
  data: unknown,
): data is Readonly<Record<string, BackgroundPane>> {
  return typeof data === "object" && data !== null;
}

/**
 * Load background panes from file
 * Handles migration from old format (path keys) to new format (paneId keys)
 */
function loadBackgroundPanes(): void {
  try {
    if (existsSync(BG_PANES_FILE)) {
      const rawData: unknown = JSON.parse(readFileSync(BG_PANES_FILE, "utf-8"));
      if (isBackgroundPanesData(rawData)) {
        backgroundPanes.clear();
        let migrated = false;

        for (const [key, value] of Object.entries(rawData)) {
          // Check if this is old format (key is a path, not a paneId)
          // PaneIds start with % (e.g., %9, %10)
          // Paths start with / (e.g., /home/user/...)
          if (key.startsWith("/")) {
            // Old format: key is the path, migrate to new format
            debug(
              `Migrating old format entry: ${key} -> ${value.paneId} (${value.worktreePath})`,
            );
            backgroundPanes.set(value.paneId, value);
            migrated = true;
          } else {
            // New format: key is already paneId
            backgroundPanes.set(key, value);
          }
        }

        debug("Loaded background panes:", backgroundPanes.size);
        if (migrated) {
          debug("Migrated old format entries, saving...");
          saveBackgroundPanes();
        }
      }
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
 * Discover orphaned panes in oak-bg session and add them to tracking
 */
function discoverOrphanedPanes(): void {
  debug("Discovering orphaned panes in oak-bg session");

  try {
    // Check if oak-bg session exists
    const sessionExists = execSync("tmux has-session -t oak-bg 2>&1", {
      encoding: "utf-8",
    });

    if (sessionExists.includes("can't find session")) {
      debug("oak-bg session does not exist, skipping discovery");
      return;
    }
  } catch {
    debug("oak-bg session does not exist, skipping discovery");
    return;
  }

  try {
    // Get all panes in oak-bg session
    const output = execSync(
      "tmux list-panes -t oak-bg -F '#{pane_id} #{pane_current_path}'",
      { encoding: "utf-8" },
    ).trim();

    if (!output) {
      debug("No panes in oak-bg session");
      return;
    }

    const panes = output.split("\n").map((line) => {
      const [paneId, path] = line.split(" ");
      return { paneId, path };
    });

    debug(`Found ${panes.length} panes in oak-bg session`);

    let discoveredCount = 0;

    for (const pane of panes) {
      // Skip if already tracked
      const isTracked = Array.from(backgroundPanes.values()).some(
        (bgPane) => bgPane.paneId === pane.paneId,
      );
      if (isTracked) {
        debug(`Pane ${pane.paneId} at ${pane.path} is already tracked`);
        continue;
      }

      // Try to determine the project path (git root)
      let projectPath = pane.path;
      try {
        const gitRoot = execSync("git rev-parse --show-toplevel", {
          cwd: pane.path,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "ignore"], // Suppress stderr
        }).trim();
        projectPath = gitRoot;
      } catch {
        // Not a git repo, use the pane path as project path
        debug(`Pane ${pane.paneId} at ${pane.path} is not in a git repo`);
      }

      // Add to tracking - use paneId as key
      const bgPane: BackgroundPane = {
        paneId: pane.paneId,
        worktreePath: pane.path,
        projectPath: projectPath,
        createdAt: Date.now(),
      };

      backgroundPanes.set(pane.paneId, bgPane);
      discoveredCount++;
      debug(`Discovered orphaned pane: ${pane.paneId} at ${pane.path}`);
    }

    if (discoveredCount > 0) {
      debug(`Discovered ${discoveredCount} orphaned panes`);
      saveBackgroundPanes();
    } else {
      debug("No orphaned panes discovered");
    }
  } catch (err) {
    debug("Error discovering orphaned panes:", err);
  }
}

/**
 * Clean up stale panes that no longer exist
 */
function cleanupStalePanes(): void {
  debug("Cleaning up stale panes");
  const toRemove: string[] = [];

  for (const [paneId, bgPane] of backgroundPanes) {
    if (!paneExists(bgPane.paneId)) {
      debug("Removing stale pane:", paneId, bgPane.worktreePath);
      toRemove.push(paneId);
    }
  }

  for (const paneId of toRemove) {
    backgroundPanes.delete(paneId);
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
  if (leftPaneId == null) {
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
