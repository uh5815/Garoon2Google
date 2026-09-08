const { loadConfig } = require('./lib/config');
const { getGaroonEvents } = require('./lib/garoon');
const { authorize, addEventToGoogleCalendar, getGoogleCalendarEvents, getGoogleCalendarEventByICalUID, updateEventInGoogleCalendar, deleteEventFromGoogleCalendar } = require('./lib/googleCalendar');
const { convertGaroonToGoogleEvent, getRecurrenceKey } = require('./lib/eventConverter');
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
      const existingEvent = googleEvents.find(event => event.iCalUID === googleEvent.iCalUID)
        || await getGoogleCalendarEventByICalUID(googleAuth, calendarId, googleEvent.iCalUID);

      if (existingEvent) {
        const updatedEvent = { ...existingEvent, ...googleEvent };
        await updateEventInGoogleCalendar(googleAuth, updatedEvent, calendarId);
        console.log(`Event updated in Google Calendar: ${googleEvent.summary}`);
      } else {
        await addEventToGoogleCalendar(googleAuth, googleEvent, calendarId);
        console.log(`Event added in Google Calendar: ${googleEvent.summary}`);
      }
    } catch (eventError) {
      console.error(`Failed to add/update event in Google Calendar: ${eventError.message}`);
    }
  }
}

function findGoogleEventsToDelete(garoonEvents, googleEvents) {
  const garoonEventIds = new Set(garoonEvents.flatMap(event => [event.id, getRecurrenceKey(event)].filter(Boolean)));
  return googleEvents.filter(event => (
    !event.deleted &&
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
      console.error(`Failed to delete event from Google Calendar: ${deleteError.message}`);
    }
  }
}

async function main() {
  try {
    const config = await loadConfig();
    console.log('Config loaded successfully');

    const garoonEvents = await getGaroonEvents(config);
    console.log('Garoon events fetched successfully');

    const credentials = await loadGoogleCredentials(config.common.googleCredentialsPath);
    console.log('Credentials loaded successfully');

    const googleAuth = await authorize(credentials);
    console.log('Google authorization successful');

    const googleEvents = await getGoogleCalendarEvents(googleAuth, config.users.calendarId);
    console.log('Google Calendar events fetched successfully');

    await synchronizeEvents(garoonEvents, googleEvents, googleAuth, config.users.calendarId);
    await deleteRemovedEvents(garoonEvents, googleEvents, googleAuth, config.users.calendarId);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

if (require.main === module) {
  main();
}

module.exports = { loadGoogleCredentials, synchronizeEvents, findGoogleEventsToDelete, deleteRemovedEvents, main };