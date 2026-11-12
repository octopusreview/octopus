import { expect, it } from "bun:test";
import { mergeSavedLogs } from "@/components/indexing-logs";

const entry = (timestamp: number, message: string) => ({ timestamp, message, level: "info" as const });
const text = (logs: { timestamp: number; message: string }[]) => logs.map((log) => `${log.timestamp}:${log.message}`);

it("keeps the old head when a refreshed window has moved forward, including repeated messages", () => {
  const old = [entry(1, "a"), entry(2, "b"), entry(2, "b"), entry(3, "c")];
  const saved = [entry(2, "b"), entry(2, "b"), entry(3, "c"), entry(4, "d")];
  expect(text(mergeSavedLogs(old, saved))).toEqual(["1:a", "2:b", "2:b", "3:c", "4:d"]);
  expect(text(mergeSavedLogs(old, old.slice()))).toEqual(text(old));
});

it("keeps entries from both snapshots when they diverge", () => {
  const old = [entry(1, "a"), entry(2, "b"), entry(3, "c")];
  const saved = [entry(1, "a"), entry(3, "c"), entry(3, "c"), entry(4, "d")];
  expect(text(mergeSavedLogs(old, saved))).toEqual(["1:a", "2:b", "3:c", "3:c", "4:d"]);
});

it("aligns a shorter overlap when equal-timestamp entries reorder", () => {
  const old = [entry(1, "a"), entry(1, "b")];
  const saved = [entry(1, "b"), entry(1, "a"), entry(1, "b")];
  expect(text(mergeSavedLogs(old, saved))).toEqual(["1:b", "1:a", "1:b"]);
});

it("merges a full 500-entry window that moved forward", () => {
  const old = Array.from({ length: 500 }, (_, i) => entry(i, `m${i}`));
  const saved = old.slice(40).concat(Array.from({ length: 40 }, (_, i) => entry(500 + i, `n${i}`)));
  const merged = mergeSavedLogs(old, saved);
  expect(merged.length).toBe(540);
  expect(text(merged.slice(0, 41))).toEqual(text(old.slice(0, 41)));
  expect(text(merged.slice(-40))).toEqual(text(saved.slice(-40)));
});
