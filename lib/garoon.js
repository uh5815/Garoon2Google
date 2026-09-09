const axios = require('axios');
const { logger } = require('../logger');

async function getGaroonEvents(config) {
  const baseGaroonApiUrl = config.garoon.apiUrl;
  const garoonAuth = config.garoon.auth;

  const now = new Date();
  const threeMonthsLater = new Date(now);
  threeMonthsLater.setMonth(now.getMonth() + 3);

  const queryParams = {
    limit: '200',
    rangeStart: now.toISOString(),
    rangeEnd: threeMonthsLater.toISOString(),
    target: config.garoon.user.id,
    targetType: 'user',
    orderBy: 'start asc'
  };
  const url = new URL(baseGaroonApiUrl);

  // クエリパラメータをURLに追加
  Object.entries(queryParams).forEach(([key, value]) => url.searchParams.append(key, value));
  try {
    // Garoon APIにGETリクエストを送信
    const response = await axios.get(url.toString(), {
      headers: {
        'X-Cybozu-Authorization': garoonAuth,
        'Content-Type': 'application/json'
      }
    });
    return response.data.events;
  } catch (error) {
    logger.error('Garoon APIへのリクエストエラー', {
      details: error.response ? error.response.data : error.message,
    });
    throw error;
  }
}

module.exports = { getGaroonEvents };