//GaroonイベントをGoogleカレンダーイベントに変換する関数
function convertGaroonToGoogleEvent(garoonEvent) {
  // googleCalendarの「参加者」はemailが必須のため、garoonの「参加者」をそのまま登録不可。
  // そのため、garoonの「参加者」は「メモ」と合わせてをgoogleCalendarの「説明」に設定する。
  const description = "▼参加者<br>" + garoonEvent.attendees.map(attendee => attendee.name.replace(/　/g, '')).join(', ') + "<br><br>" + garoonEvent.notes;

  // 終日イベントの場合はdateを使用、そうでない場合はdateTimeを使用
  const startField = garoonEvent.isAllDay
    ? { date: garoonEvent.start.date }
    : { dateTime: garoonEvent.start.dateTime, timeZone: garoonEvent.start.timeZone };
  
  const endField = garoonEvent.isAllDay
    ? { date: garoonEvent.end.date }
    : { dateTime: garoonEvent.end.dateTime, timeZone: garoonEvent.end.timeZone };

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