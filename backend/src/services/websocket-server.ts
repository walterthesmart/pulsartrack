import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage, Server } from "http";
import { streamLedgers } from "./horizon";
import { logger } from "../lib/logger";
import crypto from "crypto";

interface PulsarEvent {
  type: string;
  payload: any;
  timestamp: number;
  txHash?: string;
}

// Allowed incoming message types
type ClientMessageType = "subscribe" | "unsubscribe" | "ping";

interface ClientMessage {
  type: ClientMessageType;
  channel?: string;
}

// Valid broadcast channels clients can subscribe to
const VALID_CHANNELS = new Set(["ledger", "campaigns", "auctions"]);

interface ClientState {
  ws: WebSocket;
  subscriptions: Set<string>;
}

const clients = new Map<WebSocket, ClientState>();

// Per-IP connection tracking for rate limiting
const connectionsPerIp = new Map<string, number>();
const MAX_CONNECTIONS_PER_IP = 5;

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
let currentBackoff = INITIAL_BACKOFF_MS;
let stopStream: (() => void) | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const JWT_SECRET =
  process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");

/**
 * Verify a JWT token issued by auth.ts.
 * Returns the decoded payload or null if invalid/expired.
 */
function verifyJwt(token: string | null): Record<string, any> | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expected = crypto
      .createHmac("sha256", JWT_SECRET)
      .update(`${header}.${body}`)
      .digest("base64url");
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Parse and validate an incoming client message.
 * Returns the typed message or null if invalid.
 */
function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (typeof msg !== "object" || msg === null) return null;
    if (!["subscribe", "unsubscribe", "ping"].includes(msg.type)) return null;
    if (msg.channel !== undefined && typeof msg.channel !== "string") return null;
    return msg as ClientMessage;
  } catch {
    return null;
  }
}

function startLedgerStream(): void {
  stopStream = streamLedgers(
    (ledger) => {
      currentBackoff = INITIAL_BACKOFF_MS;
      broadcastToChannel("ledger", {
        type: "LEDGER_CLOSED",
        payload: {
          sequence: ledger.sequence,
          closed_at: ledger.closed_at,
          transactionCount: ledger.transaction_count,
        },
        timestamp: Date.now(),
      });
    },
    (err: any) => {
      logger.error(err, "[WS] Ledger stream error");
      scheduleReconnect();
    },
  );
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;

  broadcastToChannel("ledger", {
    type: "reconnecting",
    payload: {
      message: "Horizon stream dropped, reconnecting...",
      retryMs: currentBackoff,
    },
    timestamp: Date.now(),
  });

  logger.info(`[WS] Reconnecting in ${currentBackoff}ms...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (stopStream) {
      try { stopStream(); } catch { /* already closed */ }
      stopStream = null;
    }
    startLedgerStream();
    broadcastToChannel("ledger", {
      type: "reconnected",
      payload: { message: "Horizon stream resumed" },
      timestamp: Date.now(),
    });
    currentBackoff = Math.min(currentBackoff * 2, MAX_BACKOFF_MS);
  }, currentBackoff);
}

export function setupWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    // --- Per-IP connection limiting ---
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0].trim()
      ?? req.socket.remoteAddress
      ?? "unknown";

    const ipCount = connectionsPerIp.get(ip) ?? 0;
    if (ipCount >= MAX_CONNECTIONS_PER_IP) {
      logger.warn(`[WS] Connection limit reached for IP ${ip}, rejecting`);
      ws.close(4029, "Too many connections");
      return;
    }
    connectionsPerIp.set(ip, ipCount + 1);

    // --- JWT authentication ---
    const url = new URL(req.url ?? "", "http://localhost");
    const token = url.searchParams.get("token");
    const payload = verifyJwt(token);
    if (!payload) {
      logger.warn(`[WS] Unauthenticated connection attempt from ${ip}`);
      ws.close(4001, "Unauthorized");
      connectionsPerIp.set(ip, (connectionsPerIp.get(ip) ?? 1) - 1);
      return;
    }

    // Register client with empty subscription set
    const state: ClientState = { ws, subscriptions: new Set() };
    clients.set(ws, state);
    logger.info(`[WS] Client connected (${payload.sub}). Total: ${clients.size}`);

    sendToClient(ws, {
      type: "connected",
      payload: { message: "Connected to PulsarTrack WebSocket server" },
      timestamp: Date.now(),
    });

    ws.on("close", () => {
      clients.delete(ws);
      const remaining = (connectionsPerIp.get(ip) ?? 1) - 1;
      remaining > 0 ? connectionsPerIp.set(ip, remaining) : connectionsPerIp.delete(ip);
      logger.info(`[WS] Client disconnected. Total: ${clients.size}`);
    });

    ws.on("error", (err) => {
      logger.error(err, "[WS] Client error");
      clients.delete(ws);
    });

    // --- Validated message handling ---
    ws.on("message", (data) => {
      const msg = parseClientMessage(data.toString());
      if (!msg) {
        sendToClient(ws, {
          type: "error",
          payload: { message: "Invalid message format" },
          timestamp: Date.now(),
        });
        return;
      }

      if (msg.type === "ping") {
        sendToClient(ws, { type: "pong", payload: {}, timestamp: Date.now() });
        return;
      }

      const channel = msg.channel ?? "";
      if (!VALID_CHANNELS.has(channel)) {
        sendToClient(ws, {
          type: "error",
          payload: { message: `Unknown channel: ${channel}` },
          timestamp: Date.now(),
        });
        return;
      }

      if (msg.type === "subscribe") {
        state.subscriptions.add(channel);
        sendToClient(ws, {
          type: "subscribed",
          payload: { channel },
          timestamp: Date.now(),
        });
      } else if (msg.type === "unsubscribe") {
        state.subscriptions.delete(channel);
        sendToClient(ws, {
          type: "unsubscribed",
          payload: { channel },
          timestamp: Date.now(),
        });
      }
    });
  });

  startLedgerStream();

  wss.on("close", () => {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (stopStream) { stopStream(); stopStream = null; }
  });

  return wss;
}

function sendToClient(ws: WebSocket, event: PulsarEvent): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

/**
 * Broadcast to all clients subscribed to a specific channel.
 */
export function broadcastToChannel(channel: string, event: PulsarEvent): void {
  const msg = JSON.stringify(event);
  clients.forEach((state) => {
    if (state.subscriptions.has(channel) && state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(msg);
    }
  });
}

/**
 * Broadcast to ALL authenticated clients (used for platform-wide events).
 */
export function broadcast(event: PulsarEvent): void {
  const msg = JSON.stringify(event);
  clients.forEach((state) => {
    if (state.ws.readyState === WebSocket.OPEN) {
      state.ws.send(msg);
    }
  });
}

/**
 * Broadcast a campaign event to the "campaigns" channel.
 */
export function broadcastCampaignEvent(
  type: "campaign_created" | "view_recorded" | "payment_processed",
  data: Record<string, any>,
): void {
  broadcastToChannel("campaigns", { type, payload: data, timestamp: Date.now() });
}

/**
 * Broadcast an auction event to the "auctions" channel.
 */
export function broadcastAuctionEvent(
  type: "bid_placed" | "auction_created" | "auction_settled",
  data: Record<string, any>,
): void {
  broadcastToChannel("auctions", { type, payload: data, timestamp: Date.now() });
}
