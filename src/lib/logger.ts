// === 📊 CENTRALIZED LOGGING SYSTEM ===

// Log levels for filtering
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Logger configuration
const LOG_CONFIG = {
  level: (process.env.NODE_ENV === 'production' ? 'warn' : 'debug') as LogLevel,
  enableConsole: process.env.NODE_ENV !== 'test',
  // Reduce logging frequency in production
  productionLogInterval: 100, // Log every 100th operation in production
} as const;

// Log level priorities
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Production logging counter
let productionLogCounter = 0;

// Context styles — shared between formatMessage and getLogStyles
const CONTEXT_STYLES: Record<string, { emoji: string; color: string }> = {
  'API-LOCATIONIQ': { emoji: '🗺️', color: '#4A90E2' },
  'API-OPENMETEO': { emoji: '🌤️', color: '#50E3C2' },
  'OVERLAY':       { emoji: '📺', color: '#F5A623' },
  'WEATHER':       { emoji: '🌦️', color: '#50E3C2' },
  'LOCATION':      { emoji: '📍', color: '#4A90E2' },
  'SETTINGS':      { emoji: '⚙️', color: '#9013FE' },
  'HEART-RATE':    { emoji: '💓', color: '#D0021B' },
  'BROADCAST':     { emoji: '📡', color: '#7ED321' },
  'ERROR':         { emoji: '❌', color: '#D0021B' },
  'WARNING':       { emoji: '⚠️', color: '#F5A623' },
};

const LEVEL_STYLES: Record<LogLevel, { emoji: string; color: string }> = {
  debug: { emoji: '🔍', color: '#9B9B9B' },
  info:  { emoji: 'ℹ️',  color: '#4A90E2' },
  warn:  { emoji: '⚠️', color: '#F5A623' },
  error: { emoji: '❌', color: '#D0021B' },
};

/**
 * Check if log level should be output
 */
function shouldLog(level: LogLevel): boolean {
  const baseCheck = LOG_LEVELS[level] >= LOG_LEVELS[LOG_CONFIG.level];

  // In production, reduce frequency of info/debug logs
  if (process.env.NODE_ENV === 'production' && level === 'info') {
    productionLogCounter++;
    return baseCheck && (productionLogCounter % LOG_CONFIG.productionLogInterval === 0);
  }

  return baseCheck;
}

/**
 * Format log message with enhanced visual styling
 */
function formatMessage(level: LogLevel, context: string, message: string): string {
  const timestamp = new Date().toISOString().replace('T', ' ').replace('Z', '');
  const contextStyle = CONTEXT_STYLES[context] || { emoji: '📝', color: '#9B9B9B' };
  return `%c${timestamp} %c${contextStyle.emoji} ${context.toUpperCase()} %c${message}`;
}

/**
 * Get CSS styles for formatted log message
 */
function getLogStyles(level: LogLevel, context: string): string[] {
  const contextStyle = CONTEXT_STYLES[context] || { emoji: '📝', color: '#9B9B9B' };
  const levelStyle = LEVEL_STYLES[level];
  return [
    `color: #9B9B9B; font-size: 11px; font-weight: normal;`,          // timestamp
    `color: ${contextStyle.color}; font-weight: bold; font-size: 12px;`, // context
    `color: ${levelStyle.color}; font-weight: 500;`,                   // message
  ];
}

/**
 * Format data objects for better readability
 */
function formatData(data: unknown): string {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data.trim() === '' ? '' : data;
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);
  try {
    const json = JSON.stringify(data, null, 2);
    if (json === '{}' || json === '[]' || json === 'null') return '';
    return json;
  } catch {
    return String(data);
  }
}

/**
 * Centralized logger with context and level filtering
 */
export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  private _log(level: LogLevel, message: string, data?: unknown): void {
    if (!shouldLog(level) || !LOG_CONFIG.enableConsole) return;
    const styles = getLogStyles(level, this.context);
    const formattedData = data ? formatData(data) : '';
    const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (formattedData) {
      consoleFn(formatMessage(level, this.context, message), ...styles, formattedData);
    } else {
      consoleFn(formatMessage(level, this.context, message), ...styles);
    }
  }

  debug(message: string, data?: unknown): void { this._log('debug', message, data); }
  info(message: string, data?: unknown): void  { this._log('info',  message, data); }
  warn(message: string, data?: unknown): void  { this._log('warn',  message, data); }
  error(message: string, error?: unknown): void { this._log('error', message, error); }
}

// === 🎯 SPECIALIZED LOGGERS ===

export const ApiLogger = {
  info:  (api: string, message: string, data?: unknown)  => new Logger(`API-${api}`).info(message, data),
  error: (api: string, message: string, error?: unknown) => new Logger(`API-${api}`).error(message, error),
  warn:  (api: string, message: string, data?: unknown)  => new Logger(`API-${api}`).warn(message, data),
} as const;

export const OverlayLogger = {
  overlay:  (message: string, data?: unknown)  => new Logger('OVERLAY').info(message, data),
  weather:  (message: string, data?: unknown)  => new Logger('WEATHER').info(message, data),
  location: (message: string, data?: unknown)  => new Logger('LOCATION').info(message, data),
  settings: (message: string, data?: unknown)  => new Logger('SETTINGS').info(message, data),
  error:    (message: string, error?: unknown) => new Logger('ERROR').error(message, error),
  warn:     (message: string, data?: unknown)  => new Logger('WARNING').warn(message, data),
} as const;

export const HeartRateLogger = {
  info:  (message: string, data?: unknown)  => new Logger('HEART-RATE').info(message, data),
  error: (message: string, error?: unknown) => new Logger('HEART-RATE').error(message, error),
} as const;

export const BroadcastLogger = {
  info:  (message: string, data?: unknown)  => new Logger('BROADCAST').info(message, data),
  warn:  (message: string, data?: unknown)  => new Logger('BROADCAST').warn(message, data),
  error: (message: string, error?: unknown) => new Logger('BROADCAST').error(message, error),
} as const;

export const LogSeparator = {
  section: (title: string) => {
    console.log(`%c━━━ ${title} ━━━%c`, 'color: #9013FE; font-weight: bold; font-size: 14px;', 'color: #9B9B9B; font-size: 11px;');
  },
  divider: () => {
    console.log('%c─────────────────────────────────────────', 'color: #E0E0E0; font-size: 10px;');
  },
  success: (message: string) => {
    console.log(`%c✅ %c${message}`, 'color: #7ED321; font-weight: bold; font-size: 12px;', 'color: #7ED321; font-weight: 500;');
  },
  highlight: (message: string) => {
    console.log(`%c🔆 %c${message}`, 'color: #F5A623; font-weight: bold; font-size: 12px;', 'color: #F5A623; font-weight: 500;');
  },
} as const;
