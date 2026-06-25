// Mock fuer @capacitor/core
export const Capacitor = {
  isNativePlatform: vi.fn(() => false),
  getPlatform: vi.fn(() => 'web'),
};

export const registerPlugin = vi.fn(() => ({}));
