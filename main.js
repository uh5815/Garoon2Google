const { loadConfig } = require('./lib/config');
const { getGaroonEvents } = require('./lib/garoon');
const { authorize, addEventToGoogleCalendar, getGoogleCalendarEvents, updateEventInGoogleCalendar } = require('./lib/googleCalendar');
const { convertGaroonToGoogleEvent } = require('./lib/eventConverter');
const fs = require('fs').promises;

async function loadGoogleCredentials(credentialsPath) {
  const credentials = await fs.readFile(credentialsPath, 'utf8');
  return JSON.parse(credentials);
}

async function synchronizeEvents(garoonEvents, googleEvents, googleAuth, calendarId) {
  for (const garoonEvent of garoonEvents) {
    try {
      const googleEvent = convertGaroonToGoogleEvent(garoonEvent);
      const existingEvent = googleEvents.find(event => event.iCalUID === googleEvent.iCalUID);

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
  } catch (error) {
    console.error('Error:', error.message);
  }
}

if (require.main === module) {
  main();
}

module.exports = { loadGoogleCredentials, synchronizeEvents, main };