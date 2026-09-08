//GaroonイベントをGoogleカレンダーイベントに変換する関数
function convertGaroonToGoogleEvent(garoonEvent) {
  // googleCalendarの「参加者」はemailが必須のため、garoonの「参加者」をそのまま登録不可。
  // そのため、garoonの「参加者」は「メモ」と合わせてをgoogleCalendarの「説明」に設定する。
  const description = "▼参加者<br>" + garoonEvent.attendees.map(attendee => attendee.name.replace(/　/g, '')).join(', ') + "<br><br>" + garoonEvent.notes;

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

  const repeatInfo = garoonEvent.repeatInfo;
  if (repeatInfo && garoonEvent.repeatId) {
    const frequency = getRecurrenceFrequency(repeatInfo.type);
    const recurrence = [`RRULE:FREQ=${frequency}`];
    const dayOfWeek = repeatInfo.dayOfWeek;
    const dayOfMonth = repeatInfo.dayOfMonth;
    const until = repeatInfo.period?.end?.replaceAll('-', '');
    if (dayOfWeek) recurrence[0] += `;BYDAY=${dayOfWeek}`;
    if (repeatInfo.type === 'EVERY_WEEKDAY') recurrence[0] += ';BYDAY=MO,TU,WE,TH,FR';
    if (dayOfMonth) recurrence[0] += `;BYMONTHDAY=${dayOfMonth}`;
    if (until) recurrence[0] += `;UNTIL=${isAllDay ? until : `${until}T235959Z`}`;

    const excludedDates = (repeatInfo.exclusiveDateTimes || [])
      .map(excluded => excluded.start)
      .filter(Boolean)
      .map(excluded => isAllDay
        ? `EXDATE;VALUE=DATE:${excluded.slice(0, 10).replaceAll('-', '')}`
        : `EXDATE;TZID=${start.timeZone || repeatInfo.timeZone}:${formatLocalDateTime(excluded)}`);
    googleEvent.recurrence = [...recurrence, ...excludedDates];
  }

  return googleEvent;
}

function getRecurrenceFrequency(type) {
  if (type === 'EVERY_3RDWEEK') return 'WEEKLY;INTERVAL=3';
  if (type === 'EVERY_WEEK' || type === 'EVERY_WEEKDAY') return 'WEEKLY';
  if (type === 'EVERY_MONTH') return 'MONTHLY';
  throw new Error(`Unsupported recurrence type: ${type}`);
}

function getRecurrenceKey(garoonEvent) {
  if (!garoonEvent.repeatInfo) return garoonEvent.id;

  const repeatInfo = garoonEvent.repeatInfo;
  const seriesData = {
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
  return `garoon-${Buffer.from(JSON.stringify(seriesData)).toString('base64url')}`;
}

function formatLocalDateTime(dateTime) {
  return dateTime.slice(0, 19).replaceAll(/[-:]/g, '');
}

function addDays(date) {
  const nextDate = new Date(`${date}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  return nextDate.toISOString().slice(0, 10);
}

module.exports = { convertGaroonToGoogleEvent, getRecurrenceKey };