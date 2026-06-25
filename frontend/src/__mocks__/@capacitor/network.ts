// Mock fuer @capacitor/network
export const Network = {
  getStatus: vi.fn(async () => ({ connected: true, connectionType: 'wifi' })),
  addListener: vi.fn((_event: string, _callback: (status: { connected: boolean }) => void) => {
    return Promise.resolve({ remove: vi.fn() });
  }),
};
