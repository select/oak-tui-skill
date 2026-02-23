import { execSync } from "node:child_process";

/**
 * Copy text to clipboard using xclip or xsel
 * @param text - The text to copy to clipboard
 * @returns true if successful, false if both xclip and xsel failed
 */
export function copyToClipboard(text: string): boolean {
  // Try xclip first
  try {
    execSync(`echo -n "${text}" | xclip -selection clipboard`, {
      stdio: "ignore",
    });
    return true;
  } catch {
    // Try xsel as fallback
    try {
      execSync(`echo -n "${text}" | xsel --clipboard --input`, {
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  }
}
