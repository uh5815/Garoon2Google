const test = require('node:test');
const assert = require('node:assert/strict');
const { convertGaroonToGoogleEvent } = require('../lib/eventConverter');
const { findGoogleEventsToDelete } = require('../main');

test('converts a timed Garoon event without changing its fields', () => {
  const garoonEvent = {
    id: 'event-123',
    subject: '定例会',
    isAllDay: false,
    start: { dateTime: '2026-09-08T10:00:00+09:00', timeZone: 'Asia/Tokyo' },
    end: { dateTime: '2026-09-08T11:00:00+09:00', timeZone: 'Asia/Tokyo' },
    attendees: [{ name: '山田　太郎' }, { name: '佐藤花子' }],
    notes: '議題を確認',
  };

  assert.deepEqual(convertGaroonToGoogleEvent(garoonEvent), {
    summary: '定例会',
    iCalUID: 'event-123',
    start: { dateTime: '2026-09-08T10:00:00+09:00', timeZone: 'Asia/Tokyo' },
    end: { dateTime: '2026-09-08T11:00:00+09:00', timeZone: 'Asia/Tokyo' },
    description: '▼参加者<br>山田太郎, 佐藤花子<br><br>議題を確認',
  });
});

test('uses date fields for an all-day Garoon event', () => {
  const garoonEvent = {
    id: 'all-day-123',
    subject: '休暇',
    isAllDay: true,
    start: { date: '2026-09-08' },
    end: { date: '2026-09-09' },
    attendees: [],
    notes: '',
  };

  const googleEvent = convertGaroonToGoogleEvent(garoonEvent);

  assert.deepEqual(googleEvent.start, { date: '2026-09-08' });
  assert.deepEqual(googleEvent.end, { date: '2026-09-09' });
  assert.equal(googleEvent.iCalUID, 'all-day-123');
});

test('detects an all-day event from date fields', () => {
  const googleEvent = convertGaroonToGoogleEvent({
    id: 'date-only-123',
    subject: '抽選日',
    start: { date: '2026-09-08' },
    end: { date: '2026-09-09' },
    attendees: [],
    notes: '',
  });

  assert.deepEqual(googleEvent.start, { date: '2026-09-08' });
  assert.deepEqual(googleEvent.end, { date: '2026-09-09' });
});

test('rejects events without a complete time range', () => {
  assert.throws(
    () => convertGaroonToGoogleEvent({
      id: 'invalid-123',
      subject: '不正な予定',
      isAllDay: false,
      start: {},
      end: {},
      attendees: [],
      notes: '',
    }),
    /Timed event has invalid dateTimes: invalid-123/
  );
});

test('finds Google events whose Garoon events were deleted', () => {
  const garoonEvents = [{ id: 'still-exists' }];
  const googleEvents = [
    { id: 'google-1', iCalUID: 'still-exists' },
    { id: 'google-2', iCalUID: 'deleted-in-garoon', description: '▼参加者<br>山田太郎' },
    { id: 'google-3', iCalUID: 'already-deleted', deleted: true },
    { id: 'google-4', iCalUID: 'unrelated-google-event', description: '個人の予定' },
  ];

  assert.deepEqual(findGoogleEventsToDelete(garoonEvents, googleEvents), [googleEvents[1]]);
});

test('uses dateTime fields when they are complete even if isAllDay is true', () => {
  const googleEvent = convertGaroonToGoogleEvent({
    id: 'datetime-123',
    subject: '時間指定の予定',
    isAllDay: true,
    start: { dateTime: '2026-09-08T10:00:00+09:00', timeZone: 'Asia/Tokyo' },
    end: { dateTime: '2026-09-08T11:00:00+09:00', timeZone: 'Asia/Tokyo' },
    attendees: [],
    notes: '',
  });

  assert.deepEqual(googleEvent.start, {
    dateTime: '2026-09-08T10:00:00+09:00',
    timeZone: 'Asia/Tokyo',
  });
  assert.deepEqual(googleEvent.end, {
    dateTime: '2026-09-08T11:00:00+09:00',
    timeZone: 'Asia/Tokyo',
  });
});