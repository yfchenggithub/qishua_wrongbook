type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const SENSITIVE_KEY_PATTERN =
  /(token|password|passwd|pwd|secret|authorization|cookie)/i;

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

function writeLog(
  level: LogLevel,
  scope: string,
  message: string,
  payload?: unknown,
): void {
  const logLine = `[${new Date().toISOString()}] [${level}] [${sanitizeScope(
    scope,
  )}] ${redactMessage(message)}`;

  switch (level) {
    case "DEBUG":
      if (payload === undefined) {
        console.debug(logLine);
      } else {
        console.debug(logLine, redactData(payload));
      }
      return;
    case "INFO":
      if (payload === undefined) {
        console.info(logLine);
      } else {
        console.info(logLine, redactData(payload));
      }
      return;
    case "WARN":
      if (payload === undefined) {
        console.warn(logLine);
      } else {
        console.warn(logLine, redactData(payload));
      }
      return;
    case "ERROR":
      if (payload === undefined) {
        console.error(logLine);
      } else {
        console.error(logLine, redactData(payload));
      }
      return;
    default:
      console.log(logLine, payload === undefined ? "" : redactData(payload));
  }
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
