const crypto = require('crypto');

const GOOGLE_WEEKDAYS = 'MO,TU,WE,TH,FR';
const DAY_OF_WEEK_ALIASES = {
  MO: 'MO', MON: 'MO', MONDAY: 'MO',
  TU: 'TU', TUE: 'TU', TUESDAY: 'TU',
  WE: 'WE', WED: 'WE', WEDNESDAY: 'WE',
  TH: 'TH', THU: 'TH', THURSDAY: 'TH',
  FR: 'FR', FRI: 'FR', FRIDAY: 'FR',
  SA: 'SA', SAT: 'SA', SATURDAY: 'SA',
  SU: 'SU', SUN: 'SU', SUNDAY: 'SU',
};
const MONTHLY_WEEK_ORDINALS = {
  EVERY_1STWEEK: '1',
  EVERY_2NDWEEK: '2',
  EVERY_3RDWEEK: '3',
  EVERY_4THWEEK: '4',
  EVERY_LASTWEEK: '-1',
};

/**
 * GaroonイベントをGoogle Calendarイベントリソースへ変換する。
 * 終日予定、繰り返し規則、除外日、参加者説明文も変換する。
 * @param {object} garoonEvent Garoon APIのイベント
 * @returns {object} Google Calendar APIへ渡すイベントリソース
 * @throws {Error} 日時または繰り返し形式が不正・未対応の場合
 */
function convertGaroonToGoogleEvent(garoonEvent) {
  const description = createDescription(garoonEvent);

  const start = garoonEvent.start || {};
  const end = garoonEvent.end || {};
  const hasDateRange = Boolean(start.date && end.date);
  const hasDateTimeRange = Boolean(start.dateTime && end.dateTime);
  const isAllDay = garoonEvent.isAllDay === true
    || garoonEvent.repeatInfo?.isAllDay === true
    || (hasDateRange && !hasDateTimeRange);
  const startDate = start.date || start.dateTime?.slice(0, 10);
  const endDate = end.date || end.dateTime?.slice(0, 10);
  const allDayEndDate = startDate && endDate && startDate === endDate
    ? addDays(endDate)
    : endDate;

  const startField = isAllDay
    ? { date: startDate }
    : { dateTime: start.dateTime, timeZone: start.timeZone };
  const endField = isAllDay
    ? { date: allDayEndDate }
    : { dateTime: end.dateTime, timeZone: end.timeZone };

  if (isAllDay && (!startDate || !allDayEndDate)) {
    throw new Error(`All-day event has invalid dates: ${garoonEvent.id}`);
  }
  if (!isAllDay && (!start.dateTime || !end.dateTime)) {
    throw new Error(`Timed event has invalid dateTimes: ${garoonEvent.id}`);
  }

  const googleEvent = {
    summary: garoonEvent.subject,
    iCalUID: getRecurrenceKey(garoonEvent),
    start: startField,
    end: endField,
    description: description,
  };

  googleEvent.recurrence = createRecurrence(garoonEvent, isAllDay, start.timeZone);
  if (!googleEvent.recurrence) delete googleEvent.recurrence;

  return googleEvent;
}

/**
 * Garoonの参加者とメモからGoogle Calendarの説明文を作成する。
 * @param {object} garoonEvent Garoon APIのイベント
 * @returns {string} Google Calendar用の説明文
 */
function createDescription(garoonEvent) {
  const attendees = (garoonEvent.attendees || [])
    .map(attendee => attendee.name.replace(/　/g, ''))
    .join(', ');
  return `▼参加者<br>${attendees}<br><br>${garoonEvent.notes || ''}`;
}

/**
 * Garoonの繰り返し情報をRRULEとEXDATEへ変換する。
 * @param {object} garoonEvent Garoon APIのイベント
 * @param {boolean} isAllDay 終日予定かどうか
 * @param {string|undefined} timeZone イベントのタイムゾーン
 * @returns {string[]|undefined} Google Calendarのrecurrence配列
 */
