const fs = require('fs').promises;
const readline = require('readline');
const { google } = require('googleapis');
const { logger } = require('../logger');

const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar'];

/**
 * 保存済みトークンを読み込み、必要に応じて更新する。
 * トークンが存在しない初回だけ対話式OAuth認証を実行する。
 * @param {object} credentials Google OAuthクライアント認証情報
 * @returns {Promise<object>} Google APIの認証済みクライアント
 */
async function authorize(credentials) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  let token;
  try {
    token = await fs.readFile('token.json', 'utf8');
  } catch (error) {
    await getAccessToken(oAuth2Client);
    return oAuth2Client;
  }

  oAuth2Client.setCredentials(JSON.parse(token));
  // API呼び出し前に、有効期限が近いトークンを更新する。
  if (oAuth2Client.isTokenExpiring()) {
    const newToken = await oAuth2Client.refreshAccessToken();
    oAuth2Client.setCredentials(newToken.credentials);
    await fs.writeFile('token.json', JSON.stringify(newToken.credentials), { mode: 0o600 });
    logger.info('Token refreshed and saved');
  }
  return oAuth2Client;
}

/**
 * Google OAuth認証コードを受け取り、トークンを保存する。
 * @param {object} oAuth2Client Google OAuthクライアント
 * @returns {Promise<void>}
 */
async function getAccessToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: CALENDAR_SCOPES,
  });
  logger.info('認証URLにアクセスし、認証先URLに表示される"code"を入力してください', { authUrl });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const code = await new Promise((resolve) => rl.question('コードを入力してください: ', resolve));
  rl.close();

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    await fs.writeFile('token.json', JSON.stringify(tokens), { mode: 0o600 });
    logger.info('トークンが保存されました: token.json');
  } catch (err) {
    logger.error('トークンの取得エラー', { error: err.message });
    throw err;
  }
}

/**
 * Google Calendarへイベントを新規登録する。
 * @param {object} auth Google APIの認証済みクライアント
 * @param {object} event Google Calendarイベントリソース
 * @param {string} calendarId 登録先カレンダーのID
 * @returns {Promise<void>}
 * @throws {Error} Google Calendar APIが登録に失敗した場合
 */
async function addEventToGoogleCalendar(auth, event, calendarId) {
  const calendar = google.calendar({ version: 'v3', auth });
  try {
    const res = await calendar.events.insert({
      calendarId: calendarId,
      resource: event,
    });
    logger.info('イベントがGoogleカレンダーに登録されました', {
      ...getEventLogDetails(res.data),
    });
  } catch (err) {
    logger.error('カレンダーへのイベント登録エラー', {
      error: err.message,
      iCalUID: event.iCalUID,
      summary: event.summary,
    });
    throw err;
  }
}

/**
 * 同期期間内のGoogleイベントをページングしながら取得する。
 * @param {object} auth Google APIの認証済みクライアント
 * @param {string} calendarId 取得元カレンダーのID
 * @returns {Promise<object[]>} Google Calendarイベント一覧
 * @throws {Error} Google Calendar APIの取得に失敗した場合
 */
async function getGoogleCalendarEvents(auth, calendarId) {
  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date().toISOString(); // 現在の日時をISO形式で取得
  const events = [];
  let pageToken;

  try {
    do {
      const res = await calendar.events.list({
        calendarId,
        singleEvents: false,
        maxResults: 2500,
        timeMin: now,
        showDeleted: true,
        pageToken,
      });
      events.push(...(res.data.items || []));
      pageToken = res.data.nextPageToken;
    } while (pageToken);

    return events;
  } catch (err) {
    logger.error('Error fetching Google Calendar events', { error: err.message });
    throw err;
  }
}

/**
 * iCalUIDを使ってGoogle Calendarイベントを検索する。
 * @param {object} auth Google APIの認証済みクライアント
 * @param {string} calendarId 検索対象カレンダーのID
 * @param {string} iCalUID 検索するiCalUID
 * @returns {Promise<object|undefined>} 最初に見つかったイベント
 */
async function getGoogleCalendarEventByICalUID(auth, calendarId, iCalUID) {
  const calendar = google.calendar({ version: 'v3', auth });
  const res = await calendar.events.list({
    calendarId: calendarId,
    iCalUID: iCalUID,
    showDeleted: false,
    maxResults: 10,
  });
  return res.data.items?.[0];
}

/**
 * Google Calendarイベントを更新する。
 * Google側の最新データを取得してから更新し、既存のiCalUIDとsequenceを保持する。
 * @param {object} auth Google APIの認証済みクライアント
 * @param {object} event 更新内容を含むGoogleイベント
 * @param {string} calendarId 更新対象カレンダーのID
 * @returns {Promise<void>}
 * @throws {Error} Google Calendar APIが更新に失敗した場合
 */
async function updateEventInGoogleCalendar(auth, event, calendarId) {
  const calendar = google.calendar({ version: 'v3', auth });
  try {
    const latestEvent = await calendar.events.get({
      calendarId: calendarId,
      eventId: event.id,
    });
    const { sequence, iCalUID, ...eventWithoutSequence } = event;
    const res = await calendar.events.update({
      calendarId: calendarId,
      eventId: event.id,
      resource: {
        ...latestEvent.data,
        ...eventWithoutSequence,
        iCalUID: latestEvent.data.iCalUID || iCalUID,
        sequence: latestEvent.data.sequence,
      },
    });
    logger.info('Event updated in Google Calendar', {
      ...getEventLogDetails(res.data),
    });
  } catch (err) {
    logger.error('Error updating event in Google Calendar', {
      error: err.message,
      eventId: event.id,
      iCalUID: event.iCalUID,
      summary: event.summary,
    });
    throw err;
  }
}

/**
 * 永続ログに出してよいイベント情報だけを抽出する。
 * @param {object} event Google Calendarイベント
 * @returns {{eventId: string, iCalUID: string, summary: string}} 安全なログ情報
 */
function getEventLogDetails(event) {
  // 説明、参加者、会議の認証情報を永続ログへ記録しない。
  return {
    eventId: event.id,
    iCalUID: event.iCalUID,
    summary: event.summary,
  };
}

/**
 * Google Calendarイベントを削除する。
 * @param {object} auth Google APIの認証済みクライアント
 * @param {string} eventId 削除対象イベントのGoogle ID
 * @param {string} calendarId 削除対象カレンダーのID
 * @param {string} [summary] 削除対象イベントの件名
 * @returns {Promise<void>}
 * @throws {Error} Google Calendar APIが削除に失敗した場合
 */
async function deleteEventFromGoogleCalendar(auth, eventId, calendarId, summary) {
  const calendar = google.calendar({ version: 'v3', auth });
  try {
    await calendar.events.delete({
      calendarId: calendarId,
      eventId: eventId,
    });
    logger.info('Event deleted', { eventId, summary });
  } catch (error) {
    logger.error('Failed to delete event', { error: error.message, eventId, summary });
    throw error;
  }
}

module.exports = {
  authorize,
  getAccessToken,
  addEventToGoogleCalendar,
  getGoogleCalendarEvents,
  getGoogleCalendarEventByICalUID,
  updateEventInGoogleCalendar,
  deleteEventFromGoogleCalendar,
};