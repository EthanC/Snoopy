type LogFields = Record<string, boolean | number | string | undefined>;

function write(
  level: 'info' | 'warn' | 'error',
  event: string,
  fields: LogFields
): void {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  });

  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.info(entry);
}

export const log = {
  info: (event: string, fields: LogFields = {}) => write('info', event, fields),
  warn: (event: string, fields: LogFields = {}) => write('warn', event, fields),
  error: (event: string, fields: LogFields = {}) =>
    write('error', event, fields),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
