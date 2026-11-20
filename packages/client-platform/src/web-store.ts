export interface WebRemote {
  account: string;
  device: string;
  name: string;
}

export interface WebStore {
  getToken(): Promise<string | undefined>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  getRemote(): Promise<WebRemote | null>;
  setRemote(remote: WebRemote): Promise<void>;
  clear(): Promise<void>;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

export class IndexedDbWebStore implements WebStore {
  private database?: Promise<IDBDatabase>;

  private db(): Promise<IDBDatabase> {
    this.database ??= new Promise((resolve, reject) => {
      const open = indexedDB.open('ormicode', 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('token')) db.createObjectStore('token');
        if (!db.objectStoreNames.contains('remote')) db.createObjectStore('remote');
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error ?? new Error('Could not open IndexedDB'));
    });
    return this.database;
  }

  async getToken(): Promise<string | undefined> {
    const tx = (await this.db()).transaction('token', 'readonly');
    const value = await request(tx.objectStore('token').get('device'));
    return typeof value === 'string' ? value : undefined;
  }

  async setToken(token: string): Promise<void> {
    const tx = (await this.db()).transaction('token', 'readwrite');
    tx.objectStore('token').put(token, 'device');
    await transactionDone(tx);
  }

  async clearToken(): Promise<void> {
    const tx = (await this.db()).transaction('token', 'readwrite');
    tx.objectStore('token').delete('device');
    await transactionDone(tx);
  }

  async getRemote(): Promise<WebRemote | null> {
    const tx = (await this.db()).transaction('remote', 'readonly');
    const value = await request(tx.objectStore('remote').get('device'));
    if (!value || typeof value !== 'object') return null;
    const remote = value as Partial<WebRemote>;
    return typeof remote.account === 'string' && typeof remote.device === 'string' && typeof remote.name === 'string'
      ? { account: remote.account, device: remote.device, name: remote.name } : null;
  }

  async setRemote(remote: WebRemote): Promise<void> {
    const tx = (await this.db()).transaction('remote', 'readwrite');
    tx.objectStore('remote').put(remote, 'device');
    await transactionDone(tx);
  }

  async clear(): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['token', 'remote'], 'readwrite');
    tx.objectStore('token').clear();
    tx.objectStore('remote').clear();
    await transactionDone(tx);
  }
}
