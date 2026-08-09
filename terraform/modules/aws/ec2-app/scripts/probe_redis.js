"use strict";

const { randomBytes } = require("node:crypto");
const tls = require("node:tls");

function redisEndpoint() {
  const endpoint = new URL(process.env.REDIS_URL || "");
  const username = decodeURIComponent(endpoint.username);
  const password = decodeURIComponent(endpoint.password);
  if (endpoint.protocol !== "rediss:" || !endpoint.hostname || !username || !password) {
    throw new Error("invalid Redis URL");
  }
  return { endpoint, username, password };
}

function encodeCommand(parts) {
  const chunks = [Buffer.from(`*${parts.length}\r\n`)];
  for (const part of parts) {
    const value = Buffer.from(String(part));
    chunks.push(Buffer.from(`$${value.length}\r\n`), value, Buffer.from("\r\n"));
  }
  return Buffer.concat(chunks);
}

function parseReply(buffer, offset = 0) {
  if (offset >= buffer.length) return null;
  const prefix = String.fromCharCode(buffer[offset]);
  const lineEnd = buffer.indexOf("\r\n", offset + 1);
  if (lineEnd < 0) return null;
  const line = buffer.toString("utf8", offset + 1, lineEnd);
  const next = lineEnd + 2;

  if (prefix === "+") return { value: line, offset: next };
  if (prefix === "-") return { value: new Error(line), offset: next };
  if (prefix === ":") return { value: Number(line), offset: next };
  if (prefix === "$") {
    const length = Number(line);
    if (length === -1) return { value: null, offset: next };
    if (!Number.isInteger(length) || length < 0 || buffer.length < next + length + 2) {
      return null;
    }
    return {
      value: buffer.toString("utf8", next, next + length),
      offset: next + length + 2,
    };
  }
  if (prefix === "*") {
    const length = Number(line);
    if (length === -1) return { value: null, offset: next };
    if (!Number.isInteger(length) || length < 0) return null;
    const values = [];
    let cursor = next;
    for (let index = 0; index < length; index += 1) {
      const parsed = parseReply(buffer, cursor);
      if (!parsed) return null;
      values.push(parsed.value);
      cursor = parsed.offset;
    }
    return { value: values, offset: cursor };
  }
  return { value: new Error("unsupported Redis response"), offset: next };
}

class RedisConnection {
  constructor(options = {}) {
    const { endpoint, username, password } = options.credentials || redisEndpoint();
    const socketFactory = options.socketFactory || tls.connect;
    this.username = username;
    this.password = password;
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.onPush = null;
    this.terminalError = null;
    this.socket = socketFactory({
      host: endpoint.hostname,
      port: Number(endpoint.port || "6379"),
      servername: endpoint.hostname,
      rejectUnauthorized: true,
    });
    this.connected = new Promise((resolve, reject) => {
      let settled = false;
      this.resolveConnected = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      this.rejectConnected = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
    });
    this.socket.once("secureConnect", this.resolveConnected);
    this.socket.setTimeout(5000);
    this.socket.on("timeout", () => this.socket.destroy(new Error("timeout")));
    this.socket.on("error", (error) => this.fail(error));
    this.socket.on("end", () => this.fail(new Error("Redis connection ended")));
    this.socket.on("close", () => this.fail(new Error("Redis connection closed")));
    this.socket.on("data", (data) => {
      this.buffer = Buffer.concat([this.buffer, data]);
      this.drain();
    });
  }

  async ready(authenticate = true) {
    await this.connected;
    if (authenticate && (await this.command("AUTH", this.username, this.password)) !== "OK") {
      throw new Error("authentication");
    }
  }

  command(...parts) {
    if (this.terminalError || this.socket.destroyed) {
      return Promise.reject(this.terminalError || new Error("Redis connection closed"));
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      this.pending.push(waiter);
      try {
        this.socket.write(encodeCommand(parts));
      } catch (error) {
        const index = this.pending.indexOf(waiter);
        if (index >= 0) this.pending.splice(index, 1);
        reject(error);
      }
    });
  }

  drain() {
    while (this.buffer.length > 0) {
      const parsed = parseReply(this.buffer);
      if (!parsed) return;
      this.buffer = this.buffer.subarray(parsed.offset);
      const waiter = this.pending.shift();
      if (waiter) {
        if (parsed.value instanceof Error) waiter.reject(parsed.value);
        else waiter.resolve(parsed.value);
      } else if (this.onPush) {
        this.onPush(parsed.value);
      }
    }
  }

  rejectAll(error) {
    for (const waiter of this.pending.splice(0)) waiter.reject(error);
  }

  fail(error) {
    if (!this.terminalError) this.terminalError = error;
    this.rejectConnected(this.terminalError);
    this.rejectAll(this.terminalError);
  }

  disconnect() {
    this.socket.destroy();
  }
}

