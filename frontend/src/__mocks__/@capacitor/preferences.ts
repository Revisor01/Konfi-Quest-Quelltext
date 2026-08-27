// Mock für @capacitor/preferences — In-Memory-Store für Tests
const store = new Map<string, string>();

export const clearMockStore = () => {
  store.clear();
};

export const Preferences = {
  get: vi.fn(async ({ key }: { key: string }) => {
    return { value: store.get(key) ?? null };
  }),
  set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
    store.set(key, value);
  }),
  remove: vi.fn(async ({ key }: { key: string }) => {
    store.delete(key);
  }),
  keys: vi.fn(async () => {
    return { keys: Array.from(store.keys()) };
  }),
};
