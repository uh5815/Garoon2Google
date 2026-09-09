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

/**
 * @typedef {Object} GaroonEvent
 * @property {string} id Garoon event identifier.
 * @property {string} subject Event title.
 * @property {Object} [start] Event start value.
 * @property {string} [start.date] Start date for an all-day event.
 * @property {string} [start.dateTime] Start date-time.
 * @property {string} [start.timeZone] IANA time zone.
 * @property {Object} [end] Event end value.
 * @property {string} [end.date] End date for an all-day event.
 * @property {string} [end.dateTime] End date-time.
 * @property {string} [end.timeZone] IANA time zone.
 * @property {Array<{name: string}>} [attendees] Event attendees.
 * @property {string} [notes] Event notes.
 * @property {string} [repeatId] Garoon recurrence identifier.
 * @property {GaroonRepeatInfo} [repeatInfo] Recurrence settings.
 */

/**
 * @typedef {Object} GaroonRepeatInfo
 * @property {string} type Recurrence type.
 * @property {boolean} [isAllDay] Whether the recurrence is all-day.
 * @property {string} [timeZone] IANA time zone.
 * @property {string} [dayOfWeek] Recurrence weekday.
 * @property {string|number} [dayOfMonth] Recurrence day of month.
 * @property {{end?: string}} [period] Recurrence period.
 * @property {Array<{start?: string}>} [exclusiveDateTimes] Excluded occurrences.
 */

/**
 * @typedef {Object} GoogleCalendarEvent
 * @property {string} summary Event title.
 * @property {string} iCalUID Stable cross-calendar event identifier.
 * @property {{date?: string, dateTime?: string, timeZone?: string}} start Event start.
 * @property {{date?: string, dateTime?: string, timeZone?: string}} end Event end.
 * @property {string} description Event description.
 * @property {string[]} [recurrence] Google Calendar recurrence rules.
 */

/**
 * Converts a Garoon event into a Google Calendar event resource.
 *
 * @param {GaroonEvent} garoonEvent Source Garoon event.
 * @returns {GoogleCalendarEvent} Google Calendar event resource.
 * @throws {Error} If the event has an invalid date or time range.
 */
