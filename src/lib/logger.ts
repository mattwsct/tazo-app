// === 📊 CENTRALIZED LOGGING SYSTEM ===

// Log levels for filtering
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Logger configuration
const LOG_CONFIG = {
  level: (process.env.NODE_ENV === 'production' ? 'warn' : 'debug') as LogLevel,
  enableConsole: process.env.NODE_ENV !== 'test',
} as const;

// Log level priorities
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Check if log level should be output
 */
function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[LOG_CONFIG.level];
}

/**
 * Format log message with timestamp and context
 */
function formatMessage(level: LogLevel, context: string, message: string): string {
  const timestamp = new Date().toISOString();
  const emoji = {
    debug: '🔍',
    info: 'ℹ️',
    warn: '⚠️',
    error: '❌',
  }[level];
  
  return `${emoji} [${timestamp}] [${context.toUpperCase()}] ${message}`;
}

/**
 * Centralized logger with context and level filtering
 */
export class Logger {
  private context: string;

  constructor(context: string) {
    this.context = context;
  }

  debug(message: string, data?: unknown): void {
    if (!shouldLog('debug') || !LOG_CONFIG.enableConsole) return;
    console.log(formatMessage('debug', this.context, message), data || '');
  }

  info(message: string, data?: unknown): void {
    if (!shouldLog('info') || !LOG_CONFIG.enableConsole) return;
    console.log(formatMessage('info', this.context, message), data || '');
  }

  warn(message: string, data?: unknown): void {
    if (!shouldLog('warn') || !LOG_CONFIG.enableConsole) return;
    console.warn(formatMessage('warn', this.context, message), data || '');
  }

  error(message: string, error?: unknown): void {
    if (!shouldLog('error') || !LOG_CONFIG.enableConsole) return;
    console.error(formatMessage('error', this.context, message), error || '');
  }
}

// === 🎯 SPECIALIZED LOGGERS ===

/**
 * API-specific logger with standardized formatting
 */
export const ApiLogger = {
  info: (api: string, message: string, data?: unknown) => 
    new Logger(`API-${api}`).info(message, data),
  
  error: (api: string, message: string, error?: unknown) => 
    new Logger(`API-${api}`).error(message, error),
  
  warn: (api: string, message: string, data?: unknown) => 
    new Logger(`API-${api}`).warn(message, data),
} as const;

/**
 * Overlay-specific logger with emoji prefixes
 */
export const OverlayLogger = {
  overlay: (message: string, data?: unknown) => 
    new Logger('OVERLAY').info(message, data),
  
  weather: (message: string, data?: unknown) => 
    new Logger('WEATHER').info(message, data),
  
  location: (message: string, data?: unknown) => 
    new Logger('LOCATION').info(message, data),
  
  settings: (message: string, data?: unknown) => 
    new Logger('SETTINGS').info(message, data),
  
  error: (message: string, error?: unknown) => 
    new Logger('ERROR').error(message, error),
  
  warn: (message: string, data?: unknown) => 
    new Logger('WARNING').warn(message, data),
} as const;

/**
 * Heart rate monitor logger
 */
export const HeartRateLogger = {
  info: (message: string, data?: unknown) => 
    new Logger('HEART-RATE').info(message, data),
  
  error: (message: string, error?: unknown) => 
    new Logger('HEART-RATE').error(message, error),
} as const;

/**
 * Broadcast system logger
 */
export const BroadcastLogger = {
  info: (message: string, data?: unknown) => 
    new Logger('BROADCAST').info(message, data),
  
  warn: (message: string, data?: unknown) => 
    new Logger('BROADCAST').warn(message, data),
  
  error: (message: string, error?: unknown) => 
    new Logger('BROADCAST').error(message, error),
} as const; 