const test = require('node:test');
const assert = require('node:assert/strict');
const {
  convertGaroonToGoogleEvent,
  getRecurrenceKey,
} = require('../lib/eventConverter');
const {
  findGoogleEventsToDelete,
  hasEventChanges,
  getSyncTargets,
} = require('../main');

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
    iCalUID: 'garoonevent-123',
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
  assert.equal(googleEvent.iCalUID, 'garoonall-day-123');
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

test('uses the top-level all-day flag for Garoon events returned with dateTime fields', () => {
  const googleEvent = convertGaroonToGoogleEvent({
    id: 'all-day-datetime-123',
    subject: '終日予定',
    isAllDay: true,
    start: { dateTime: '2026-09-08T00:00:00+09:00', timeZone: 'Asia/Tokyo' },
    end: { dateTime: '2026-09-08T23:59:59+09:00', timeZone: 'Asia/Tokyo' },
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
    { id: 'google-5', iCalUID: 'already-cancelled', status: 'cancelled', description: '▼参加者<br>山田太郎' },
    { id: 'google-4', iCalUID: 'unrelated-google-event', description: '個人の予定' },
  ];

  assert.deepEqual(findGoogleEventsToDelete(garoonEvents, googleEvents), [googleEvents[1]]);
});

test('supports multi-user sync targets and legacy single-target config', () => {
  const targets = [
    { garoonUser: { name: 'A', id: 'a' }, googleCalendarId: 'calendar-a' },
    { garoonUser: { name: 'B', id: 'b' }, googleCalendarId: 'calendar-b' },
  ];

  assert.deepEqual(getSyncTargets({ sync: { targets } }), targets);
  assert.deepEqual(getSyncTargets({
    garoon: { user: { name: 'A', id: 'a' } },
    google: { calendarId: 'calendar-a' },
  }), [targets[0]]);
});

test('uses dateTime fields when they are complete for a non-recurring event', () => {
  const googleEvent = convertGaroonToGoogleEvent({
    id: 'datetime-123',
    subject: '時間指定の予定',
    isAllDay: false,
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

test('converts a recurring all-day event returned with dateTime fields', () => {
  const googleEvent = convertGaroonToGoogleEvent({
    id: 'all-day-series-occurrence',
    repeatId: 'all-day-series',
    subject: '抽選日',
    start: { dateTime: '2026-09-14T00:00:00+09:00', timeZone: 'Asia/Tokyo' },
    end: { dateTime: '2026-09-14T23:59:59+09:00', timeZone: 'Asia/Tokyo' },
    repeatInfo: {
      type: 'EVERY_WEEK',
      isAllDay: true,
      period: { end: '2027-08-06' },
      dayOfWeek: 'MON',
      timeZone: 'Asia/Tokyo',
    },
    attendees: [],
    notes: '',
  });

  assert.deepEqual(googleEvent.start, { date: '2026-09-14' });
  assert.deepEqual(googleEvent.end, { date: '2026-09-15' });
});

test('converts a weekly Garoon series to a Google RRULE', () => {
  const googleEvent = convertGaroonToGoogleEvent({
    id: 'occurrence-123',
    repeatId: 'series-123',
    subject: '定例会',
    start: { dateTime: '2026-09-14T10:30:00+09:00', timeZone: 'Asia/Tokyo' },
    end: { dateTime: '2026-09-14T11:30:00+09:00', timeZone: 'Asia/Tokyo' },
    repeatInfo: {
      type: 'EVERY_WEEK',
      period: { end: '2027-03-31' },
      timeZone: 'Asia/Tokyo',
      dayOfWeek: 'MON',
      exclusiveDateTimes: [{ start: '2026-07-20T00:00:00+09:00' }],
    },
    attendees: [],
    notes: '',
  });

  assert.equal(googleEvent.iCalUID, getRecurrenceKey({
    id: 'occurrence-123',
    repeatId: 'series-123',
    subject: '定例会',
    notes: '',
    attendees: [],
    repeatInfo: {
      type: 'EVERY_WEEK',
      period: { end: '2027-03-31' },
      timeZone: 'Asia/Tokyo',
      dayOfWeek: 'MON',
      exclusiveDateTimes: [{ start: '2026-07-20T00:00:00+09:00' }],
    },
  }));
  assert.deepEqual(googleEvent.recurrence, [
    'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270331T235959Z',
    'EXDATE;TZID=Asia/Tokyo:20260720T000000',
  ]);
});

test('converts a biweekly Thursday series to a Google RRULE', () => {
  const googleEvent = convertGaroonToGoogleEvent({
    id: 'biweekly-thursday-occurrence',
    repeatId: 'biweekly-thursday-series',
    subject: '2週間ごと木曜日',
    start: { dateTime: '2026-09-17T15:00:00+09:00', timeZone: 'Asia/Tokyo' },
    end: { dateTime: '2026-09-17T16:00:00+09:00', timeZone: 'Asia/Tokyo' },
    repeatInfo: {
      type: 'ONCE_EVERY_TWO_WEEKS',
      period: { end: '2027-08-01' },
      dayOfWeek: 'THU',
      timeZone: 'Asia/Tokyo',
    },
    attendees: [],
    notes: '',
  });

  assert.deepEqual(googleEvent.recurrence, [
    'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TH;UNTIL=20270801T235959Z',
  ]);
});

test('converts a three-week Monday series to a Google RRULE', () => {
  const googleEvent = convertGaroonToGoogleEvent({
    id: 'three-week-monday-occurrence',
    repeatId: 'three-week-monday-series',
    subject: '3週間ごと月曜日',
    isAllDay: true,
    start: { dateTime: '2026-10-12T00:00:00+09:00', timeZone: 'Asia/Tokyo' },
    end: { dateTime: '2026-10-12T23:59:59+09:00', timeZone: 'Asia/Tokyo' },
    repeatInfo: {
      type: 'ONCE_EVERY_THREE_WEEKS',
      period: { end: '2026-11-05' },
      dayOfWeek: 'MON',
      timeZone: 'Asia/Tokyo',
      isAllDay: true,
    },
    attendees: [],
    notes: '',
  });

  assert.deepEqual(googleEvent.recurrence, [
    'RRULE:FREQ=WEEKLY;INTERVAL=3;BYDAY=MO;UNTIL=20261105',
  ]);
});

test('converts a third-week all-day series to a monthly Google RRULE', () => {
  const googleEvent = convertGaroonToGoogleEvent({
    id: 'occurrence-456',
    repeatId: 'series-456',
    subject: '定休日',
    start: { date: '2026-09-15' },
    end: { date: '2026-09-16' },
    repeatInfo: {
      type: 'EVERY_3RDWEEK',
      period: { end: '2026-12-31' },
      dayOfWeek: 'TUE',
      exclusiveDateTimes: [{ start: '2026-10-05T00:00:00+09:00' }],
    },
    attendees: [],
    notes: '',
  });

  assert.deepEqual(googleEvent.recurrence, [
    'RRULE:FREQ=MONTHLY;BYDAY=3TU;UNTIL=20261231',
    'EXDATE;VALUE=DATE:20261005',
  ]);
});

test('converts a daily series with excluded dates to a Google RRULE', () => {
  const googleEvent = convertGaroonToGoogleEvent({
    id: 'daily-occurrence',
    repeatId: 'daily-series',
    subject: '毎日予定',
    start: { date: '2026-09-17' },
    end: { date: '2026-09-18' },
    repeatInfo: {
      type: 'EVERY_DAY',
      isAllDay: true,
      period: { end: '2026-10-20' },
      exclusiveDateTimes: [{ start: '2026-09-23T00:00:00+09:00' }],
    },
    attendees: [],
    notes: '',
  });

  assert.deepEqual(googleEvent.recurrence, [
    'RRULE:FREQ=DAILY;UNTIL=20261020',
    'EXDATE;VALUE=DATE:20260923',
  ]);
});

test('converts monthly weekday ordinal series to Google RRULEs', () => {
  const recurrenceCases = [
    ['EVERY_1STWEEK', 'SUN', '1SU'],
    ['EVERY_2NDWEEK', 'MON', '2MO'],
    ['EVERY_4THWEEK', 'WED', '4WE'],
    ['EVERY_LASTWEEK', 'THU', '-1TH'],
  ];

  for (const [type, dayOfWeek, expectedDay] of recurrenceCases) {
    const googleEvent = convertGaroonToGoogleEvent({
      id: `${type}-occurrence`,
      repeatId: `${type}-series`,
      subject: type,
      start: { dateTime: '2026-09-15T15:00:00+09:00', timeZone: 'Asia/Tokyo' },
      end: { dateTime: '2026-09-15T16:00:00+09:00', timeZone: 'Asia/Tokyo' },
      repeatInfo: {
        type,
        period: { end: '2027-08-01' },
        dayOfWeek,
        timeZone: 'Asia/Tokyo',
      },
      attendees: [],
      notes: '',
    });

    assert.equal(
      googleEvent.recurrence[0],
      `RRULE:FREQ=MONTHLY;BYDAY=${expectedDay};UNTIL=20270801T235959Z`,
    );
  }
});

test('converts a monthly day-of-month series to a Google RRULE', () => {
  const googleEvent = convertGaroonToGoogleEvent({
    id: 'monthly-occurrence',
    repeatId: 'monthly-series',
    subject: '月次予定',
    start: { date: '2026-09-11' },
    end: { date: '2026-09-12' },
    repeatInfo: {
      type: 'EVERY_MONTH',
      isAllDay: true,
      period: { end: '2027-09-07' },
      dayOfMonth: '11',
    },
    attendees: [],
    notes: '',
  });

  assert.deepEqual(googleEvent.recurrence, [
    'RRULE:FREQ=MONTHLY;BYMONTHDAY=11;UNTIL=20270907',
  ]);
});

test('does not silently convert an unsupported recurrence type', () => {
  assert.throws(
    () => convertGaroonToGoogleEvent({
      id: 'unsupported-series',
      repeatId: 'unsupported-repeat',
      subject: '未対応予定',
      start: { date: '2026-09-08' },
      end: { date: '2026-09-09' },
      repeatInfo: { type: 'EVERY_YEAR', isAllDay: true },
      attendees: [],
      notes: '',
    }),
    /Unsupported recurrence type: EVERY_YEAR/
  );
});

test('converts weekdays to Monday-through-Friday recurrence', () => {
  const googleEvent = convertGaroonToGoogleEvent({
    id: 'weekday-occurrence',
    repeatId: 'weekday-occurrence-id',
    subject: '平日予定',
    start: { date: '2026-09-08' },
    end: { date: '2026-09-09' },
    repeatInfo: {
      type: 'EVERY_WEEKDAY',
      isAllDay: true,
      period: { end: '2026-10-07' },
    },
    attendees: [],
    notes: '',
  });

  assert.deepEqual(googleEvent.recurrence, [
    'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261007',
  ]);
});

test('normalizes full weekday names before creating a Google RRULE', () => {
  const googleEvent = convertGaroonToGoogleEvent({
    id: 'weekday-name-occurrence',
    repeatId: 'weekday-name-series',
    subject: '定例会',
    start: { dateTime: '2026-09-14T10:30:00+09:00', timeZone: 'Asia/Tokyo' },
    end: { dateTime: '2026-09-14T11:30:00+09:00', timeZone: 'Asia/Tokyo' },
    repeatInfo: {
      type: 'EVERY_WEEK',
      period: { end: '2027-03-31' },
      dayOfWeek: 'Monday',
    },
    attendees: [],
    notes: '',
  });

  assert.equal(googleEvent.recurrence[0], 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270331T235959Z');
});

test('uses the Garoon event ID as the recurring UID even when event content is large', () => {
  const googleEvent = convertGaroonToGoogleEvent({
    id: 'long-uid-occurrence',
    repeatId: 'long-uid-series',
    subject: '長い予定',
    start: { date: '2026-09-14' },
    end: { date: '2026-09-15' },
    repeatInfo: {
      type: 'EVERY_WEEK',
      isAllDay: true,
      dayOfWeek: 'MON',
      notes: 'x'.repeat(2000),
    },
    attendees: [],
    notes: 'x'.repeat(2000),
  });

  assert.equal(googleEvent.iCalUID, 'garoonlong-uid-occurrence');
  assert.ok(googleEvent.iCalUID.length <= 1024);
});

test('uses the Garoon event ID as recurring identity', () => {
  const garoonEvent = {
    id: 'occurrence-790',
    repeatId: 'series-790',
    subject: '変更される予定',
    start: { date: '2026-09-14' },
    end: { date: '2026-09-15' },
    repeatInfo: { type: 'EVERY_WEEK', dayOfWeek: 'MON' },
    attendees: [],
    notes: '',
  };

  assert.equal(getRecurrenceKey(garoonEvent), getRecurrenceKey({
    ...garoonEvent,
    subject: '件名変更後',
    notes: 'メモ変更後',
  }));
  assert.equal(getRecurrenceKey(garoonEvent), 'garoonoccurrence-790');
});

test('keeps one recurring UID when repeatId changes per occurrence', () => {
  const firstOccurrence = {
    id: 'series-791',
    repeatId: '202609170600',
    repeatInfo: { type: 'ONCE_EVERY_TWO_WEEKS', dayOfWeek: 'THU' },
  };
  const secondOccurrence = {
    ...firstOccurrence,
    repeatId: '202610010600',
  };

  assert.equal(getRecurrenceKey(firstOccurrence), 'garoonseries-791');
  assert.equal(getRecurrenceKey(firstOccurrence), getRecurrenceKey(secondOccurrence));
});

test('rejects events without a Garoon event ID', () => {
  assert.throws(
    () => getRecurrenceKey({ subject: 'IDなし予定' }),
    /Garoon event has invalid id: IDなし予定/
  );
});

test('detects whether a synchronized event actually changed', () => {
  const synchronizedEvent = {
    summary: '定例会',
    description: '▼参加者<br>山田太郎<br><br>議題',
    start: { dateTime: '2026-09-08T10:00:00+09:00', timeZone: 'Asia/Tokyo' },
    end: { dateTime: '2026-09-08T11:00:00+09:00', timeZone: 'Asia/Tokyo' },
  };

  assert.equal(hasEventChanges({
    ...synchronizedEvent,
    id: 'google-event-id',
    etag: 'etag',
    updated: '2026-09-08T10:00:00Z',
  }, synchronizedEvent), false);

  assert.equal(hasEventChanges(
    synchronizedEvent,
    { ...synchronizedEvent, summary: '変更後の定例会' },
  ), true);

  assert.equal(hasEventChanges(
    { ...synchronizedEvent, start: { timeZone: 'Asia/Tokyo', dateTime: synchronizedEvent.start.dateTime } },
    synchronizedEvent,
  ), false);

  assert.equal(hasEventChanges(
    synchronizedEvent,
    {
      ...synchronizedEvent,
      start: { dateTime: '2026-09-08T01:00:00.000Z', timeZone: 'Asia/Tokyo' },
      end: { dateTime: '2026-09-08T02:00:00.000Z', timeZone: 'Asia/Tokyo' },
    },
  ), false);

  assert.equal(hasEventChanges(
    {
      ...synchronizedEvent,
      recurrence: ['RRULE:FREQ=MONTHLY;UNTIL=20261016;BYMONTHDAY=10'],
    },
    {
      ...synchronizedEvent,
      recurrence: ['RRULE:FREQ=MONTHLY;BYMONTHDAY=10;UNTIL=20261016'],
    },
  ), false);

  assert.equal(hasEventChanges(
    {
      ...synchronizedEvent,
      recurrence: [
        'EXDATE;TZID=Asia/Tokyo:20260915T000000',
        'RRULE:FREQ=MONTHLY;UNTIL=20270331T235959Z;BYDAY=3TU',
      ],
    },
    {
      ...synchronizedEvent,
      recurrence: [
        'RRULE:FREQ=MONTHLY;BYDAY=3TU;UNTIL=20270331T235959Z',
        'EXDATE;TZID=Asia/Tokyo:20260915T000000',
      ],
    },
  ), false);
});
