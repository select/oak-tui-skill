/**
 * Modal system with dimmed overlay background.
 *
 * Provides a reusable modal container that:
 * - Renders a semi-transparent overlay covering the entire screen
 * - Centers modal content within the overlay
 * - Supports click-outside-to-close behavior
 * - Uses absolute positioning with zIndex for proper layering
 */

import {
  BoxRenderable,
  RGBA,
  type CliRenderer,
  type MouseEvent,
} from "@opentui/core";
import type { Theme } from "../lib/types";

export interface ModalState {
  visible: boolean;
}

export interface ModalComponents {
  /** Full-screen overlay with semi-transparent background */
  overlay: BoxRenderable;
  /** Centered container for modal content */
  container: BoxRenderable;
}

/**
 * Creates the modal overlay and container components.
 * These should be added to the root renderable AFTER all other children
 * so they render on top.
 *
 * @param renderer - The CLI renderer instance
 * @param theme - Current theme for styling
 * @param onClose - Callback when clicking outside modal or overlay
 * @returns Modal components (overlay and container)
 */
export function createModalComponents(
  renderer: Readonly<CliRenderer>,
  theme: Readonly<Theme>,
  onClose?: () => void,
): ModalComponents {
  // Full-screen overlay with semi-transparent dark background
  // The alpha channel creates a dimmed effect over the content behind
  const overlay = new BoxRenderable(renderer, {
    id: "modal-overlay",
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    // Semi-transparent black overlay (0.7 opacity = 70% dark)
    backgroundColor: RGBA.fromValues(0, 0, 0, 0.7),
    zIndex: 100,
    visible: false,
    // Center the modal container
    justifyContent: "center",
    alignItems: "center",
    // Click on overlay (outside modal) closes the modal
    onMouseDown: (e: MouseEvent) => {
      // Only close if clicking directly on overlay, not on children
      if (onClose) {
        e.stopPropagation();
        setTimeout(() => { onClose(); }, 0);
      }
    },
  });

  // Modal container - centered box that holds the actual modal content
  const container = new BoxRenderable(renderer, {
    id: "modal-container",
    flexDirection: "column",
    backgroundColor: theme.colors.backgroundPanel,
    borderStyle: "single",
    borderColor: theme.colors.border,
    // Prevent clicks on container from closing the modal
    onMouseDown: (e: MouseEvent) => {
      e.stopPropagation();
    },
  });

  overlay.add(container);

  return { overlay, container };
}

/**
 * Shows the modal by setting overlay visibility to true.
 */
export function showModal(modal: ModalComponents): void {
  modal.overlay.visible = true;
}

/**
 * Hides the modal by setting overlay visibility to false.
 */
export function hideModal(modal: ModalComponents): void {
  modal.overlay.visible = false;
}

/**
 * Checks if the modal is currently visible.
 */
export function isModalVisible(modal: Readonly<ModalComponents>): boolean {
  return modal.overlay.visible;
}

/**
 * Clears the modal container content.
 * Call this before rendering new content into the modal.
 */
export function clearModalContent(modal: ModalComponents): void {
  const children = modal.container.getChildren();
  for (const child of children) {
    modal.container.remove(child.id);
  }
}

/**
 * Updates modal colors based on current theme.
 */
export function updateModalColors(
  modal: ModalComponents,
  theme: Readonly<Theme>,
): void {
  modal.container.backgroundColor = theme.colors.backgroundPanel;
  modal.container.borderColor = theme.colors.border;
}
