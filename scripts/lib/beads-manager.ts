// Beads issue management - fetching and parsing issues from bd CLI

import { execSync } from "node:child_process";
import type { BeadsIssue, GroupedIssues } from "./types";

/**
 * Fetch all beads issues using bd CLI
 */
export function fetchBeadsIssues(): BeadsIssue[] {
  try {
    const output = execSync("bd list --json", {
      encoding: "utf-8",
      timeout: 5000,
    });
    return JSON.parse(output) as BeadsIssue[];
  } catch {
    return [];
  }
}

/**
 * Fetch ready issues (open with no blockers)
 */
export function fetchReadyIssues(): BeadsIssue[] {
  try {
    const output = execSync("bd ready --json", {
      encoding: "utf-8",
      timeout: 5000,
    });
    return JSON.parse(output) as BeadsIssue[];
  } catch {
    return [];
  }
}

/**
 * Group issues by status for board display
 */
export function groupIssuesByStatus(issues: BeadsIssue[]): GroupedIssues {
  const readyIssues = fetchReadyIssues();
  const readyIds = new Set(readyIssues.map((i) => i.id));

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
      const closedDate = new Date(issue.updated_at).toDateString();
      if (closedDate === today) {
        grouped.closed.push(issue);
      }
    } else if (issue.status === "in_progress") {
      grouped.in_progress.push(issue);
    } else if (issue.status === "blocked") {
      grouped.blocked.push(issue);
    } else if (issue.status === "open") {
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
 */
export function fetchAndGroupIssues(): GroupedIssues {
  const issues = fetchBeadsIssues();
  return groupIssuesByStatus(issues);
}

/**
 * Get total count of issues across all groups
 */
export function getTotalBoardCount(grouped: GroupedIssues): number {
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
  grouped: GroupedIssues,
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
export function getSectionStartIndices(grouped: GroupedIssues): {
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
  grouped: GroupedIssues,
  currentIndex: number,
): number {
  const starts = getSectionStartIndices(grouped);
  const total = getTotalBoardCount(grouped);

  // Determine current section and find next non-empty section
  const sections: (keyof GroupedIssues)[] = [
    "in_progress",
    "ready",
    "blocked",
    "closed",
  ];

  for (let i = 0; i < sections.length - 1; i++) {
    const section = sections[i];
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
  grouped: GroupedIssues,
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
 * Get type icon (single letter)
 */
export function getTypeIcon(type: string): string {
  switch (type) {
    case "feature":
      return "F";
    case "bug":
      return "B";
    case "task":
      return "T";
    case "epic":
      return "E";
    case "chore":
      return "C";
    default:
      return "?";
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
 * Capitalize first letter
 */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