function createRecurrence(garoonEvent, isAllDay, timeZone) {
  const repeatInfo = garoonEvent.repeatInfo;
  if (!repeatInfo || !garoonEvent.repeatId) return undefined;

  const recurrence = [`RRULE:FREQ=${getRecurrenceFrequency(repeatInfo.type)}`];
  const dayOfWeek = normalizeDayOfWeek(repeatInfo.dayOfWeek);
  const monthlyWeekOrdinal = MONTHLY_WEEK_ORDINALS[repeatInfo.type];
  const until = repeatInfo.period?.end?.replaceAll('-', '');
  if (repeatInfo.type === 'ONCE_EVERY_TWO_WEEKS') recurrence[0] += ';INTERVAL=2';
  if (repeatInfo.type === 'ONCE_EVERY_THREE_WEEKS') recurrence[0] += ';INTERVAL=3';
  if (repeatInfo.type === 'EVERY_WEEKDAY') recurrence[0] += `;BYDAY=${GOOGLE_WEEKDAYS}`;
  else if (dayOfWeek) recurrence[0] += `;BYDAY=${monthlyWeekOrdinal ? `${monthlyWeekOrdinal}${dayOfWeek}` : dayOfWeek}`;
  if (repeatInfo.dayOfMonth) recurrence[0] += `;BYMONTHDAY=${repeatInfo.dayOfMonth}`;
  if (until) recurrence[0] += `;UNTIL=${isAllDay ? until : `${until}T235959Z`}`;

  const excludedDates = (repeatInfo.exclusiveDateTimes || [])
    .map(excluded => excluded.start)
    .filter(Boolean)
    .map(excluded => isAllDay
      ? `EXDATE;VALUE=DATE:${excluded.slice(0, 10).replaceAll('-', '')}`
      : `EXDATE;TZID=${timeZone || repeatInfo.timeZone}:${formatLocalDateTime(excluded)}`);
  return [...recurrence, ...excludedDates];
}

/**
 * Garoonの繰り返し種別をGoogle Calendarの頻度へ変換する。
 * @param {string} type Garoonの繰り返し種別
 * @returns {string} Google CalendarのFREQ値
 * @throws {Error} 未対応の繰り返し種別の場合
 */
function getRecurrenceFrequency(type) {
  if (MONTHLY_WEEK_ORDINALS[type]) return 'MONTHLY';
  if (type === 'EVERY_WEEK' || type === 'EVERY_WEEKDAY'
    || type === 'ONCE_EVERY_TWO_WEEKS' || type === 'ONCE_EVERY_THREE_WEEKS') return 'WEEKLY';
  if (type === 'EVERY_MONTH') return 'MONTHLY';
  throw new Error(`Unsupported recurrence type: ${type}`);
}

/**
 * 曜日表記をRFC 5545で使用する2文字表記へ正規化する。
 * @param {string|undefined} dayOfWeek Garoonの曜日表記
 * @returns {string|undefined} MOなどのGoogle Calendar用曜日表記
 * @throws {Error} 未対応の曜日表記の場合
 */
function normalizeDayOfWeek(dayOfWeek) {
  if (!dayOfWeek) return undefined;

  const normalized = DAY_OF_WEEK_ALIASES[String(dayOfWeek).toUpperCase()];
  if (!normalized) throw new Error(`Unsupported recurrence dayOfWeek: ${dayOfWeek}`);
  return normalized;
}

/**
 * Google CalendarのiCalUIDとして使用する安定した識別子を作成する。
 * 単発予定はgaroon接頭辞とGaroonイベントIDを使う。
 * 繰り返し予定はrepeatIdを使い、予定内容の変更でUIDが変わることを防ぐ。
 * @param {object} garoonEvent Garoon APIのイベント
 * @returns {string} Google Calendar用のiCalUID
 */
function getRecurrenceKey(garoonEvent) {
  if (!garoonEvent.repeatInfo) return createGaroonUID(garoonEvent.id);

  if (garoonEvent.repeatId) return createGaroonUID(garoonEvent.repeatId);
  return createHashedUID(getRecurrenceData(garoonEvent));
}

