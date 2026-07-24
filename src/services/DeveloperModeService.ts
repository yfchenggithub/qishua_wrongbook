// Developer mode is intentionally process-local so every App restart defaults to hidden.
let isDeveloperModeEnabled = false;

export function getSessionDeveloperModeEnabled(): boolean {
  return isDeveloperModeEnabled;
}

export function setSessionDeveloperModeEnabled(enabled: boolean): void {
  isDeveloperModeEnabled = enabled;
}
