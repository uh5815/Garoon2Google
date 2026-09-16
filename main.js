const { loadConfig } = require('./lib/config');
const { getGaroonEvents } = require('./lib/garoon');
const {
  authorize,
  addEventToGoogleCalendar,
  getGoogleCalendarEvents,
  getGoogleCalendarEventByICalUID,
  updateEventInGoogleCalendar,
  deleteEventFromGoogleCalendar,
} = require('./lib/googleCalendar');
const {
  convertGaroonToGoogleEvent,
  getRecurrenceKey,
} = require('./lib/eventConverter');
const { logger, cleanupOldLogs } = require('./logger');
const fs = require('fs').promises;
const { isDeepStrictEqual } = require('node:util');

const SYNCHRONIZED_EVENT_FIELDS = ['summary', 'description', 'start', 'end', 'recurrence'];

/**
 * Google OAuth認証情報JSONを読み込む。
 * @param {string} credentialsPath Google Cloudから取得した認証情報JSONのパス
 * @returns {Promise<object>} 認証情報オブジェクト
 */
async function loadGoogleCredentials(credentialsPath) {
  const credentials = await fs.readFile(credentialsPath, 'utf8');
  return JSON.parse(credentials);
}

/**
 * Garoonを正として、イベントを追加・更新する。
 * @param {object[]} garoonEvents Garoonから取得したイベント一覧
 * @param {object[]} googleEvents Google Calendarから取得したイベント一覧
 * @param {object} googleAuth Google APIの認証済みクライアント
 * @param {string} calendarId 同期先Google CalendarのID
 * @returns {Promise<{failedCount: number}>} 同期に失敗したイベント数
 */
async function synchronizeEvents(garoonEvents, googleEvents, googleAuth, calendarId) {
  const eventsToSynchronize = groupEventsByRecurrence(garoonEvents);
  let failedCount = 0;

  for (const garoonEvent of eventsToSynchronize.values()) {
    try {
      await synchronizeEvent(
        garoonEvent,
        googleEvents,
        googleAuth,
        calendarId,
      );
    } catch (eventError) {
      failedCount += 1;
      logger.error(`Failed to add/update event in Google Calendar: ${eventError.message}`);
    }
  }

  return { failedCount };
}

/**
 * 1件のGaroonイベントをGoogle Calendarへ反映する。
 * 既存イベントに差分がない場合は、更新APIを呼び出さない。
 * @param {object} garoonEvent 同期対象のGaroonイベント
 * @param {object[]} googleEvents 取得済みのGoogleイベント一覧
 * @param {object} googleAuth Google APIの認証済みクライアント
 * @param {string} calendarId 同期先Google CalendarのID
 * @returns {Promise<void>}
 */
async function synchronizeEvent(garoonEvent, googleEvents, googleAuth, calendarId) {
  const googleEvent = convertGaroonToGoogleEvent(garoonEvent);
  const existingEvent = await findExistingGoogleEvent(
    garoonEvent,
    googleEvent,
    googleEvents,
    googleAuth,
    calendarId,
  );

  if (!existingEvent) {
    await addEventToGoogleCalendar(googleAuth, googleEvent, calendarId);
    logger.info(`Event added in Google Calendar: ${googleEvent.summary}`);
    return;
  }

  if (!hasEventChanges(existingEvent, googleEvent)) {
    logger.info(`Event unchanged in Google Calendar: ${googleEvent.summary}`);
    return;
  }

  const updatedEvent = { ...existingEvent, ...googleEvent };
  await updateEventInGoogleCalendar(googleAuth, updatedEvent, calendarId);
  logger.info(`Event updated in Google Calendar: ${googleEvent.summary}`);
}

/**
 * 同期対象フィールドだけを比較し、Google側に更新が必要か判定する。
 * 日時は表記ではなく実際の時刻として比較する。
 * @param {object} existingEvent Google Calendarに保存されているイベント
 * @param {object} googleEvent Garoonから変換したイベント
 * @returns {boolean} 更新が必要ならtrue
 */
function hasEventChanges(existingEvent, googleEvent) {
  return SYNCHRONIZED_EVENT_FIELDS.some(field => (
    !isDeepStrictEqual(
      normalizeComparableValue(existingEvent[field], field),
      normalizeComparableValue(googleEvent[field], field),
    )
  ));
}

/**
 * 差分比較用にイベント値を正規化する。
 * @param {*} value 比較対象の値
 * @param {string} field イベントフィールド名
 * @returns {*} 比較用に正規化した値
 */
