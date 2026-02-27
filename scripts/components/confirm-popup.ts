import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import type { Theme } from "../lib/types";
import type { ModalComponents } from "./modal";
import { clearModalContent, showModal, hideModal } from "./modal";
import { basename } from "node:path";

export interface ConfirmDeleteState {
  visible: boolean;
  projectPath: string | null;
}

export function createInitialConfirmDeleteState(): ConfirmDeleteState {
  return {
    visible: false,
    projectPath: null,
  };
}

export function showConfirmDelete(
  state: ConfirmDeleteState,
  projectPath: string,
): void {
  state.visible = true;
  state.projectPath = projectPath;
}

export function hideConfirmDelete(state: ConfirmDeleteState): void {
  state.visible = false;
  state.projectPath = null;
}

/**
 * Renders a centered confirmation popup for project deletion using the modal system.
 * Shows the project path and [d]elete / [c]ancel buttons.
 *
 * @param renderer - The CLI renderer
 * @param modal - Modal components from the UI system
 * @param state - Confirm delete state
 * @param theme - Current theme
 * @param renderCounter - Unique render counter for IDs
 * @param onClose - Callback when modal is closed (cancel action)
 */
export function renderConfirmDeletePopup(
  renderer: Readonly<CliRenderer>,
  modal: ModalComponents,
  state: Readonly<ConfirmDeleteState>,
  theme: Readonly<Theme>,
  renderCounter: number,
  onClose?: () => void,
): void {
  const hasValidPath = state.projectPath !== null && state.projectPath !== "";
  if (!state.visible || !hasValidPath) {
    hideModal(modal);
    return;
  }

  const projectName = basename(state.projectPath);

  // Clear previous modal content
  clearModalContent(modal);

  // Configure modal container styling - use maxWidth for responsive behavior
  // Allow terminal width minus some margin, but cap at reasonable size
  const terminalWidth = process.stdout.columns ?? 80;
  const maxModalWidth = Math.min(60, terminalWidth - 4); // At least 2 chars margin on each side
  const contentWidth = maxModalWidth - 4; // Account for padding (2 on each side)

  modal.container.maxWidth = maxModalWidth;
  modal.container.borderColor = theme.colors.error;
  modal.container.paddingTop = 1;
  modal.container.paddingBottom = 1;
  modal.container.paddingLeft = 2;
  modal.container.paddingRight = 2;

  // Set up click-outside-to-close behavior
  modal.overlay.onMouseDown = (e) => {
    e.stopPropagation();
    if (onClose) {
      setTimeout(() => { onClose(); }, 0);
    }
  };

  const container = modal.container;

  // Title
  const title = new TextRenderable(renderer, {
    id: `confirm-title-${renderCounter}`,
    content: "Delete Project?",
    fg: theme.colors.error,
  });
  container.add(title);

  // Separator
  const sep1 = new TextRenderable(renderer, {
    id: `confirm-sep1-${renderCounter}`,
    content: "─".repeat(Math.max(1, contentWidth)),
    fg: theme.colors.border,
  });
  container.add(sep1);

  // Warning message (wrap text for narrow terminals)
  const warningMsg = "This will remove the project from your recent list.";
  const warningText = new TextRenderable(renderer, {
    id: `confirm-warning-${renderCounter}`,
    content: warningMsg,
    fg: theme.colors.textMuted,
    maxWidth: contentWidth,
  });
  container.add(warningText);

  // Project name
  const projectText = new TextRenderable(renderer, {
    id: `confirm-project-${renderCounter}`,
    content: `Project: ${projectName}`,
    fg: theme.colors.text,
  });
  container.add(projectText);

  // Project path (truncate if too long to fit in modal)
  const pathPrefix = "Path: ";
  const maxPathLength = contentWidth - pathPrefix.length;
  let displayPath = state.projectPath;
  if (displayPath.length > maxPathLength && maxPathLength > 10) {
    // Truncate with ellipsis: show start and end of path
    const ellipsis = "...";
    const keepChars = maxPathLength - ellipsis.length;
    const startChars = Math.floor(keepChars * 0.4);
    const endChars = keepChars - startChars;
    displayPath = displayPath.slice(0, startChars) + ellipsis + displayPath.slice(-endChars);
  }
  
  const pathText = new TextRenderable(renderer, {
    id: `confirm-path-${renderCounter}`,
    content: `${pathPrefix}${displayPath}`,
    fg: theme.colors.textMuted,
  });
  container.add(pathText);

  // Spacer
  const spacer = new TextRenderable(renderer, {
    id: `confirm-spacer-${renderCounter}`,
    content: " ",
    fg: theme.colors.text,
  });
  container.add(spacer);

  // Buttons row
  const buttonsRow = new BoxRenderable(renderer, {
    id: `confirm-buttons-${renderCounter}`,
    flexDirection: "row",
    gap: 2,
    justifyContent: "center",
  });
  container.add(buttonsRow);

  // Delete button
  const deleteBtn = new BoxRenderable(renderer, {
    id: `confirm-delete-btn-${renderCounter}`,
    paddingLeft: 1,
    paddingRight: 1,
    backgroundColor: theme.colors.error,
  });
  buttonsRow.add(deleteBtn);

  const deleteBtnText = new TextRenderable(renderer, {
    id: `confirm-delete-text-${renderCounter}`,
    content: "[d]elete",
    fg: "#ffffff",
  });
  deleteBtn.add(deleteBtnText);

  // Cancel button
  const cancelBtn = new BoxRenderable(renderer, {
    id: `confirm-cancel-btn-${renderCounter}`,
    paddingLeft: 1,
    paddingRight: 1,
    backgroundColor: theme.colors.textMuted,
  });
  buttonsRow.add(cancelBtn);

  const cancelBtnText = new TextRenderable(renderer, {
    id: `confirm-cancel-text-${renderCounter}`,
    content: "[c]ancel",
    fg: "#ffffff",
  });
  cancelBtn.add(cancelBtnText);

  // Separator
  const sep2 = new TextRenderable(renderer, {
    id: `confirm-sep2-${renderCounter}`,
    content: "─".repeat(Math.max(1, contentWidth)),
    fg: theme.colors.border,
  });
  container.add(sep2);

  // Footer hint (adaptive text for narrow terminals)
  const fullHint = "Press [d] to delete, [c] or Escape to cancel";
  const shortHint = "[d] delete / [c] cancel";
  const footerText = contentWidth >= fullHint.length ? fullHint : shortHint;
  
  const footerHint = new TextRenderable(renderer, {
    id: `confirm-footer-${renderCounter}`,
    content: footerText,
    fg: theme.colors.textMuted,
  });
  container.add(footerHint);

  // Show the modal
  showModal(modal);
}
