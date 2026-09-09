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
const { convertGaroonToGoogleEvent, getRecurrenceKey, getLegacyRecurrenceKey } = require('./lib/eventConverter');
const { logger, cleanupOldLogs } = require('./logger');
const fs = require('fs').promises;
const { isDeepStrictEqual } = require('node:util');

const SYNCHRONIZED_EVENT_FIELDS = ['summary', 'description', 'start', 'end', 'recurrence'];

async function loadGoogleCredentials(credentialsPath) {
  const credentials = await fs.readFile(credentialsPath, 'utf8');
  return JSON.parse(credentials);
}

async function synchronizeEvents(garoonEvents, googleEvents, googleAuth, calendarId) {
  const eventsToSynchronize = groupEventsByRecurrence(garoonEvents);

  for (const garoonEvent of eventsToSynchronize.values()) {
    try {
      await synchronizeEvent(
        garoonEvent,
        googleEvents,
        googleAuth,
        calendarId,
      );
    } catch (eventError) {
      logger.error(`Failed to add/update event in Google Calendar: ${eventError.message}`);
    }
  }
}

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

function hasEventChanges(existingEvent, googleEvent) {
  return SYNCHRONIZED_EVENT_FIELDS.some(field => (
    !isDeepStrictEqual(existingEvent[field], googleEvent[field])
  ));
}

function groupEventsByRecurrence(garoonEvents) {
  return garoonEvents.reduce((eventsByKey, garoonEvent) => {
    const key = getRecurrenceKey(garoonEvent);
    if (!eventsByKey.has(key)) eventsByKey.set(key, garoonEvent);
    return eventsByKey;
  }, new Map());
}

async function findExistingGoogleEvent(garoonEvent, googleEvent, googleEvents, googleAuth, calendarId) {
  const candidateUIDs = [googleEvent.iCalUID, getLegacyRecurrenceKey(garoonEvent)].filter(Boolean);
  const eventInFetchedList = googleEvents.find(event => candidateUIDs.includes(event.iCalUID));
  if (eventInFetchedList) return eventInFetchedList;

  // Old recurring events used a long Base64URL UID. Keep looking it up during migration.
  for (const iCalUID of candidateUIDs) {
    const existingEvent = await getGoogleCalendarEventByICalUID(googleAuth, calendarId, iCalUID);
    if (existingEvent) return existingEvent;
  }
  return undefined;
}

function findGoogleEventsToDelete(garoonEvents, googleEvents) {
  const activeGaroonEventKeys = getGaroonEventKeys(garoonEvents);
  return googleEvents.filter(event => isManagedEvent(event)
    && !activeGaroonEventKeys.has(event.iCalUID));
}

function getGaroonEventKeys(garoonEvents) {
  return new Set(garoonEvents.flatMap(event => [
    event.id,
    getRecurrenceKey(event),
    getLegacyRecurrenceKey(event),
  ].filter(Boolean)));
}

function isManagedEvent(event) {
  return !event.deleted
    && event.status !== 'cancelled'
    && event.description?.startsWith('▼参加者<br>');
}

async function deleteRemovedEvents(garoonEvents, googleEvents, googleAuth, calendarId) {
  const eventsToDelete = findGoogleEventsToDelete(garoonEvents, googleEvents);

  for (const googleEvent of eventsToDelete) {
    try {
      await deleteEventFromGoogleCalendar(googleAuth, googleEvent.id, calendarId);
    } catch (deleteError) {
      if (deleteError.code === 404 || deleteError.code === 410) {
        logger.info(`Google Calendar event already deleted: ${googleEvent.id}`);
      } else {
        logger.error(`Failed to delete event from Google Calendar: ${deleteError.message}`, {
          eventId: googleEvent.id,
          iCalUID: googleEvent.iCalUID,
          summary: googleEvent.summary,
        });
      }
    }
  }
}

async function main() {
  try {
    await cleanupOldLogs();
    const config = await loadConfig();
    logger.info('Config loaded successfully');

    const garoonEvents = await getGaroonEvents(config);
    logger.info('Garoon events fetched successfully');

    const credentials = await loadGoogleCredentials(config.google.credentialsPath);
    logger.info('Credentials loaded successfully');

    const googleAuth = await authorize(credentials);
    logger.info('Google authorization successful');

    const googleEvents = await getGoogleCalendarEvents(googleAuth, config.google.calendarId);
    logger.info('Google Calendar events fetched successfully');

    await synchronizeEvents(garoonEvents, googleEvents, googleAuth, config.google.calendarId);
    await deleteRemovedEvents(garoonEvents, googleEvents, googleAuth, config.google.calendarId);
  } catch (error) {
    logger.error(`Error: ${error.message}`);
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
  hasEventChanges,
  main,
};