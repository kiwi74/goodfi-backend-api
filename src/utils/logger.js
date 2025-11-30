/**
 * Logger Utility
 */

import winston from 'winston';

export function createLogger(label = 'App') {
  return winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.label({ label }),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, label, level, message }) => {
        return `${timestamp} [${label}] ${level.toUpperCase()}: ${message}`;
      })
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.colorize({ all: true })
      }),
      new winston.transports.File({
        filename: 'logs/api.log',
        maxsize: 10485760,
        maxFiles: 5
      }),
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        maxsize: 10485760,
        maxFiles: 5
      })
    ]
  });
}
