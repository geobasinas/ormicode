export function codeWorkspaceRoute(lastRoute: string, openTabs: readonly string[]): string {
  return lastRoute !== 'design' && lastRoute !== 'settings' && openTabs.includes(lastRoute) ? lastRoute : 'now';
}
