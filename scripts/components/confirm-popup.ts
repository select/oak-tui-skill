import { BoxRenderable, TextRenderable, type CliRenderer } from "@opentui/core";
import type { Theme } from "../lib/types";
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
 * Renders a centered confirmation popup for project deletion.
 * Shows the project path and [d]elete / [c]ancel buttons.
 */
export function renderConfirmDeletePopup(
  renderer: Readonly<CliRenderer>,
  parent: Readonly<BoxRenderable>,
  state: Readonly<ConfirmDeleteState>,
  theme: Readonly<Theme>,
  renderCounter: number,
): void {
  if (!state.visible || !state.projectPath) return;

  const projectName = basename(state.projectPath);

  // Popup container - centered
  const popup = new BoxRenderable(renderer, {
    id: `confirm-popup-${renderCounter}`,
    width: 60,
    backgroundColor: theme.colors.backgroundPanel,
    borderColor: theme.colors.error,
    borderStyle: "single",
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 2,
    paddingRight: 2,
    flexDirection: "column",
    gap: 1,
  });
  parent.add(popup);

  // Title
  const title = new TextRenderable(renderer, {
    id: `confirm-title-${renderCounter}`,
    content: "Delete Project?",
    fg: theme.colors.error,
  });
  popup.add(title);

  // Separator
  const sep1 = new TextRenderable(renderer, {
    id: `confirm-sep1-${renderCounter}`,
    content: "─".repeat(56),
    fg: theme.colors.border,
  });
  popup.add(sep1);

  // Warning message
  const warningText = new TextRenderable(renderer, {
    id: `confirm-warning-${renderCounter}`,
    content: "This will remove the project from your recent list.",
    fg: theme.colors.textMuted,
  });
  popup.add(warningText);

  // Project name
  const projectText = new TextRenderable(renderer, {
    id: `confirm-project-${renderCounter}`,
    content: `Project: ${projectName}`,
    fg: theme.colors.text,
  });
  popup.add(projectText);

  // Project path
  const pathText = new TextRenderable(renderer, {
    id: `confirm-path-${renderCounter}`,
    content: `Path: ${state.projectPath}`,
    fg: theme.colors.textMuted,
  });
  popup.add(pathText);

  // Spacer
  const spacer = new TextRenderable(renderer, {
    id: `confirm-spacer-${renderCounter}`,
    content: " ",
    fg: theme.colors.text,
  });
  popup.add(spacer);

  // Buttons row
  const buttonsRow = new BoxRenderable(renderer, {
    id: `confirm-buttons-${renderCounter}`,
    flexDirection: "row",
    gap: 2,
    justifyContent: "center",
  });
  popup.add(buttonsRow);

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
    content: "─".repeat(56),
    fg: theme.colors.border,
  });
  popup.add(sep2);

  // Footer hint
  const footerHint = new TextRenderable(renderer, {
    id: `confirm-footer-${renderCounter}`,
    content: "Press [d] to delete, [c] or Escape to cancel",
    fg: theme.colors.textMuted,
  });
  popup.add(footerHint);
}
