// Shared debug utilities for the oak-tui application

import { appendFileSync } from "node:fs";
import { homedir } from "node:os";

const DEBUG_LOG_PATH = `${homedir()}/.local/share/oak-tui/debug.log`;

/**
 * Shared debug logger that can be enabled/disabled
 * This is a mutable reference that modules can update via setDebugFn
 */
let debugFn: (...args: readonly unknown[]) => void = () => {};

/**
 * Debug function that modules can call
 * The actual implementation is set via setDebugFn
 */
export function debug(...args: readonly unknown[]): void {
  debugFn(...args);
}

/**
 * Set the debug function implementation
 * This properly updates the closure variable instead of using broken Object.assign
 */
export function setDebugFn(fn: (...args: readonly unknown[]) => void): void {
  debugFn = fn;
}

/**
 * Create a debug logger that writes to the debug log file
 * @param enabled - Whether debug logging is enabled
 * @param prefix - Optional prefix for log messages (e.g., module name)
 */
export function createDebugLogger(
  enabled: boolean,
  prefix?: string,
): (...args: readonly unknown[]) => void {
  if (!enabled) {
    return () => {};
  }

  return (...args: readonly unknown[]): void => {
    const timestamp = new Date().toLocaleTimeString();
    const message = args
      .map((a) => {
        if (typeof a === "string") return a;
        if (typeof a === "number" || typeof a === "boolean") return String(a);
        if (a === null) return "null";
        if (a === undefined) return "undefined";
        return JSON.stringify(a);
      })
      .join(" ");
    const prefixStr = prefix ? `[${prefix}] ` : "";
    appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] ${prefixStr}${message}\n`);
  };
}

/**
 * Path to the debug log file
 */
export const DEBUG_LOG_PATH_CONST = DEBUG_LOG_PATH;
