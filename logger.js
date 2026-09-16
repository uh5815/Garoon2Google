const winston = require('winston');
const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('path');

const logDirectory = path.join(process.cwd(), 'logs');
const logFilePattern = /^run-(\d{4}-\d{2}-\d{2})T.*\.log$/;
const logFileName = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.log`;

fsSync.mkdirSync(logDirectory, { recursive: true });

const jsonFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
);
const consoleFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...metadata }) => {
        const details = Object.keys(metadata).length > 0
            ? ` ${JSON.stringify(metadata)}`
            : '';
        return `${timestamp} ${level.toUpperCase().padEnd(5)} ${message}${details}`;
    }),
);

// コンソールは読みやすく、ファイルは検索しやすいJSON形式で出力する。
const logger = winston.createLogger({
    level: 'info',
    transports: [
        new winston.transports.Console({ format: consoleFormat }),
        new winston.transports.File({
            dirname: logDirectory,
            filename: logFileName,
            format: jsonFormat,
        })
    ]
});

/**
 * 7日より古い実行単位ログを削除する。
 * @returns {Promise<void>}
 */
async function cleanupOldLogs() {
    await fs.mkdir(logDirectory, { recursive: true });
    const files = await fs.readdir(logDirectory, { withFileTypes: true });
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 7);

    await Promise.all(files
        .filter(file => file.isFile())
        .map(file => {
            const match = file.name.match(logFilePattern);
            if (!match) return null;

            const logDate = new Date(`${match[1]}T00:00:00`);
            if (logDate >= cutoff) return null;

            return fs.unlink(path.join(logDirectory, file.name));
        })
        .filter(Boolean));
}

module.exports = { logger, cleanupOldLogs };