function withDeadline(operation, timeoutMs) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Redis probe deadline exceeded")), timeoutMs);
  });
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timer));
}

function isAuthenticationRequired(error) {
  return error instanceof Error && /^NOAUTH(?:\s|$)/.test(error.message);
}

async function probe() {
  const nonce = randomBytes(12).toString("hex");
  const rateKey = `rl:avatar-upload:redis-probe:${nonce}`;
  const mxKey = `mx:v1:redis-probe:${nonce}`;
  const presenceKey = `presence:redis-probe:${nonce}`;
  const presenceIndexKey = `presence:index:redis-probe:${nonce}`;
  const replayKey = `gh:install:state:jti:redis-probe:${nonce}`;
  const channel = "octopus:probe";
  const command = new RedisConnection();
  const publisher = new RedisConnection();
  const subscriber = new RedisConnection();

  try {
    await Promise.all([command.ready(), publisher.ready(), subscriber.ready()]);
    if (typeof (await command.command("INFO")) !== "string") throw new Error("info");

    const received = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 5000);
      subscriber.onPush = (reply) => {
        if (Array.isArray(reply) && reply[0] === "message" && reply[1] === channel && reply[2] === nonce) {
          clearTimeout(timer);
          resolve();
        }
      };
    });
    await subscriber.command("SUBSCRIBE", channel);

    if ((await command.command("INCR", rateKey)) !== 1) throw new Error("rate counter");
    if ((await command.command("EXPIRE", rateKey, 30)) !== 1) throw new Error("rate expiry");
    if ((await command.command("TTL", rateKey)) < 1) throw new Error("rate ttl");

    await command.command("SET", mxKey, nonce, "EX", 30);
    if ((await command.command("GET", mxKey)) !== nonce) throw new Error("mx cache");

    await command.command("SET", presenceKey, nonce, "EX", 30);
    if ((await command.command("ZADD", presenceIndexKey, Date.now() + 30000, presenceKey)) !== 1) {
      throw new Error("presence index add");
    }
    if ((await command.command("EXPIRE", presenceIndexKey, 60)) !== 1) {
      throw new Error("presence index expiry ttl");
    }
    if ((await command.command("ZREMRANGEBYSCORE", presenceIndexKey, "-inf", 0)) !== 0) {
      throw new Error("presence index expiry");
    }
    const indexedKeys = await command.command("ZRANGEBYSCORE", presenceIndexKey, 0, "+inf");
    if (!Array.isArray(indexedKeys) || !indexedKeys.includes(presenceKey)) {
      throw new Error("presence index read");
    }
    const values = await command.command("MGET", presenceKey);
    if (!Array.isArray(values) || values[0] !== nonce) throw new Error("mget");
    if ((await command.command("DEL", presenceKey)) !== 1) throw new Error("delete");
    if ((await command.command("ZREM", presenceIndexKey, presenceKey)) !== 1) {
      throw new Error("presence index remove");
    }

    if ((await command.command("SET", replayKey, "1", "PX", 30000, "NX")) !== "OK") {
      throw new Error("replay key");
    }

    if ((await publisher.command("PUBLISH", channel, nonce)) < 1) throw new Error("publish");
    await received;

    let denied = false;
    try {
      await command.command("SET", `foreign:redis-probe:${nonce}`, "1", "EX", 30);
    } catch (error) {
      denied = error instanceof Error && error.message.includes("NOPERM");
    }
    if (!denied) throw new Error("foreign key permission");

    if (process.env.OCTOPUS_REDIS_AUTH_ENFORCED === "1") {
      const unauthenticated = new RedisConnection();
      let authenticationRequired = false;
      try {
        await unauthenticated.ready(false);
        await unauthenticated.command("GET", mxKey);
      } catch (error) {
        authenticationRequired = isAuthenticationRequired(error);
      } finally {
        unauthenticated.disconnect();
      }
      if (!authenticationRequired) throw new Error("anonymous access");
    }
  } finally {
    command.disconnect();
    publisher.disconnect();
    subscriber.disconnect();
  }
}

module.exports = {
  RedisConnection,
  encodeCommand,
  isAuthenticationRequired,
  parseReply,
  withDeadline,
};

if (process.env.OCTOPUS_REDIS_PROBE_RUN === "1") {
  withDeadline(probe(), 30000).then(() => process.exit(0), () => process.exit(1));
}
