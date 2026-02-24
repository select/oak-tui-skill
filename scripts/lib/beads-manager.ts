// Beads issue management - fetching and parsing issues from bd CLI

import { execSync } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { BeadsIssue, GroupedIssues, ReadonlyGroupedIssues } from "./types";
import { IGNORED_DIRS } from "./constants";
import { capitalize } from "./string-utils";

/**
 * Find .beads directory using breadth-first search.
 * Priority: root first, then shallowest subdirectories.
 *
 * @param startPath - Directory to start search from
 * @returns Path containing .beads directory, or null if not found
 */
export function findBeadsDirectory(startPath: string): string | null {
  // Check root first
  if (existsSync(join(startPath, ".beads"))) {
    return startPath;
  }

  // BFS through subdirectories
  const queue: string[] = [startPath];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentPath = queue.shift()!;

    if (visited.has(currentPath)) continue;
    visited.add(currentPath);

    try {
      const entries = readdirSync(currentPath);

      for (const entry of entries) {
        // Skip ignored directories
        if (IGNORED_DIRS.has(entry)) continue;

        const fullPath = join(currentPath, entry);

        try {
          const stats = statSync(fullPath);
          if (!stats.isDirectory()) continue;

          // Check if this directory contains .beads
          if (existsSync(join(fullPath, ".beads"))) {
            return fullPath;
          }

          // Add to queue for further exploration
          queue.push(fullPath);
        } catch {
          // Skip permission errors
          continue;
        }
      }
    } catch {
      // Skip directories we can't read
      continue;
    }
  }

  return null; // No .beads found
}

/**
 * Type guard to check if a value is a BeadsIssue
 */
function isBeadsIssue(value: unknown): value is BeadsIssue {
  if (typeof value !== "object" || value === null) return false;
  return (
    "id" in value &&
    "title" in value &&
    "status" in value &&
    typeof (value as { id: unknown }).id === "string" &&
    typeof (value as { title: unknown }).title === "string" &&
    typeof (value as { status: unknown }).status === "string"
  );
}

/**
 * Parse JSON as BeadsIssue array with proper type narrowing
 */
function parseBeadsIssues(json: string): BeadsIssue[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    return [];
  }
  // Filter to only valid issues
  return parsed.filter(isBeadsIssue);
}

/**
 * Fetch all beads issues using bd CLI
 * @param workingDir - Directory to execute bd command in (defaults to current directory)
 */
export function fetchBeadsIssues(workingDir?: string): BeadsIssue[] {
  try {
    const searchPath = workingDir ?? process.cwd();
    const beadsDir = findBeadsDirectory(searchPath);

    if (beadsDir === null) {
      return []; // No .beads found
    }

    const output = execSync("bd list --all --json", {
      encoding: "utf-8",
      timeout: 5000,
      cwd: beadsDir, // Use directory containing .beads
      stdio: ["pipe", "pipe", "ignore"], // Suppress stderr
    });
    return parseBeadsIssues(output);
  } catch {
    return [];
  }
}

/**
 * Fetch ready issues (open with no blockers)
 * @param workingDir - Directory to execute bd command in (defaults to current directory)
 */
export function fetchReadyIssues(workingDir?: string): BeadsIssue[] {
  try {
    const searchPath = workingDir ?? process.cwd();
    const beadsDir = findBeadsDirectory(searchPath);

    if (beadsDir === null) {
      return []; // No .beads found
    }

    const output = execSync("bd ready --json", {
      encoding: "utf-8",
      timeout: 5000,
      cwd: beadsDir, // Use directory containing .beads
      stdio: ["pipe", "pipe", "ignore"], // Suppress stderr
    });
    return parseBeadsIssues(output);
  } catch {
    return [];
  }
}

/**
 * Group issues by status for board display
 * @param workingDir - Directory to execute bd command in (defaults to current directory)
 */
export function groupIssuesByStatus(
  issues: readonly BeadsIssue[],
  workingDir?: string,
): GroupedIssues {
  const readyIssues = fetchReadyIssues(workingDir);
  const readyIds = new Set(readyIssues.map((i: BeadsIssue) => i.id));

  const grouped: GroupedIssues = {
    blocked: [],
    ready: [],
    in_progress: [],
    closed: [],
  };

  const today = new Date().toDateString();

  for (const issue of issues) {
    if (issue.status === "closed") {
      // Only show issues closed today
      if (issue.closed_at) {
        const closedDate = new Date(issue.closed_at).toDateString();
        if (closedDate === today) {
          grouped.closed.push(issue);
        }
      }
    } else if (issue.status === "in_progress") {
      grouped.in_progress.push(issue);
    } else if (issue.status === "blocked") {
      grouped.blocked.push(issue);
    } else {
      // Open issues go to ready if they have no blockers
      if (readyIds.has(issue.id)) {
        grouped.ready.push(issue);
      } else {
        grouped.blocked.push(issue);
      }
    }
  }

  return grouped;
}

/**
 * Fetch and group issues in one call
 * @param workingDir - Directory to execute bd command in (defaults to current directory)
 */
export function fetchAndGroupIssues(workingDir?: string): GroupedIssues {
  const issues = fetchBeadsIssues(workingDir);
  return groupIssuesByStatus(issues, workingDir);
}

/**
 * Get total count of issues across all groups
 */
export function getTotalBoardCount(grouped: ReadonlyGroupedIssues): number {
  return (
    grouped.blocked.length +
    grouped.ready.length +
    grouped.in_progress.length +
    grouped.closed.length
  );
}

/**
 * Get issue at a flat index across all groups
 * Order: in_progress -> ready -> blocked -> closed (matches UI display order)
 */