function normalizeComparableValue(value, field) {
  if (value === undefined && field === 'recurrence') return [];
  if (field === 'recurrence' && Array.isArray(value)) return normalizeRecurrence(value);
  if (!value || typeof value !== 'object') return value;
  if (field === 'start' || field === 'end') return normalizeDateTime(value);
  return value;
}

/**
 * Google Calendarが並べ替えるRRULEのパラメーター順序を比較用に正規化する。
 * @param {string[]} recurrence Google Calendarの繰り返し規則
 * @returns {string[]} 順序差を無視できる繰り返し規則
 */
function normalizeRecurrence(recurrence) {
  return recurrence.map(rule => {
    if (!rule.startsWith('RRULE:')) return rule;

    const [prefix, ...parts] = rule.split(';');
    return [prefix, ...parts.sort()].join(';');
  }).sort();
}

/**
 * Google Calendarの日時オブジェクトを比較用のUTC形式へ変換する。
 * @param {object} value dateまたはdateTimeを持つ日時オブジェクト
 * @returns {object} 比較用日時オブジェクト
 */
function normalizeDateTime(value) {
  if (value.date) return { date: value.date };
  if (!value.dateTime) return value;

  const timestamp = Date.parse(value.dateTime);
  return {
    dateTime: Number.isNaN(timestamp) ? value.dateTime : new Date(timestamp).toISOString(),
    timeZone: value.timeZone,
  };
}

/**
 * 繰り返しシリーズごとに最初のイベントだけを残す。
 * @param {object[]} garoonEvents Garoonイベント一覧
 * @returns {Map<string, object>} シリーズUIDをキーにしたイベントMap
 */
function groupEventsByRecurrence(garoonEvents) {
  return garoonEvents.reduce((eventsByKey, garoonEvent) => {
    const key = getRecurrenceKey(garoonEvent);
    if (!eventsByKey.has(key)) eventsByKey.set(key, garoonEvent);
    return eventsByKey;
  }, new Map());
}

/**
 * 現行UIDを使ってGoogle側の既存イベントを検索する。
 * @param {object} garoonEvent 検索対象のGaroonイベント
 * @param {object} googleEvent Garoonから変換したイベント
 * @param {object[]} googleEvents 取得済みのGoogleイベント一覧
 * @param {object} googleAuth Google APIの認証済みクライアント
 * @param {string} calendarId 同期先Google CalendarのID
 * @returns {Promise<object|undefined>} 見つかったGoogleイベント、なければundefined
 */
async function findExistingGoogleEvent(garoonEvent, googleEvent, googleEvents, googleAuth, calendarId) {
  const candidateUIDs = [
    googleEvent.iCalUID,
    garoonEvent.id,
    garoonEvent.repeatId && `garoon${garoonEvent.repeatId}`,
  ].filter(Boolean);
  const eventInFetchedList = googleEvents.find(event => (
    candidateUIDs.includes(event.iCalUID)
      && !event.deleted
      && event.status !== 'cancelled'
  ));
  if (eventInFetchedList) return eventInFetchedList;

  for (const iCalUID of candidateUIDs) {
    const existingEvent = await getGoogleCalendarEventByICalUID(googleAuth, calendarId, iCalUID);
    if (existingEvent) return existingEvent;
  }
  return undefined;
}

/**
 * Garoonに存在しない、同期対象のGoogleイベントを抽出する。
 * @param {object[]} garoonEvents 現在のGaroonイベント一覧
 * @param {object[]} googleEvents 現在のGoogleイベント一覧
 * @returns {object[]} 削除対象のGoogleイベント一覧
 */
function findGoogleEventsToDelete(garoonEvents, googleEvents) {
  const activeGaroonEventKeys = getGaroonEventKeys(garoonEvents);
  return googleEvents.filter(event => isManagedEvent(event)
    && !activeGaroonEventKeys.has(event.iCalUID));
}

/**
 * Garoonイベントから、現行UIDの照合キーを作成する。
 * @param {object[]} garoonEvents Garoonイベント一覧
 * @returns {Set<string>} Googleイベント照合用のUID集合
 */
function getGaroonEventKeys(garoonEvents) {
  return new Set(garoonEvents.flatMap(event => [
    event.id,
    getRecurrenceKey(event),
    event.repeatId && `garoon${event.repeatId}`,
  ].filter(Boolean)));
}

/**
 * このプログラムが作成したGoogleイベントか判定する。
 * @param {object} event Google Calendarイベント
 * @returns {boolean} 同期管理対象ならtrue
 */
