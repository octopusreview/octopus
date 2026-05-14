"use client";

// STUB: Pubby client-side disabled for Databricks deployment.
// UI components that subscribed to live channels should fall back to polling.

type Channel = {
  bind: (event: string, cb: (data: unknown) => void) => void;
  unbind: (event: string, cb?: (data: unknown) => void) => void;
  unbind_all: () => void;
  unbindAll: () => void;
};

type StubPubby = {
  subscribe: (channelName: string) => Channel;
  unsubscribe: (channelName: string) => void;
  disconnect: () => void;
};

let instance: StubPubby | null = null;

export function getPubbyClient(): StubPubby {
  if (!instance) {
    instance = {
      subscribe: (_name) => ({
        bind: () => undefined,
        unbind: () => undefined,
        unbind_all: () => undefined,
        unbindAll: () => undefined,
      }),
      unsubscribe: () => undefined,
      disconnect: () => undefined,
    };
  }
  return instance;
}