export function getIssueAtIndex(
  grouped: ReadonlyGroupedIssues,
  index: number,
): { issue: BeadsIssue; section: keyof GroupedIssues } | null {
  let currentIndex = 0;

  // In Progress (first in display order)
  if (index < currentIndex + grouped.in_progress.length) {
    return {
      issue: grouped.in_progress[index - currentIndex],
      section: "in_progress",
    };
  }
  currentIndex += grouped.in_progress.length;

  // Ready
  if (index < currentIndex + grouped.ready.length) {
    return { issue: grouped.ready[index - currentIndex], section: "ready" };
  }
  currentIndex += grouped.ready.length;

  // Blocked
  if (index < currentIndex + grouped.blocked.length) {
    return { issue: grouped.blocked[index - currentIndex], section: "blocked" };
  }
  currentIndex += grouped.blocked.length;

  // Closed
  if (index < currentIndex + grouped.closed.length) {
    return { issue: grouped.closed[index - currentIndex], section: "closed" };
  }

  return null;
}

/**
 * Get the start index of each section
 * Order: in_progress -> ready -> blocked -> closed
 */
export function getSectionStartIndices(grouped: ReadonlyGroupedIssues): {
  in_progress: number;
  ready: number;
  blocked: number;
  closed: number;
} {
  const inProgressStart = 0;
  const readyStart = grouped.in_progress.length;
  const blockedStart = readyStart + grouped.ready.length;
  const closedStart = blockedStart + grouped.blocked.length;

  return {
    in_progress: inProgressStart,
    ready: readyStart,
    blocked: blockedStart,
    closed: closedStart,
  };
}

/**
 * Get the next section start index (for h/l navigation)
 * Returns the start index of the next non-empty section, or current index if at last section
 */
export function getNextSectionStart(
  grouped: ReadonlyGroupedIssues,
  currentIndex: number,
): number {
  const starts = getSectionStartIndices(grouped);

  // Determine current section and find next non-empty section
  const sections: (keyof GroupedIssues)[] = [
    "in_progress",
    "ready",
    "blocked",
    "closed",
  ];

  for (let i = 0; i < sections.length - 1; i++) {
    const nextSection = sections[i + 1];
    const sectionEnd = starts[nextSection];

    if (currentIndex < sectionEnd) {
      // We're in this section, find next non-empty section
      for (let j = i + 1; j < sections.length; j++) {
        if (grouped[sections[j]].length > 0) {
          return starts[sections[j]];
        }
      }
      // No more non-empty sections
      return currentIndex;
    }
  }

  // Already at last section
  return currentIndex;
}

/**
 * Get the previous section start index (for h/l navigation)
 * Returns the start index of the previous non-empty section, or 0 if at first section
 */
export function getPrevSectionStart(
  grouped: ReadonlyGroupedIssues,
  currentIndex: number,
): number {
  const starts = getSectionStartIndices(grouped);

  // Determine current section and find previous non-empty section
  const sections: (keyof GroupedIssues)[] = [
    "in_progress",
    "ready",
    "blocked",
    "closed",
  ];

  for (let i = sections.length - 1; i > 0; i--) {
    const section = sections[i];
    const sectionStart = starts[section];

    if (currentIndex >= sectionStart && grouped[section].length > 0) {
      // We're in this section, find previous non-empty section
      for (let j = i - 1; j >= 0; j--) {
        if (grouped[sections[j]].length > 0) {
          return starts[sections[j]];
        }
      }
      // No previous non-empty sections
      return 0;
    }
  }

  // At first section
  return 0;
}

/**
 * Get priority label from number
 */
export function getPriorityLabel(priority: number): string {
  switch (priority) {
    case 0:
      return "Critical";
    case 1:
      return "High";
    case 2:
      return "Medium";
    case 3:
      return "Low";
    case 4:
      return "Lowest";
    default:
      return "Medium";
  }
}

/**
 * Get priority icon
 */
export function getPriorityIcon(priority: number): string {
  switch (priority) {
    case 0:
      return "⬆⬆"; // Critical - double up arrow
    case 1:
      return "⬆"; // High - up arrow
    case 2:
      return "●"; // Medium - dot
    case 3:
      return "⬇"; // Low - down arrow
    case 4:
      return "⬇⬇"; // Lowest - double down arrow
    default:
      return "●"; // Default medium
  }
}

/**
 * Get priority color
 */
export function getPriorityColor(priority: number): string {
  switch (priority) {
    case 0:
      return "#a65050"; // Critical - dimmed red
    case 1:
      return "#a67a5a"; // High - dimmed orange
    case 2:
      return "#9a8a5a"; // Medium - dimmed yellow
    case 3:
      return "#4a7ab0"; // Low - dimmed blue
    case 4:
      return "#606060"; // Lowest - dimmed gray
    default:
      return "#9a8a5a";
  }
}

/**
 * Get type color
 */
export function getTypeColor(type: string): string {
  switch (type) {
    case "feature":
      return "#5a9a65"; // Dimmed green
    case "bug":
      return "#a65050"; // Dimmed red
    case "task":
      return "#4a7ab0"; // Dimmed blue
    case "epic":
      return "#8a5a9a"; // Dimmed purple
    case "chore":
      return "#606060"; // Dimmed gray
    default:
      return "#606060";
  }
}

/**
 * Get status label from status string
 */
export function getStatusLabel(status: string): string {
  switch (status) {
    case "open":
      return "Open";
    case "in_progress":
      return "In Progress";
    case "blocked":
      return "Blocked";
    case "closed":
      return "Closed";
    default:
      return capitalize(status);
  }
}