function isManagedEvent(event) {
  return !event.deleted
    && event.status !== 'cancelled'
    && event.description?.startsWith('▼参加者<br>');
}

/**
 * 新旧設定から同期対象一覧を取得する。
 * @param {object} config アプリケーション設定
 * @returns {object[]} ユーザーとGoogleカレンダーの同期対象
 */
function getSyncTargets(config) {
  if (Array.isArray(config.sync?.targets)) return config.sync.targets;

  if (config.garoon?.user && config.google?.calendarId) {
    return [{
      garoonUser: config.garoon.user,
      googleCalendarId: config.google.calendarId,
    }];
  }

  throw new Error('No sync targets configured');
}

/**
 * Garoonで削除されたGoogleイベントを削除する。
 * @param {object[]} garoonEvents 現在のGaroonイベント一覧
 * @param {object[]} googleEvents 現在のGoogleイベント一覧
 * @param {object} googleAuth Google APIの認証済みクライアント
 * @param {string} calendarId 同期先Google CalendarのID
 * @returns {Promise<{failedCount: number}>} 削除に失敗したイベント数
 */
async function deleteRemovedEvents(garoonEvents, googleEvents, googleAuth, calendarId) {
  const eventsToDelete = findGoogleEventsToDelete(garoonEvents, googleEvents);
  let failedCount = 0;

  for (const googleEvent of eventsToDelete) {
    try {
      await deleteEventFromGoogleCalendar(googleAuth, googleEvent.id, calendarId, googleEvent.summary);
    } catch (deleteError) {
      if (deleteError.code === 404 || deleteError.code === 410) {
        logger.info('Google Calendar event already deleted', { summary: googleEvent.summary });
      } else {
        failedCount += 1;
        logger.error(`Failed to delete event from Google Calendar: ${deleteError.message}`, {
          iCalUID: googleEvent.iCalUID,
          summary: googleEvent.summary,
        });
      }
    }
  }

  return { failedCount };
}

/**
 * 設定読込、Garoon取得、Google認証、同期、削除を順番に実行する。
 * 致命的エラーまたは一部失敗がある場合は終了コードを1にする。
 * @returns {Promise<void>}
 */
async function main() {
  const startedAt = Date.now();
  let runStatus = 'failed';
  logger.info('Synchronization started');

  try {
    await cleanupOldLogs();
    const config = await loadConfig();
    logger.info('Config loaded successfully');

    const credentials = await loadGoogleCredentials(config.google.credentialsPath);
    logger.info('Credentials loaded successfully');

    const googleAuth = await authorize(credentials);
    logger.info('Google authorization successful');

    let synchronizationFailures = 0;
    let deletionFailures = 0;
    for (const target of getSyncTargets(config)) {
      const targetLabel = target.garoonUser.name || target.garoonUser.id;
      try {
        const garoonEvents = await getGaroonEvents(config, target.garoonUser);
        logger.info('Garoon events fetched successfully', { target: targetLabel });

        const googleEvents = await getGoogleCalendarEvents(googleAuth, target.googleCalendarId);
        logger.info('Google Calendar events fetched successfully', { target: targetLabel });

        const synchronizationResult = await synchronizeEvents(
          garoonEvents,
          googleEvents,
          googleAuth,
          target.googleCalendarId,
        );
        const deletionResult = await deleteRemovedEvents(
          garoonEvents,
          googleEvents,
          googleAuth,
          target.googleCalendarId,
        );
        synchronizationFailures += synchronizationResult.failedCount;
        deletionFailures += deletionResult.failedCount;
      } catch (targetError) {
        synchronizationFailures += 1;
        logger.error(`Synchronization failed for ${targetLabel}: ${targetError.message}`);
      }
    }
    if (synchronizationFailures || deletionFailures) {
      logger.error('Synchronization completed with errors', {
        synchronizationFailures,
        deletionFailures,
      });
      process.exitCode = 1;
      runStatus = 'completed with errors';
    } else {
      runStatus = 'completed';
    }
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    process.exitCode = 1;
  } finally {
    logger.info('Synchronization finished', {
      status: runStatus,
      durationMs: Date.now() - startedAt,
    });
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  loadGoogleCredentials,
  synchronizeEvents,
  synchronizeEvent,
  findGoogleEventsToDelete,
  deleteRemovedEvents,
  getSyncTargets,
  hasEventChanges,
  normalizeComparableValue,
  main,
};