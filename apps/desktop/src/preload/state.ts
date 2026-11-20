export function subscribeState(callback: (state: string) => void, listen: (callback: (state: string) => void) => void, snapshot: () => Promise<string>): void {
  let receivedEvent = false;
  listen(state => { receivedEvent = true; callback(state); });
  void snapshot().then(state => { if (!receivedEvent) callback(state); }).catch(() => undefined);
}
