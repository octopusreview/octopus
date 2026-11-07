export function localQueueTestDatabaseUrl(value: string | undefined): string {
  let url: URL;
  try {
    url = new URL(value ?? "");
  } catch {
    throw new Error("Queue DB tests require a dedicated local test database");
  }
  const name = url.pathname.slice(1).toLowerCase();
  if (!(["postgres:", "postgresql:"].includes(url.protocol)) ||
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/^[a-z0-9_-]+$/.test(name) || !/(^|[-_])test($|[-_])/.test(name) ||
      url.search || url.hash) {
    throw new Error("Queue DB tests require a dedicated local test database");
  }
  url.hostname = "127.0.0.1";
  return url.toString();
}
