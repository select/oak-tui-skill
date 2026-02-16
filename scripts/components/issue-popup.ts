import {
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  type CliRenderer,
} from "@opentui/core";
import type { BeadsIssue, Theme } from "../lib/types";
import { getTypeColor } from "../lib/beads-manager";

export interface IssuePopupState {
  issue: BeadsIssue | null;
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
  issue: BeadsIssue,
): IssuePopupState {
  return {
    issue,
    scrollOffset: 0,
    visible: true,
  };
}

export function hidePopup(state: IssuePopupState): IssuePopupState {
  return {
    ...state,
    visible: false,
  };
}

export function scrollPopup(
  state: IssuePopupState,
  delta: number,
): IssuePopupState {
  return {
    ...state,
    scrollOffset: Math.max(0, state.scrollOffset + delta),
  };
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

export function renderIssuePopup(
  renderer: CliRenderer,
  parent: BoxRenderable,
  state: IssuePopupState,
  theme: Theme,
  renderCounter: number,
  onClose: () => void,
): void {
  if (!state.visible || !state.issue) return;

  const issue = state.issue;
  const typeColor = getTypeColor(issue.issue_type);

  // Overlay background (semi-transparent effect via darker color)
  const overlay = new BoxRenderable(renderer, {
    id: `popup-overlay-${renderCounter}`,
    width: "100%",
    height: "100%",
    backgroundColor: "#000000",
    onMouseDown: onClose,
  });
  parent.add(overlay);

  // Popup container - centered
  const popup = new BoxRenderable(renderer, {
    id: `popup-container-${renderCounter}`,
    width: "80%",
    height: "80%",
    backgroundColor: theme.colors.backgroundPanel,
    border: true,
    borderStyle: "rounded",
    borderColor: theme.colors.primary,
    flexDirection: "column",
    position: "absolute",
    top: "10%",
    left: "10%",
  });
  overlay.add(popup);

  // Header with type color bar
  const header = new BoxRenderable(renderer, {
    id: `popup-header-${renderCounter}`,
    width: "100%",
    height: 3,
    backgroundColor: theme.colors.backgroundPanel,
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  });
  popup.add(header);

  // Type color indicator
  const typeIndicator = new BoxRenderable(renderer, {
    id: `popup-type-indicator-${renderCounter}`,
    width: 2,
    height: "100%",
    backgroundColor: typeColor,
  });
  header.add(typeIndicator);

  // Title area
  const titleArea = new BoxRenderable(renderer, {
    id: `popup-title-area-${renderCounter}`,
    flexGrow: 1,
    height: "100%",
    paddingLeft: 1,
    flexDirection: "column",
    justifyContent: "center",
  });
  header.add(titleArea);

  // Issue ID
  const idText = new TextRenderable(renderer, {
    id: `popup-id-${renderCounter}`,
    content: issue.id,
    fg: theme.colors.textMuted,
  });
  titleArea.add(idText);

  // Issue title
  const titleText = new TextRenderable(renderer, {
    id: `popup-title-${renderCounter}`,
    content: issue.title,
    fg: theme.colors.text,
  });
  titleArea.add(titleText);

  // Close button
  const closeBtn = new BoxRenderable(renderer, {
    id: `popup-close-btn-${renderCounter}`,
    width: 5,
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    onMouseDown: onClose,
  });
  header.add(closeBtn);

  const closeBtnText = new TextRenderable(renderer, {
    id: `popup-close-text-${renderCounter}`,
    content: "[X]",
    fg: theme.colors.textMuted,
  });
  closeBtn.add(closeBtnText);

  // Metadata bar
  const metaBar = new BoxRenderable(renderer, {
    id: `popup-meta-bar-${renderCounter}`,
    width: "100%",
    height: 1,
    backgroundColor: theme.colors.background,
    flexDirection: "row",
    paddingLeft: 1,
    paddingRight: 1,
    gap: 2,
    flexShrink: 0,
  });
  popup.add(metaBar);

  // Status
  const statusText = new TextRenderable(renderer, {
    id: `popup-status-${renderCounter}`,
    content: `Status: ${STATUS_LABELS[issue.status] || issue.status}`,
    fg: theme.colors.text,
  });
  metaBar.add(statusText);

  // Priority
  const priorityText = new TextRenderable(renderer, {
    id: `popup-priority-${renderCounter}`,
    content: `Priority: ${PRIORITY_LABELS[issue.priority] || issue.priority}`,
    fg: theme.colors.text,
  });
  metaBar.add(priorityText);

  // Type
  const typeText = new TextRenderable(renderer, {
    id: `popup-type-${renderCounter}`,
    content: `Type: ${capitalizeFirst(issue.issue_type)}`,
    fg: typeColor,
  });
  metaBar.add(typeText);

  // Assignee if present
  if (issue.assignee) {
    const assigneeText = new TextRenderable(renderer, {
      id: `popup-assignee-${renderCounter}`,
      content: `Assignee: ${issue.assignee}`,
      fg: theme.colors.text,
    });
    metaBar.add(assigneeText);
  }

  // Content area (scrollable)
  const contentScroll = new ScrollBoxRenderable(renderer, {
    id: `popup-content-scroll-${renderCounter}`,
    width: "100%",
    flexGrow: 1,
    flexDirection: "column",
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 1,
    scrollY: true,
  });
  popup.add(contentScroll);

  // Description section
  if (issue.description) {
    const descLabel = new TextRenderable(renderer, {
      id: `popup-desc-label-${renderCounter}`,
      content: "Description",
      fg: theme.colors.primary,
    });
    contentScroll.add(descLabel);

    // Split description into lines for proper rendering
    const descLines = issue.description.split("\n");
    descLines.forEach((line, idx) => {
      const lineText = new TextRenderable(renderer, {
        id: `popup-desc-line-${renderCounter}-${idx}`,
        content: line || " ", // Empty line placeholder
        fg: theme.colors.text,
      });
      contentScroll.add(lineText);
    });

    // Spacer
    const spacer = new BoxRenderable(renderer, {
      id: `popup-spacer-1-${renderCounter}`,
      width: "100%",
      height: 1,
    });
    contentScroll.add(spacer);
  }

  // Dependencies section
  if (issue.dependency_count > 0 || issue.dependent_count > 0) {
    const depsLabel = new TextRenderable(renderer, {
      id: `popup-deps-label-${renderCounter}`,
      content: "Dependencies",
      fg: theme.colors.primary,
    });
    contentScroll.add(depsLabel);

    if (issue.dependency_count > 0) {
      const blockedByText = new TextRenderable(renderer, {
        id: `popup-blocked-by-${renderCounter}`,
        content: `  Blocked by: ${issue.dependency_count} issue(s)`,
        fg: theme.colors.warning,
      });
      contentScroll.add(blockedByText);
    }

    if (issue.dependent_count > 0) {
      const blocksText = new TextRenderable(renderer, {
        id: `popup-blocks-${renderCounter}`,
        content: `  Blocks: ${issue.dependent_count} issue(s)`,
        fg: theme.colors.info,
      });
      contentScroll.add(blocksText);
    }

    // Spacer
    const spacer2 = new BoxRenderable(renderer, {
      id: `popup-spacer-2-${renderCounter}`,
      width: "100%",
      height: 1,
    });
    contentScroll.add(spacer2);
  }

  // Labels section
  if (issue.labels && issue.labels.length > 0) {
    const labelsLabel = new TextRenderable(renderer, {
      id: `popup-labels-label-${renderCounter}`,
      content: "Labels",
      fg: theme.colors.primary,
    });
    contentScroll.add(labelsLabel);

    const labelsText = new TextRenderable(renderer, {
      id: `popup-labels-text-${renderCounter}`,
      content: `  ${issue.labels.join(", ")}`,
      fg: theme.colors.text,
    });
    contentScroll.add(labelsText);

    // Spacer
    const spacer3 = new BoxRenderable(renderer, {
      id: `popup-spacer-3-${renderCounter}`,
      width: "100%",
      height: 1,
    });
    contentScroll.add(spacer3);
  }

  // Footer with timestamps
  const footer = new BoxRenderable(renderer, {
    id: `popup-footer-${renderCounter}`,
    width: "100%",
    height: 1,
    backgroundColor: theme.colors.background,
    flexDirection: "row",
    paddingLeft: 1,
    paddingRight: 1,
    gap: 2,
    flexShrink: 0,
  });
  popup.add(footer);

  const createdText = new TextRenderable(renderer, {
    id: `popup-created-${renderCounter}`,
    content: `Created: ${formatDate(issue.created_at)}`,
    fg: theme.colors.textMuted,
  });
  footer.add(createdText);

  const updatedText = new TextRenderable(renderer, {
    id: `popup-updated-${renderCounter}`,
    content: `Updated: ${formatDate(issue.updated_at)}`,
    fg: theme.colors.textMuted,
  });
  footer.add(updatedText);

  // Keyboard hints
  const hintsText = new TextRenderable(renderer, {
    id: `popup-hints-${renderCounter}`,
    content: "j/k: scroll  Esc: close",
    fg: theme.colors.textMuted,
  });
  footer.add(hintsText);
}
