// STUB: Pubby real-time disabled for Databricks deployment.
// The chat UI polls ChatQueue.status every 3s instead of receiving live WS events.
// Re-enable by restoring the @getpubby/sdk dependency and setting FEATURES_PUBBY=true.

const enabled = process.env.FEATURES_PUBBY === "true";

type TriggerArgs = unknown[];
type Channel = { trigger: (...args: TriggerArgs) => Promise<void> };

/** No-op Pubby server-side shim. Preserves the .trigger() and channel surface. */
export const pubby = {
  async trigger(...args: TriggerArgs): Promise<void> {
    if (enabled) console.warn("[pubby-stub] FEATURES_PUBBY=true but stub is in use");
    return;
  },
  channel(_name: string): Channel {
    return { trigger: async (..._args) => undefined };
  },
  authenticate(_socketId: string, _channel: string, _data?: Record<string, unknown>): {
    auth: string;
    channel_data?: string;
  } {
    return { auth: "stub:disabled" };
  },
  authenticatePrivateChannel(
    _socketId: string,
    _channel: string,
  ): { auth: string } {
    return { auth: "stub:disabled" };
  },
  authenticatePresenceChannel(
    _socketId: string,
    _channel: string,
    _userId?: string,
    _userInfo?: Record<string, unknown>,
  ): { auth: string; channel_data?: string } {
    return { auth: "stub:disabled", channel_data: JSON.stringify({}) };
  },
};
