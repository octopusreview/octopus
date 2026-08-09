import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const probePath = resolve(
  import.meta.dir,
  "../../../../terraform/modules/aws/ec2-app/scripts/probe_redis.js",
);
const requireFromHere = createRequire(import.meta.url);
type ProbeCredentials = { endpoint: URL; username: string; password: string };
type SocketOptions = {
  credentials: ProbeCredentials;
  socketFactory: () => FakeSocket;
};

class FakeSocket extends EventEmitter {
  destroyed = false;
  writes: Buffer[] = [];

  setTimeout() {}

  write(value: Buffer) {
    this.writes.push(value);
    return true;
  }

  destroy(error?: Error) {
    this.destroyed = true;
    if (error) this.emit("error", error);
    this.emit("close");
  }
}

const {
  RedisConnection,
  encodeCommand,
  isAuthenticationRequired,
  parseReply,
  withDeadline,
} = requireFromHere(probePath) as {
  RedisConnection: new (options: SocketOptions) => {
    ready: (authenticate?: boolean) => Promise<void>;
    command: (...parts: unknown[]) => Promise<unknown>;
  };
  encodeCommand: (parts: unknown[]) => Buffer;
  isAuthenticationRequired: (error: unknown) => boolean;
  parseReply: (
    buffer: Buffer,
    offset?: number,
  ) => { value: unknown; offset: number } | null;
  withDeadline: <T>(operation: Promise<T>, timeoutMs: number) => Promise<T>;
};

const credentials: ProbeCredentials = {
  endpoint: new URL("rediss://octopus:password@redis.internal:6379"),
  username: "octopus",
  password: "password",
};

describe("Terraform authenticated Redis probe protocol", () => {
  it("encodes RESP commands using byte lengths", () => {
    expect(encodeCommand(["SET", "presence:test", "✓"]).toString()).toBe(
      "*3\r\n$3\r\nSET\r\n$13\r\npresence:test\r\n$3\r\n✓\r\n",
    );
  });

  it("waits for complete bulk and array responses", () => {
    expect(parseReply(Buffer.from("$5\r\nhel"))).toBeNull();
    expect(parseReply(Buffer.from("*3\r\n$7\r\nmessage\r\n$13\r\noctopus:probe\r\n"))).toBeNull();

    const reply = parseReply(
      Buffer.from("*3\r\n$7\r\nmessage\r\n$13\r\noctopus:probe\r\n$5\r\nnonce\r\n"),
    );
    expect(reply?.value).toEqual(["message", "octopus:probe", "nonce"]);
  });

  it("parses scalar, null, and permission-error responses", () => {
    expect(parseReply(Buffer.from("+OK\r\n"))?.value).toBe("OK");
    expect(parseReply(Buffer.from(":7\r\n"))?.value).toBe(7);
    expect(parseReply(Buffer.from("$-1\r\n"))?.value).toBeNull();

    const denied = parseReply(Buffer.from("-NOPERM denied\r\n"))?.value;
    expect(denied).toBeInstanceOf(Error);
    expect((denied as Error).message).toContain("NOPERM");
  });

  it("fails when TLS closes before the secure handshake", async () => {
    const socket = new FakeSocket();
    const connection = new RedisConnection({ credentials, socketFactory: () => socket });

    socket.destroyed = true;
    socket.emit("close");

    await expect(connection.ready(false)).rejects.toThrow("connection closed");
  });

  it("rejects pending and later commands when TLS closes cleanly", async () => {
    const socket = new FakeSocket();
    const connection = new RedisConnection({ credentials, socketFactory: () => socket });
    socket.emit("secureConnect");
    await connection.ready(false);

    const pending = connection.command("GET", "mx:v1:test");
    socket.destroyed = true;
    socket.emit("end");

    await expect(pending).rejects.toThrow("connection ended");
    await expect(connection.command("GET", "mx:v1:test")).rejects.toThrow(
      "connection ended",
    );
  });

  it("fails a probe that exceeds its hard deadline", async () => {
    await expect(withDeadline(new Promise(() => {}), 5)).rejects.toThrow(
      "deadline exceeded",
    );
  });

  it("accepts only NOAUTH as proof that anonymous Redis access is disabled", () => {
    expect(isAuthenticationRequired(new Error("NOAUTH Authentication required."))).toBe(
      true,
    );
    expect(isAuthenticationRequired(new Error("NOPERM this user has no permissions"))).toBe(
      false,
    );
    expect(isAuthenticationRequired(new Error("WRONGPASS invalid credentials"))).toBe(
      false,
    );
  });
});
