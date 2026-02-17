import {
  BoxRenderable,
  TextRenderable,
  MarkdownRenderable,
  SyntaxStyle,
  RGBA,
  type CliRenderer,
  type MouseEvent,
} from "@opentui/core";
import type { BeadsIssue, Theme, ReadonlyBeadsIssue } from "../lib/types";
import { getTypeColor } from "../lib/beads-manager";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DEBUG_LOG_PATH = join(homedir(), ".local/share/oak-tui/debug.log");
function debugLog(message: string) {
  const timestamp = new Date().toLocaleTimeString();
  appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] [issue-popup] ${message}\n`);
}

export interface IssuePopupState {
  issue: BeadsIssue | ReadonlyBeadsIssue | null;
  scrollOffset: number;
  visible: boolean;
}

export function createInitialPopupState(): IssuePopupState {
  return {
    issue: null,
    scrollOffset: 0,
    visible: false,
  };
}

export function showPopup(
  state: IssuePopupState,
  issue: Readonly<BeadsIssue>,
): void {
  state.issue = issue;
  state.scrollOffset = 0;
  state.visible = true;
}

export function hidePopup(state: IssuePopupState): void {
  state.visible = false;
}

export function scrollPopup(state: IssuePopupState, delta: number): void {
  state.scrollOffset = Math.max(0, state.scrollOffset + delta);
}

// Priority labels
const PRIORITY_LABELS: Record<number, string> = {
  0: "Critical",
  1: "High",
  2: "Medium",
  3: "Low",
  4: "Lowest",
};

// Status display
const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  blocked: "Blocked",
  closed: "Closed",
};

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Renders issue details directly into the parent container.
 * This replaces the board content when the popup is visible.
 */
export function renderIssuePopup(
  renderer: Readonly<CliRenderer>,
  parent: Readonly<BoxRenderable>,
  state: Readonly<IssuePopupState>,
  theme: Readonly<Theme>,
  renderCounter: number,
  onClose?: () => void,
): void {
  if (!state.visible || !state.issue) return;

  const issue = state.issue;
  const typeColor = getTypeColor(issue.issue_type);

  // Header row with content on left and close button on right
  const headerRow = new BoxRenderable(renderer, {
    id: `popup-header-row-${renderCounter}`,
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  });
  parent.add(headerRow);

  // Left side: type indicator + ID
  const headerLeft = new BoxRenderable(renderer, {
    id: `popup-header-left-${renderCounter}`,
    flexDirection: "row",
    alignItems: "center",
    gap: 1,
  });
  headerRow.add(headerLeft);

  // Type color indicator
  const typeIndicator = new BoxRenderable(renderer, {
    id: `popup-type-indicator-${renderCounter}`,
    width: 2,
    height: 1,
    backgroundColor: typeColor,
  });
  headerLeft.add(typeIndicator);

  // Issue ID
  const idText = new TextRenderable(renderer, {
    id: `popup-id-${renderCounter}`,
    content: issue.id,
    fg: theme.colors.textMuted,
  });
  headerLeft.add(idText);

  // Close button on right
  if (onClose) {
    debugLog("Creating close button with onMouseDown handler");
    const closeBtn = new BoxRenderable(renderer, {
      id: `popup-close-btn-${renderCounter}`,
      paddingLeft: 1,
      paddingRight: 1,
      backgroundColor: theme.colors.error,
      onMouseDown: (e: MouseEvent) => {
        debugLog("Close button clicked!");
        e.stopPropagation();
        setTimeout(() => {
          debugLog("Calling onClose callback");
          onClose();
        }, 0);
      },
    });
    headerRow.add(closeBtn);

    const closeBtnText = new TextRenderable(renderer, {
      id: `popup-close-btn-text-${renderCounter}`,
      content: "X",
      fg: "#ffffff",
    });
    closeBtn.add(closeBtnText);
  }

  // Issue title
  const titleText = new TextRenderable(renderer, {
    id: `popup-title-${renderCounter}`,
    content: issue.title,
    fg: theme.colors.text,
  });
  parent.add(titleText);

  // Separator
  const sep1 = new TextRenderable(renderer, {
    id: `popup-sep1-${renderCounter}`,
    content: "─".repeat(60),
    fg: theme.colors.border,
  });
  parent.add(sep1);

  // Metadata line
  const metaLine = new TextRenderable(renderer, {
    id: `popup-meta-${renderCounter}`,
    content: `Status: ${STATUS_LABELS[issue.status] ?? issue.status}  │  Priority: ${PRIORITY_LABELS[issue.priority] ?? issue.priority}  │  Type: ${capitalizeFirst(issue.issue_type)}${issue.assignee != null ? `  │  Assignee: ${issue.assignee}` : ""}`,
    fg: theme.colors.text,
  });
  parent.add(metaLine);

  // Empty line
  const spacer1 = new TextRenderable(renderer, {
    id: `popup-spacer1-${renderCounter}`,
    content: " ",
    fg: theme.colors.text,
  });
  parent.add(spacer1);

  // Description section
  if (issue.description != null && issue.description !== "") {
    const descLabel = new TextRenderable(renderer, {
      id: `popup-desc-label-${renderCounter}`,
      content: "Description",
      fg: theme.colors.primary,
    });
    parent.add(descLabel);

    // Use MarkdownRenderable for formatted description with dimmed text
    const dimmedTextColor = RGBA.fromHex(theme.colors.textMuted);
    const syntaxStyle = SyntaxStyle.fromStyles({
      text: { fg: dimmedTextColor },
      paragraph: { fg: dimmedTextColor },
      heading: { fg: RGBA.fromHex(theme.colors.text), bold: true },
      "heading.1": { fg: RGBA.fromHex(theme.colors.primary), bold: true },
      "heading.2": { fg: RGBA.fromHex(theme.colors.text), bold: true },
      strong: { fg: RGBA.fromHex(theme.colors.text), bold: true },
      emphasis: { fg: dimmedTextColor, italic: true },
      "code.inline": { fg: RGBA.fromHex(theme.colors.primary) },
      "code.block": { fg: dimmedTextColor },
      link: { fg: RGBA.fromHex(theme.colors.info), underline: true },
      list: { fg: dimmedTextColor },
      "list.marker": { fg: RGBA.fromHex(theme.colors.primary) },
    });
    const descMarkdown = new MarkdownRenderable(renderer, {
      id: `popup-desc-md-${renderCounter}`,
      content: issue.description,
      syntaxStyle: syntaxStyle,
      conceal: true,
    });
    parent.add(descMarkdown);

    // Spacer
    const spacer2 = new TextRenderable(renderer, {
      id: `popup-spacer2-${renderCounter}`,
      content: " ",
      fg: theme.colors.text,
    });
    parent.add(spacer2);
  }

  // Dependencies section
  if (issue.dependency_count > 0 || issue.dependent_count > 0) {
    const depsLabel = new TextRenderable(renderer, {
      id: `popup-deps-label-${renderCounter}`,
      content: "Dependencies",
      fg: theme.colors.primary,
    });
    parent.add(depsLabel);

    if (issue.dependency_count > 0) {
      const blockedByText = new TextRenderable(renderer, {
        id: `popup-blocked-by-${renderCounter}`,
        content: `  Blocked by: ${issue.dependency_count} issue(s)`,
        fg: theme.colors.warning,
      });
      parent.add(blockedByText);
    }

    if (issue.dependent_count > 0) {
      const blocksText = new TextRenderable(renderer, {
        id: `popup-blocks-${renderCounter}`,
        content: `  Blocks: ${issue.dependent_count} issue(s)`,
        fg: theme.colors.info,
      });
      parent.add(blocksText);
    }

    // Spacer
    const spacer3 = new TextRenderable(renderer, {
      id: `popup-spacer3-${renderCounter}`,
      content: " ",
      fg: theme.colors.text,
    });
    parent.add(spacer3);
  }

  // Labels section
  if (issue.labels && issue.labels.length > 0) {
    const labelsLabel = new TextRenderable(renderer, {
      id: `popup-labels-label-${renderCounter}`,
      content: "Labels",
      fg: theme.colors.primary,
    });
    parent.add(labelsLabel);

    const labelsText = new TextRenderable(renderer, {
      id: `popup-labels-text-${renderCounter}`,
      content: `  ${issue.labels.join(", ")}`,
      fg: theme.colors.text,
    });
    parent.add(labelsText);

    // Spacer
    const spacer4 = new TextRenderable(renderer, {
      id: `popup-spacer4-${renderCounter}`,
      content: " ",
      fg: theme.colors.text,
    });
    parent.add(spacer4);
  }

  // Separator
  const sep2 = new TextRenderable(renderer, {
    id: `popup-sep2-${renderCounter}`,
    content: "─".repeat(60),
    fg: theme.colors.border,
  });
  parent.add(sep2);

  // Timestamps
  const timestampsText = new TextRenderable(renderer, {
    id: `popup-timestamps-${renderCounter}`,
    content: `Created: ${formatDate(issue.created_at)}  │  Updated: ${formatDate(issue.updated_at)}`,
    fg: theme.colors.textMuted,
  });
  parent.add(timestampsText);

  // Footer hint
  const footerHint = new TextRenderable(renderer, {
    id: `popup-footer-hint-${renderCounter}`,
    content: "Press Escape to close",
    fg: theme.colors.textMuted,
  });
  parent.add(footerHint);
}
