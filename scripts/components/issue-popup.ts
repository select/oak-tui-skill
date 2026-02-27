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
import type { ModalComponents } from "./modal";
import { clearModalContent, showModal, hideModal } from "./modal";
import {
  getTypeColor,
  getPriorityLabel,
  getStatusLabel,
} from "../lib/beads-manager";
import { capitalize } from "../lib/string-utils";
import { createDebugLogger } from "../lib/debug-utils";

const debugLog = createDebugLogger(
  process.argv.includes("--debug"),
  "issue-popup",
);

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

/**
 * Renders issue details into the modal container.
 * Uses the modal system for overlay and centering.
 *
 * @param renderer - The CLI renderer
 * @param modal - Modal components from the UI system
 * @param state - Issue popup state
 * @param theme - Current theme
 * @param renderCounter - Unique render counter for IDs
 * @param onClose - Callback when modal is closed
 */
export function renderIssuePopup(
  renderer: Readonly<CliRenderer>,
  modal: ModalComponents,
  state: Readonly<IssuePopupState>,
  theme: Readonly<Theme>,
  renderCounter: number,
  onClose?: () => void,
): void {
  if (!state.visible || !state.issue) {
    hideModal(modal);
    return;
  }

  const issue = state.issue;
  const typeColor = getTypeColor(issue.issue_type);

  // Clear previous modal content
  clearModalContent(modal);

  // Configure modal container styling - use percentage for responsive width
  modal.container.width = "90%";
  modal.container.maxWidth = 70;
  modal.container.maxHeight = "80%";
  modal.container.borderColor = theme.colors.border;
  modal.container.paddingTop = 1;
  modal.container.paddingBottom = 1;
  modal.container.paddingLeft = 2;
  modal.container.paddingRight = 2;

  // Set up click-outside-to-close behavior
  modal.overlay.onMouseDown = (e) => {
    e.stopPropagation();
    if (onClose) {
      debugLog("Overlay clicked, closing modal");
      setTimeout(() => { onClose(); }, 0);
    }
  };

  const container = modal.container;

  // Header row with content on left and close button on right
  const headerRow = new BoxRenderable(renderer, {
    id: `popup-header-row-${renderCounter}`,
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  });
  container.add(headerRow);

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
  container.add(titleText);

  // Separator
  const sep1 = new TextRenderable(renderer, {
    id: `popup-sep1-${renderCounter}`,
    content: "─".repeat(64),
    fg: theme.colors.border,
  });
  container.add(sep1);

  // Metadata line
  const metaLine = new TextRenderable(renderer, {
    id: `popup-meta-${renderCounter}`,
    content: `Status: ${getStatusLabel(issue.status)}  │  Priority: ${getPriorityLabel(issue.priority)}  │  Type: ${capitalize(issue.issue_type)}${issue.assignee != null ? `  │  Assignee: ${issue.assignee}` : ""}`,
    fg: theme.colors.text,
  });
  container.add(metaLine);

  // Empty line
  const spacer1 = new TextRenderable(renderer, {
    id: `popup-spacer1-${renderCounter}`,
    content: " ",
    fg: theme.colors.text,
  });
  container.add(spacer1);

  // Description section
  if (issue.description != null && issue.description !== "") {
    const descLabel = new TextRenderable(renderer, {
      id: `popup-desc-label-${renderCounter}`,
      content: "Description",
      fg: theme.colors.primary,
    });
    container.add(descLabel);

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
    container.add(descMarkdown);

    // Spacer
    const spacer2 = new TextRenderable(renderer, {
      id: `popup-spacer2-${renderCounter}`,
      content: " ",
      fg: theme.colors.text,
    });
    container.add(spacer2);
  }

  // Dependencies section
  if (issue.dependency_count > 0 || issue.dependent_count > 0) {
    const depsLabel = new TextRenderable(renderer, {
      id: `popup-deps-label-${renderCounter}`,
      content: "Dependencies",
      fg: theme.colors.primary,
    });
    container.add(depsLabel);

    if (issue.dependency_count > 0) {
      const blockedByText = new TextRenderable(renderer, {
        id: `popup-blocked-by-${renderCounter}`,
        content: `  Blocked by: ${issue.dependency_count} issue(s)`,
        fg: theme.colors.warning,
      });
      container.add(blockedByText);
    }

    if (issue.dependent_count > 0) {
      const blocksText = new TextRenderable(renderer, {
        id: `popup-blocks-${renderCounter}`,
        content: `  Blocks: ${issue.dependent_count} issue(s)`,
        fg: theme.colors.info,
      });
      container.add(blocksText);
    }

    // Spacer
    const spacer3 = new TextRenderable(renderer, {
      id: `popup-spacer3-${renderCounter}`,
      content: " ",
      fg: theme.colors.text,
    });
    container.add(spacer3);
  }

  // Labels section
  if (issue.labels && issue.labels.length > 0) {
    const labelsLabel = new TextRenderable(renderer, {
      id: `popup-labels-label-${renderCounter}`,
      content: "Labels",
      fg: theme.colors.primary,
    });
    container.add(labelsLabel);

    const labelsText = new TextRenderable(renderer, {
      id: `popup-labels-text-${renderCounter}`,
      content: `  ${issue.labels.join(", ")}`,
      fg: theme.colors.text,
    });
    container.add(labelsText);

    // Spacer
    const spacer4 = new TextRenderable(renderer, {
      id: `popup-spacer4-${renderCounter}`,
      content: " ",
      fg: theme.colors.text,
    });
    container.add(spacer4);
  }

  // Separator
  const sep2 = new TextRenderable(renderer, {
    id: `popup-sep2-${renderCounter}`,
    content: "─".repeat(64),
    fg: theme.colors.border,
  });
  container.add(sep2);

  // Timestamps
  const timestampsText = new TextRenderable(renderer, {
    id: `popup-timestamps-${renderCounter}`,
    content: `Created: ${formatDate(issue.created_at)}  │  Updated: ${formatDate(issue.updated_at)}`,
    fg: theme.colors.textMuted,
  });
  container.add(timestampsText);

  // Footer hint
  const footerHint = new TextRenderable(renderer, {
    id: `popup-footer-hint-${renderCounter}`,
    content: "Press Escape to close",
    fg: theme.colors.textMuted,
  });
  container.add(footerHint);

  // Show the modal
  showModal(modal);
}
