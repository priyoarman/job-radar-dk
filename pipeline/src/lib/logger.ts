export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const PREFIX: Record<LogLevel, string> = { info: "", warn: "WARN ", error: "ERROR " };

function serialize(_key: string, value: unknown): unknown {
  return value instanceof Error ? value.message : value;
}

export function formatLine(level: LogLevel, event: string, fields?: LogFields): string {
  const hasFields = fields !== undefined && Object.keys(fields).length > 0;
  const data = hasFields ? ` ${JSON.stringify(fields, serialize)}` : "";
  return `${PREFIX[level]}${event}${data}`;
}

export const log = {
  info: (event: string, fields?: LogFields) => console.log(formatLine("info", event, fields)),
  warn: (event: string, fields?: LogFields) => console.warn(formatLine("warn", event, fields)),
  error: (event: string, fields?: LogFields) => console.error(formatLine("error", event, fields)),
};
