const { loadConfig } = require('./lib/config');
const { getGaroonEvents } = require('./lib/garoon');
const { authorize, addEventToGoogleCalendar, getGoogleCalendarEvents, getGoogleCalendarEventByICalUID, updateEventInGoogleCalendar, deleteEventFromGoogleCalendar } = require('./lib/googleCalendar');
const { convertGaroonToGoogleEvent, getRecurrenceKey, getLegacyRecurrenceKey } = require('./lib/eventConverter');
const { logger, cleanupOldLogs } = require('./logger');
const fs = require('fs').promises;

async function loadGoogleCredentials(credentialsPath) {
  const credentials = await fs.readFile(credentialsPath, 'utf8');
  return JSON.parse(credentials);
}

async function synchronizeEvents(garoonEvents, googleEvents, googleAuth, calendarId) {
  const eventsToSynchronize = new Map();
  for (const garoonEvent of garoonEvents) {
    const key = getRecurrenceKey(garoonEvent);
    if (!eventsToSynchronize.has(key)) eventsToSynchronize.set(key, garoonEvent);
  }

  for (const garoonEvent of eventsToSynchronize.values()) {
    try {
      const googleEvent = convertGaroonToGoogleEvent(garoonEvent);
      const legacyICalUID = getLegacyRecurrenceKey(garoonEvent);
      const existingEvent = googleEvents.find(event => (
        event.iCalUID === googleEvent.iCalUID || event.iCalUID === legacyICalUID
      ))
        || await getGoogleCalendarEventByICalUID(googleAuth, calendarId, googleEvent.iCalUID)
        || (legacyICalUID && await getGoogleCalendarEventByICalUID(googleAuth, calendarId, legacyICalUID));

      if (existingEvent) {
        const updatedEvent = { ...existingEvent, ...googleEvent };
        await updateEventInGoogleCalendar(googleAuth, updatedEvent, calendarId);
        logger.info(`Event updated in Google Calendar: ${googleEvent.summary}`);
      } else {
        await addEventToGoogleCalendar(googleAuth, googleEvent, calendarId);
        logger.info(`Event added in Google Calendar: ${googleEvent.summary}`);
      }
    } catch (eventError) {
      logger.error(`Failed to add/update event in Google Calendar: ${eventError.message}`);
    }
  }
}

function findGoogleEventsToDelete(garoonEvents, googleEvents) {
  const garoonEventIds = new Set(garoonEvents.flatMap(event => [
    event.id,
    getRecurrenceKey(event),
    getLegacyRecurrenceKey(event),
  ].filter(Boolean)));
  return googleEvents.filter(event => (
    !event.deleted &&
    event.status !== 'cancelled' &&
    event.description?.startsWith('▼参加者<br>') &&
    !garoonEventIds.has(event.iCalUID)
  ));
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

    const credentials = await loadGoogleCredentials(config.common.googleCredentialsPath);
    logger.info('Credentials loaded successfully');

    const googleAuth = await authorize(credentials);
    logger.info('Google authorization successful');

    const googleEvents = await getGoogleCalendarEvents(googleAuth, config.users.calendarId);
    logger.info('Google Calendar events fetched successfully');

    await synchronizeEvents(garoonEvents, googleEvents, googleAuth, config.users.calendarId);
    await deleteRemovedEvents(garoonEvents, googleEvents, googleAuth, config.users.calendarId);
  } catch (error) {
    logger.error(`Error: ${error.message}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { loadGoogleCredentials, synchronizeEvents, findGoogleEventsToDelete, deleteRemovedEvents, main };