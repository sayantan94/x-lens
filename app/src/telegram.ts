import { Bot, InputFile } from "grammy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelegramConfig {
  token: string;
  groupId: number;
  allowlist: Set<number>;
  botUsername: string;
}

export interface TelegramBot {
  start(): void;
  stop(): Promise<void>;
  sendText(text: string): Promise<void>;
  sendImage(buffer: Buffer, caption?: string): Promise<void>;
  onMessage(handler: (userId: number, text: string) => void): void;
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

export function loadTelegramConfig(): TelegramConfig | null {
  const token = process.env.X_LENS_TELEGRAM_TOKEN;
  const groupIdStr = process.env.X_LENS_TELEGRAM_GROUP_ID;

  if (!token || !groupIdStr) return null;

  const groupId = Number(groupIdStr);
  if (Number.isNaN(groupId)) return null;

  const allowlistStr = process.env.X_LENS_TELEGRAM_ALLOWLIST ?? "";
  const allowlist = new Set<number>(
    allowlistStr
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map(Number)
      .filter((n) => !Number.isNaN(n)),
  );

  const botUsername =
    process.env.X_LENS_TELEGRAM_BOT_USERNAME ?? "xlens_bot";

  return { token, groupId, allowlist, botUsername };
}

// ---------------------------------------------------------------------------
// Text chunking helper
// ---------------------------------------------------------------------------

export function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Try to split at the last newline within the limit
    const slice = remaining.slice(0, maxLen);
    const lastNewline = slice.lastIndexOf("\n");

    let splitAt: number;
    if (lastNewline > 0) {
      splitAt = lastNewline + 1; // include the newline in this chunk
    } else {
      // No newline found — hard split at maxLen
      splitAt = maxLen;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Bot factory
// ---------------------------------------------------------------------------

export function createTelegramBot(
  config: TelegramConfig,
  log: (msg: string) => void,
): TelegramBot {
  const bot = new Bot(config.token);
  let messageHandler: ((userId: number, text: string) => void) | null = null;

  // Error handler
  bot.catch((err) => {
    log(`Telegram bot error: ${err.message}`);
  });

  // Listen for text messages
  bot.on("message:text", (ctx) => {
    const chatId = ctx.chat.id;

    // Filter to configured group only
    if (chatId !== config.groupId) return;

    const userId = ctx.from.id;

    // Filter to allowlisted users (if allowlist is non-empty)
    if (config.allowlist.size > 0 && !config.allowlist.has(userId)) return;

    // Filter to messages that @mention the bot
    const entities = ctx.message.entities ?? [];
    const hasMention = entities.some(
      (e) =>
        e.type === "mention" &&
        ctx.message.text
          .slice(e.offset, e.offset + e.length)
          .toLowerCase() === `@${config.botUsername.toLowerCase()}`,
    );
    if (!hasMention) return;

    // Strip @mention from text
    let text = ctx.message.text;
    const mentionTag = new RegExp(
      `@${config.botUsername.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "gi",
    );
    text = text.replace(mentionTag, "").trim();

    if (!text) return;

    if (messageHandler) {
      messageHandler(userId, text);
    }
  });

  return {
    start() {
      log("Starting Telegram bot (long-polling)…");
      // bot.start() returns a Promise that resolves when polling stops.
      // We intentionally do not await it — it runs in the background.
      bot.start({
        onStart: () => log("Telegram bot is now receiving updates"),
      }).catch((err) => {
        log(`Telegram bot polling failed: ${err.message}`);
      });
    },

    async stop() {
      log("Stopping Telegram bot…");
      await bot.stop();
    },

    async sendText(text: string) {
      const chunks = chunkText(text, 4096);
      for (const chunk of chunks) {
        await bot.api.sendMessage(config.groupId, chunk, {
          parse_mode: "Markdown",
        });
      }
    },

    async sendImage(buffer: Buffer, caption?: string) {
      await bot.api.sendPhoto(
        config.groupId,
        new InputFile(buffer),
        caption ? { caption: caption.slice(0, 1024) } : undefined,
      );
    },

    onMessage(handler: (userId: number, text: string) => void) {
      messageHandler = handler;
    },
  };
}