/**
 * GaroonのIDに接頭辞を付け、Google Calendar用UIDを作成する。
 * @param {*} value GaroonのイベントIDまたは繰り返しID
 * @returns {string} Google Calendar用のUID
 */
function createGaroonUID(value) {
  if (value === undefined || value === null || String(value).length === 0) {
    return createHashedUID(value);
  }
  return normalizeICalUID(`garoon${value}`, value);
}

/**
 * UID移行前に使用していたBase64URL形式の繰り返しUIDを作成する。
 * @param {object} garoonEvent Garoon APIのイベント
 * @returns {string|undefined} 旧形式UID、単発予定ではundefined
 */
function getLegacyRecurrenceKey(garoonEvent) {
  if (!garoonEvent.repeatInfo) return undefined;

  return `garoon-${Buffer.from(JSON.stringify(getRecurrenceData(garoonEvent))).toString('base64url')}`;
}

/**
 * repeatId導入前に使用していたSHA-256形式のUIDを作成する。
 * @param {object} garoonEvent Garoon APIのイベント
 * @returns {string|undefined} 過去形式UID、単発予定ではundefined
 */
function getHistoricalRecurrenceKey(garoonEvent) {
  if (!garoonEvent.repeatInfo) return undefined;

  return createHashedUID(getRecurrenceData(garoonEvent));
}

/**
 * UID生成に使用する繰り返し予定の内容を抽出する。
 * @param {object} garoonEvent Garoon APIのイベント
 * @returns {object} シリーズの識別に必要な値
 */
function getRecurrenceData(garoonEvent) {
  const repeatInfo = garoonEvent.repeatInfo;
  return {
    subject: garoonEvent.subject,
    notes: garoonEvent.notes,
    attendees: (garoonEvent.attendees || []).map(attendee => attendee.name),
    type: repeatInfo.type,
    period: repeatInfo.period,
    time: repeatInfo.time,
    timeZone: repeatInfo.timeZone,
    isAllDay: repeatInfo.isAllDay,
    isStartOnly: repeatInfo.isStartOnly,
    dayOfWeek: repeatInfo.dayOfWeek,
    dayOfMonth: repeatInfo.dayOfMonth,
    exclusiveDateTimes: repeatInfo.exclusiveDateTimes,
  };
}

/**
 * iCalUIDとして利用できない値を決定論的なハッシュへ置き換える。
 * @param {*} value UID候補
 * @param {*} [fallbackValue=value] ハッシュ化に使う代替値
 * @returns {string} Google Calendarで利用可能なUID
 */
function normalizeICalUID(value, fallbackValue = value) {
  if (typeof value === 'string' && value.length > 0 && value.length <= 1024 && /^[\x21-\x7E]+$/.test(value)) {
    return value;
  }

  const serializedValue = JSON.stringify(fallbackValue) ?? String(fallbackValue);
  return createHashedUID(serializedValue);
}

/**
 * 値をSHA-256でハッシュ化し、Garoon用UID接頭辞を付ける。
 * @param {*} value ハッシュ化する値
 * @returns {string} ハッシュ化されたUID
 */
function createHashedUID(value) {
  const serializedValue = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  return `garoon-${crypto.createHash('sha256').update(serializedValue).digest('hex')}`;
}

/**
 * RFC 5545のローカル日時部分に使用する形式へ変換する。
 * @param {string} dateTime ISO 8601形式の日時
 * @returns {string} 区切り文字を除いたローカル日時
 */
function formatLocalDateTime(dateTime) {
  return dateTime.slice(0, 19).replaceAll(/[-:]/g, '');
}

/**
 * 日付文字列に1日加算する。
 * @param {string} date YYYY-MM-DD形式の日付
 * @returns {string} 1日後の日付
 */
function addDays(date) {
  const nextDate = new Date(`${date}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return nextDate.toISOString().slice(0, 10);
}

module.exports = {
  convertGaroonToGoogleEvent,
  getRecurrenceKey,
  getLegacyRecurrenceKey,
  getHistoricalRecurrenceKey,
};