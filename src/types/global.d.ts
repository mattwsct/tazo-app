/**
 * Global type declarations
 */

declare global {
  interface Window {
    RealtimeIRL?: {
      forPullKey: (key: string) => {
        addListener: (cb: (p: unknown) => void) => void;
      };
    };
  }
}

export {};
