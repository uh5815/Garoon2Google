const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const fs = require('fs').promises;
const path = require('path');

const logDirectory = path.join(process.cwd(), 'logs');
const logFilePattern = /^combined-(\d{4}-\d{2}-\d{2})\.log$/;

// コンソール出力と日付別ファイル出力を同じLoggerへ集約する。
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new DailyRotateFile({
            dirname: logDirectory,
            filename: 'combined-%DATE%.log',
            datePattern: 'YYYY-MM-DD',
            maxFiles: '7d',
            zippedArchive: false,
        })
    ]
});

/**
 * 7日より古い日付別ログを削除する。
 * ローテーション機能とは別に、アプリ起動時にも保持期間を確認する。
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