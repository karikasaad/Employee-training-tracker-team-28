// EN: the Express app lives here (no listen() call) so the tests can start it on a random port.
// Franco: el Express app hena (men gheir listen) 3ashan el tests teshaghalo 3ala port 3ashwa2i.
// STUB: only /health for now. The service owner replaces this file with the real endpoints.
const express = require('express');

function createApp() {
  const app = express();
  app.disable('x-powered-by'); // EN: do not advertise the framework / Franco: mate2olsh en da Express

  // EN: health check used by Docker, nginx and the team to see the service is alive (no login needed).
  // Franco: check en el service 7ayya; bey-estakhdemo Docker w nginx w e7na (mafeesh login).
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'employee-training' });
  });

  return app;
}

module.exports = { createApp };
