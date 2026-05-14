type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
type RuntimeLogLevel = "debug" | "info" | "warn" | "error";

const RUNTIME_LOG_LIMIT = 300;
const RUNTIME_METADATA_STRING_LIMIT = 1000;
const RUNTIME_METADATA_ITEM_LIMIT = 60;

const SENSITIVE_KEY_PATTERN =
  /(token|password|passwd|pwd|secret|authorization|cookie)/i;

let runtimeLogSequence = 0;
const runtimeLogs: RuntimeLogItem[] = [];
const runtimeLogListeners = new Set<() => void>();

export type RuntimeLogItem = {
  id: string;
  timestamp: string;
  level: RuntimeLogLevel;
  scope?: string;
  message: string;
  metadata?: unknown;
};

function sanitizeScope(scope: string): string {
  const trimmed = scope.trim();
  return trimmed.length > 0 ? trimmed : "unknown";
}

function redactMessage(message: string): string {
  return message
    .replace(
      /(token|password|passwd|pwd|secret)\s*[:=]\s*([^\s,;]+)/gi,
      "$1=[REDACTED]",
    )
    .replace(/authorization\s*[:=]\s*([^\s,;]+)/gi, "authorization=[REDACTED]")
    .replace(/bearer\s+[a-z0-9\-._~+/]+=*/gi, "Bearer [REDACTED]");
}

function redactData(
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (depth > 5) {
    return "[Truncated]";
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return redactMessage(value);
  }

  if (typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactMessage(value.message),
      stack: value.stack,
    };
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactData(item, seen, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = "[REDACTED]";
    } else {
      output[key] = redactData(item, seen, depth + 1);
    }
  }
  return output;
}

function truncateText(value: string, maxLength = RUNTIME_METADATA_STRING_LIMIT): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

function normalizeRuntimeMetadata(
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
  depth = 0,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth > 5) {
    return "[Truncated]";
  }

  if (typeof value === "string") {
    return truncateText(value);
  }

  if (typeof value !== "object") {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateText(value.message),
      stack: typeof value.stack === "string" ? truncateText(value.stack) : value.stack,
    };
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const limited = value.slice(0, RUNTIME_METADATA_ITEM_LIMIT);
    const normalized = limited.map((item) => normalizeRuntimeMetadata(item, seen, depth + 1));
    if (value.length > RUNTIME_METADATA_ITEM_LIMIT) {
      normalized.push(`[... ${value.length - RUNTIME_METADATA_ITEM_LIMIT} more items]`);
    }
    return normalized;
  }

  const entries = Object.entries(value);
  const output: Record<string, unknown> = {};

  for (const [key, item] of entries.slice(0, RUNTIME_METADATA_ITEM_LIMIT)) {
    output[key] = normalizeRuntimeMetadata(item, seen, depth + 1);
  }

  if (entries.length > RUNTIME_METADATA_ITEM_LIMIT) {
    output.__truncatedKeys = entries.length - RUNTIME_METADATA_ITEM_LIMIT;
  }

  return output;
}

function mapLogLevelToRuntime(level: LogLevel): RuntimeLogLevel {
  switch (level) {
    case "DEBUG":
      return "debug";
    case "INFO":
      return "info";
    case "WARN":
      return "warn";
    case "ERROR":
      return "error";
    default:
      return "info";
  }
}

function notifyRuntimeLogListeners(): void {
  for (const listener of runtimeLogListeners) {
    try {
      listener();
    } catch (error) {
      console.warn("[Logger] runtime listener failed.", error);
    }
  }
}

function appendRuntimeLog(
  level: LogLevel,
  scope: string,
  message: string,
  metadata?: unknown,
): void {
  runtimeLogSequence += 1;

  runtimeLogs.push({
    id: `runtime-log-${runtimeLogSequence}`,
    timestamp: new Date().toISOString(),
    level: mapLogLevelToRuntime(level),
    scope: sanitizeScope(scope),
    message: redactMessage(message),
    metadata:
      metadata === undefined ? undefined : normalizeRuntimeMetadata(metadata),
  });

  if (runtimeLogs.length > RUNTIME_LOG_LIMIT) {
    runtimeLogs.splice(0, runtimeLogs.length - RUNTIME_LOG_LIMIT);
  }

  notifyRuntimeLogListeners();
}

function writeLog(
  level: LogLevel,
  scope: string,
  message: string,
  payload?: unknown,
): void {
  const sanitizedScope = sanitizeScope(scope);
  const sanitizedMessage = redactMessage(message);
  const redactedPayload = payload === undefined ? undefined : redactData(payload);
  const logLine = `[${new Date().toISOString()}] [${level}] [${sanitizedScope}] ${sanitizedMessage}`;

  switch (level) {
    case "DEBUG":
      if (redactedPayload === undefined) {
        console.debug(logLine);
      } else {
        console.debug(logLine, redactedPayload);
      }
      break;
    case "INFO":
      if (redactedPayload === undefined) {
        console.info(logLine);
      } else {
        console.info(logLine, redactedPayload);
      }
      break;
    case "WARN":
      if (redactedPayload === undefined) {
        console.warn(logLine);
      } else {
        console.warn(logLine, redactedPayload);
      }
      break;
    case "ERROR":
      if (redactedPayload === undefined) {
        console.error(logLine);
      } else {
        console.error(logLine, redactedPayload);
      }
      break;
    default:
      console.log(logLine, redactedPayload === undefined ? "" : redactedPayload);
  }

  appendRuntimeLog(level, sanitizedScope, sanitizedMessage, redactedPayload);
}

function getRuntimeLogs(): RuntimeLogItem[] {
  return runtimeLogs.slice();
}

function clearRuntimeLogs(): void {
  if (runtimeLogs.length === 0) {
    return;
  }

  runtimeLogs.length = 0;
  notifyRuntimeLogListeners();
}

function subscribeRuntimeLogs(listener: () => void): () => void {
  runtimeLogListeners.add(listener);
  return () => {
    runtimeLogListeners.delete(listener);
  };
}

export const Logger = {
  debug(scope: string, message: string, data?: unknown): void {
    writeLog("DEBUG", scope, message, data);
  },
  info(scope: string, message: string, data?: unknown): void {
    writeLog("INFO", scope, message, data);
  },
  warn(scope: string, message: string, data?: unknown): void {
    writeLog("WARN", scope, message, data);
  },
  error(scope: string, message: string, error?: unknown): void {
    writeLog("ERROR", scope, message, error);
  },
} as const;

export { clearRuntimeLogs, getRuntimeLogs, subscribeRuntimeLogs };
