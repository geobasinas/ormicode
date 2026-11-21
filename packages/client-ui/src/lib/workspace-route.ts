export function codeWorkspaceRoute(lastRoute: string, openTabs: readonly string[]): string {
  return lastRoute !== 'design' && openTabs.includes(lastRoute) ? lastRoute : 'now';
}