function convertGaroonToGoogleEvent(garoonEvent) {
  const description = createDescription(garoonEvent);

  const start = garoonEvent.start || {};
  const end = garoonEvent.end || {};
  const hasDateRange = Boolean(start.date && end.date);
  const hasDateTimeRange = Boolean(start.dateTime && end.dateTime);
  const isAllDay = garoonEvent.repeatInfo?.isAllDay === true
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
 * Creates the synchronized description, including attendee names and notes.
 *
 * @param {GaroonEvent} garoonEvent Source Garoon event.
 * @returns {string} HTML-formatted event description.
 */
function createDescription(garoonEvent) {
  const attendees = (garoonEvent.attendees || [])
    .map(attendee => attendee.name.replace(/　/g, ''))
    .join(', ');
  return `▼参加者<br>${attendees}<br><br>${garoonEvent.notes || ''}`;
}

/**
 * Creates Google Calendar recurrence rules for a recurring Garoon event.
 *
 * @param {GaroonEvent} garoonEvent Source Garoon event.
 * @param {boolean} isAllDay Whether the event is all-day.
 * @param {string} [timeZone] Event time zone.
 * @returns {string[]|undefined} RRULE and EXDATE values, or undefined for a single event.
 */
function createRecurrence(garoonEvent, isAllDay, timeZone) {
  const repeatInfo = garoonEvent.repeatInfo;
  if (!repeatInfo || !garoonEvent.repeatId) return undefined;

  const recurrence = [`RRULE:FREQ=${getRecurrenceFrequency(repeatInfo.type)}`];
  const dayOfWeek = normalizeDayOfWeek(repeatInfo.dayOfWeek);
  const until = repeatInfo.period?.end?.replaceAll('-', '');
  if (repeatInfo.type === 'EVERY_WEEKDAY') recurrence[0] += `;BYDAY=${GOOGLE_WEEKDAYS}`;
  else if (dayOfWeek) recurrence[0] += `;BYDAY=${dayOfWeek}`;
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
 * Maps a Garoon recurrence type to a Google Calendar frequency rule.
 *
 * @param {string} type Garoon recurrence type.
 * @returns {string} Google Calendar frequency value.
 * @throws {Error} If the recurrence type is unsupported.
 */
function getRecurrenceFrequency(type) {
  if (type === 'EVERY_3RDWEEK') return 'WEEKLY;INTERVAL=3';
  if (type === 'EVERY_WEEK' || type === 'EVERY_WEEKDAY') return 'WEEKLY';
  if (type === 'EVERY_MONTH') return 'MONTHLY';
  throw new Error(`Unsupported recurrence type: ${type}`);
}

/**
 * Normalizes a weekday name to an RFC 5545 two-letter weekday code.
 *
 * @param {string} [dayOfWeek] Garoon weekday value.
 * @returns {string|undefined} Normalized weekday code.
 * @throws {Error} If the weekday is unsupported.
 */
function normalizeDayOfWeek(dayOfWeek) {
  if (!dayOfWeek) return undefined;

  const normalized = DAY_OF_WEEK_ALIASES[String(dayOfWeek).toUpperCase()];
  if (!normalized) throw new Error(`Unsupported recurrence dayOfWeek: ${dayOfWeek}`);
  return normalized;
}

/**
 * Returns the stable iCalendar UID used for a Garoon event.
 *
 * Single events use the Garoon event ID. Recurring events use a SHA-256 hash
 * of their recurrence-defining data so every occurrence shares one UID.
 *
 * @param {GaroonEvent} garoonEvent Source Garoon event.
 * @returns {string} Stable iCalendar UID.
 */
function getRecurrenceKey(garoonEvent) {
  if (!garoonEvent.repeatInfo) return normalizeICalUID(garoonEvent.id);

  return `garoon-${crypto.createHash('sha256').update(JSON.stringify(getRecurrenceData(garoonEvent))).digest('hex')}`;
}

/**
 * Returns the legacy UID used by older recurring-event synchronization.
 *
 * @param {GaroonEvent} garoonEvent Source Garoon event.
 * @returns {string|undefined} Legacy UID, or undefined for a single event.
 */
function getLegacyRecurrenceKey(garoonEvent) {
  if (!garoonEvent.repeatInfo) return undefined;

  return `garoon-${Buffer.from(JSON.stringify(getRecurrenceData(garoonEvent))).toString('base64url')}`;
}

/**
 * Selects the Garoon fields that define a recurring event's identity.
 *
 * @param {GaroonEvent} garoonEvent Source Garoon event.
 * @returns {Object} Recurrence identity data.
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
 * Keeps a valid iCalendar UID or creates a deterministic fallback UID.
 *
 * @param {*} value Candidate UID.
 * @param {*} [fallbackValue=value] Value to hash when the candidate is invalid.
 * @returns {string} Valid iCalendar UID.
 */
function normalizeICalUID(value, fallbackValue = value) {
  if (typeof value === 'string' && value.length > 0 && value.length <= 1024 && /^[\x21-\x7E]+$/.test(value)) {
    return value;
  }

  const serializedValue = JSON.stringify(fallbackValue) ?? String(fallbackValue);
  return `garoon-${crypto.createHash('sha256').update(serializedValue).digest('hex')}`;
}

/**
 * Formats an ISO local date-time for an EXDATE rule.
 *
 * @param {string} dateTime ISO date-time value.
 * @returns {string} Date-time without separators or an offset.
 */
function formatLocalDateTime(dateTime) {
  return dateTime.slice(0, 19).replaceAll(/[-:]/g, '');
}

/**
 * Returns the day after an ISO date.
 *
 * @param {string} date ISO date.
 * @returns {string} The next ISO date.
 */
function addDays(date) {
  const nextDate = new Date(`${date}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return nextDate.toISOString().slice(0, 10);
}

module.exports = { convertGaroonToGoogleEvent, getRecurrenceKey, getLegacyRecurrenceKey };