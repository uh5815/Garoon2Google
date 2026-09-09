// ファイルシステムモジュールを読み込む
const fs = require('fs').promises;

/**
 * config.jsonを読み込んでJSONとして解析する。
 * @returns {Promise<object>} アプリケーション設定
 */
async function loadConfig() {
  const data = await fs.readFile('config.json', 'utf8');
  return JSON.parse(data);
}

module.exports = { loadConfig };