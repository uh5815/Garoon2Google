//GaroonイベントをGoogleカレンダーイベントに変換する関数
function convertGaroonToGoogleEvent(garoonEvent) {
  // googleCalendarの「参加者」はemailが必須のため、garoonの「参加者」をそのまま登録不可。
  // そのため、garoonの「参加者」は「メモ」と合わせてをgoogleCalendarの「説明」に設定する。
  const description = "▼参加者<br>" + garoonEvent.attendees.map(attendee => attendee.name.replace(/　/g, '')).join(', ') + "<br><br>" + garoonEvent.notes;

  const start = garoonEvent.start || {};
  const end = garoonEvent.end || {};
  const hasDateRange = Boolean(start.date && end.date);
  const hasDateTimeRange = Boolean(start.dateTime && end.dateTime);
  const isAllDay = hasDateRange && !hasDateTimeRange;

  const startField = isAllDay
    ? { date: start.date }
    : { dateTime: start.dateTime, timeZone: start.timeZone };
  const endField = isAllDay
    ? { date: end.date }
    : { dateTime: end.dateTime, timeZone: end.timeZone };

  if (isAllDay && (!start.date || !end.date)) {
    throw new Error(`All-day event has invalid dates: ${garoonEvent.id}`);
  }
  if (!isAllDay && (!start.dateTime || !end.dateTime)) {
    throw new Error(`Timed event has invalid dateTimes: ${garoonEvent.id}`);
  }

  return {
    summary: garoonEvent.subject,
    iCalUID: garoonEvent.id,
    start: startField,
    end: endField,
    // updated: garoonEvent.updatedAt,
    description: description,
    };
}

module.exports = { convertGaroonToGoogleEvent };