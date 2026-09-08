// ファイルシステムモジュールを読み込む
const fs = require('fs').promises;

// 設定ファイルを読み込む非同期関数
async function loadConfig() {
  const data = await fs.readFile('config.json', 'utf8');
  return JSON.parse(data);
}

module.exports = { loadConfig };