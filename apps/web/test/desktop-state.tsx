import { createRoot } from 'react-dom/client';
import { App } from '@ormicode/client-ui';
import { electronPlatform } from '@ormicode/client-platform';
import '@ormicode/client-ui/index.css';

window.ormi = {
  request: async (method: string) => ({ v: 1, type: 'res', id: 'req_test', ok: true, body:
    method === 'agents.list' ? { agents: [] } : method === 'project.list' ? { projects: [] }
      : method === 'session.list' ? { sessions: [] } : method === 'session.digest' ? { computedAt: Date.now(), entries: [] }
        : method === 'session.draft.get' ? { text: '' } : {} }),
  onState: listener => listener('online'),
  onEvent() {}, subscribe() {}, unsubscribe() {},
  tokenGet: async () => undefined, tokenSet: async () => {}, tokenClear: async () => {},
  pair: async () => ({ device: 'test' }), unpair: async () => {},
  remote: () => null, linkIsLocal: () => true, storageBackend: () => 'test', hubLabel: () => 'test',
  winMin() {}, winMax() {}, winClose() {}, openPath: async () => '', showItemInFolder() {},
  pickFolder: async () => null, layoutRead: async () => ({ descriptor: null, errors: [] }),
  layoutWrite: async () => {}, openExternal: async () => {}, previewClearData: async () => {},
};

const platform = electronPlatform();
createRoot(document.getElementById('root')!).render(<App platform={platform} />);
