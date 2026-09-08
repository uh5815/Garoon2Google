const fs = require('fs').promises;
const readline = require('readline');
const { google } = require('googleapis');

async function authorize(credentials) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  try {
    const token = await fs.readFile('token.json', 'utf8');
    oAuth2Client.setCredentials(JSON.parse(token));

    // Check if the token needs to be refreshed
    if (oAuth2Client.isTokenExpiring()) {
      const newToken = await oAuth2Client.refreshAccessToken();
      oAuth2Client.setCredentials(newToken.credentials);
      await fs.writeFile('token.json', JSON.stringify(newToken.credentials), { mode: 0o600 });
      console.log('Token refreshed and saved');
    }
  } catch (err) {
    await getAccessToken(oAuth2Client);
  }
  return oAuth2Client;
}

async function getAccessToken(oAuth2Client) {
  const SCOPES = ['https://www.googleapis.com/auth/calendar'];
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('認証URLにアクセスし、認証先URLに表示される"code"を入力してください:', authUrl);

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
    console.log('トークンが保存されました: token.json');
  } catch (err) {
    console.error('トークンの取得エラー:', err);
    throw err;
  }
}

async function addEventToGoogleCalendar(auth, event, calendarId) {
  const calendar = google.calendar({ version: 'v3', auth });
  try {
    const res = await calendar.events.insert({
      calendarId: calendarId,
      resource: event,
    });
    console.log('イベントがGoogleカレンダーに登録されました:', res.data);
  } catch (err) {
    console.error('カレンダーへのイベント登録エラー:', err);
  }
}

async function getGoogleCalendarEvents(auth, calendarId) {
  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date().toISOString(); // 現在の日時をISO形式で取得
  try {
    const res = await calendar.events.list({
      calendarId: calendarId,
      singleEvents: false,
      orderBy: 'startTime',
      maxResults: 150, // 取得個数の上限を設定
      timeMin: now, // 開始時間を実行日時以降に絞る
      showDeleted: true // ゴミ箱に捨てられているイベントも取得
    });
    return res.data.items;
  } catch (err) {
    console.error('Error fetching Google Calendar events:', err);
    throw err;
  }
}

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

async function updateEventInGoogleCalendar(auth, event, calendarId) {
  const calendar = google.calendar({ version: 'v3', auth });
  try {
    const latestEvent = await calendar.events.get({
      calendarId: calendarId,
      eventId: event.id,
    });
    const { sequence, ...eventWithoutSequence } = event;
    const res = await calendar.events.update({
      calendarId: calendarId,
      eventId: event.id,
      resource: {
        ...latestEvent.data,
        ...eventWithoutSequence,
        sequence: latestEvent.data.sequence,
      },
    });
    console.log('Event updated in Google Calendar:', res.data);
  } catch (err) {
    console.error('Error updating event in Google Calendar:', err);
    throw err;
  }
}

async function deleteEventFromGoogleCalendar(auth, eventId, calendarId) {
  const calendar = google.calendar({ version: 'v3', auth });
  try {
    await calendar.events.delete({
      calendarId: calendarId,
      eventId: eventId,
    });
    console.log(`Event deleted: ${eventId}`);
  } catch (error) {
    console.error(`Failed to delete event: ${error.message}`);
    throw error;
  }
}

module.exports = { authorize, getAccessToken, addEventToGoogleCalendar, getGoogleCalendarEvents, getGoogleCalendarEventByICalUID, updateEventInGoogleCalendar, deleteEventFromGoogleCalendar };