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

function createDescription(garoonEvent) {
  const attendees = (garoonEvent.attendees || [])
    .map(attendee => attendee.name.replace(/　/g, ''))
    .join(', ');
  return `▼参加者<br>${attendees}<br><br>${garoonEvent.notes || ''}`;
}

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

function getRecurrenceFrequency(type) {
  if (type === 'EVERY_3RDWEEK') return 'WEEKLY;INTERVAL=3';
  if (type === 'EVERY_WEEK' || type === 'EVERY_WEEKDAY') return 'WEEKLY';
  if (type === 'EVERY_MONTH') return 'MONTHLY';
  throw new Error(`Unsupported recurrence type: ${type}`);
}

function normalizeDayOfWeek(dayOfWeek) {
  if (!dayOfWeek) return undefined;

  const normalized = DAY_OF_WEEK_ALIASES[String(dayOfWeek).toUpperCase()];
  if (!normalized) throw new Error(`Unsupported recurrence dayOfWeek: ${dayOfWeek}`);
  return normalized;
}

function getRecurrenceKey(garoonEvent) {
  if (!garoonEvent.repeatInfo) return normalizeICalUID(garoonEvent.id);

  return `garoon-${crypto.createHash('sha256').update(JSON.stringify(getRecurrenceData(garoonEvent))).digest('hex')}`;
}

function getLegacyRecurrenceKey(garoonEvent) {
  if (!garoonEvent.repeatInfo) return undefined;

  return `garoon-${Buffer.from(JSON.stringify(getRecurrenceData(garoonEvent))).toString('base64url')}`;
}

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

function normalizeICalUID(value, fallbackValue = value) {
  if (typeof value === 'string' && value.length > 0 && value.length <= 1024 && /^[\x21-\x7E]+$/.test(value)) {
    return value;
  }

  const serializedValue = JSON.stringify(fallbackValue) ?? String(fallbackValue);
  return `garoon-${crypto.createHash('sha256').update(serializedValue).digest('hex')}`;
}

function formatLocalDateTime(dateTime) {
  return dateTime.slice(0, 19).replaceAll(/[-:]/g, '');
}

function addDays(date) {
  const nextDate = new Date(`${date}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return nextDate.toISOString().slice(0, 10);
}

module.exports = { convertGaroonToGoogleEvent, getRecurrenceKey, getLegacyRecurrenceKey };