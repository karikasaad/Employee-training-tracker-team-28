// EN: the Express app of Service 1 - Employee & Training (no listen() call, so the tests can start it on
//     a random port). Dependencies (db, auth settings, today) can be passed in, so the tests can use a test
//     database and test tokens. S1 calls no other service.
// Franco: el Express app bta3 Service 1 (men gheir listen, 3ashan el tests teshaghalo 3ala port 3ashwa2i).
//     El dependencies (db, settings el auth, today) momken tetba3at, f el tests betesta3mel database
//     tagrebeya w tokens tagrebeya. S1 mabetnadeesh ay service tanya.
'use strict';
const express = require('express');
const { createAuth } = require('../../common/auth');
const { createLogger, requestIdMiddleware, requestLogger } = require('../../common/logging');
const { notFoundHandler, errorHandler } = require('../../common/errors');
const { createRepo } = require('./repo');
const { createAccess } = require('./access');
const { createEmployeesRouter } = require('./routes/employees');
const { createTeamsRouter } = require('./routes/teams');
const { createTrainingsRouter } = require('./routes/trainings');
const { createAssignmentsRouter } = require('./routes/assignments');
const { todayUtc } = require('./rules');

// EN: The database pool is created on first use. It logs in with DB_USER / DB_PASSWORD from the
//     environment, which must be S1's own least-privilege role svc_s1 (never the admin user).
// Franco: El pool bta3 el database beyet3emel awel ma nesta3melo. Beydkhol b DB_USER / DB_PASSWORD men el
//     environment, w lazem yeb2a el role bta3 S1 svc_s1 (3omro ma yeb2a el admin).
function lazyDb(dbConfig) {
  let real = null;
  const get = () => {
    if (!real) {
      const { Pool } = require('pg');
      const { createDb, poolConfigFromEnv } = require('../../common/db');
      // EN: dbConfig comes from Secrets Manager in Docker (see server.js); otherwise from the environment.
      // Franco: dbConfig gay men Secrets Manager fel Docker (shoof server.js); gheir kda men el environment.
      real = createDb({ pool: new Pool(dbConfig || poolConfigFromEnv()) });
    }
    return real;
  };
  return {
    query: (sql, params) => get().query(sql, params),
    queryOne: (sql, params) => get().queryOne(sql, params),
    withTransaction: (work) => get().withTransaction(work),
  };
}

// EN: The real auth needs the Cognito settings from the environment. It is created on first use, so
//     /health keeps working when they are missing. resolveEmployeeId maps the token's "sub" to our
//     employees.id, so every route knows WHO is calling from the token alone.
// Franco: El auth el 7a2i2i me7tag settings Cognito men el environment. Beyet3emel awel ma nesta3melo,
//     3ashan /health yefdal shaghal. resolveEmployeeId bey7awwel el "sub" bta3 el token le employees.id,
//     f kol route te3raf MEEN elly beyetlob men el token bas.
function lazyAuth(authOptions, repo) {
  let real = null;
  return {
    requireAuth(roles) {
      return (req, res, next) => {
        try {
          if (!real) real = createAuth({ ...authOptions, resolveEmployeeId: (sub) => repo.employeeIdBySub(sub) });
        } catch (err) {
          return next(err); // EN: missing config -> 500, never "let it through" / Franco: mafeesh config -> 500
        }
        return real.requireAuth(roles)(req, res, next);
      };
    },
  };
}

function createApp(deps = {}) {
  const logger = deps.logger || createLogger('employee-training');
  const repo = createRepo(deps.db || lazyDb(deps.dbConfig));
  const auth = lazyAuth(deps.authOptions || {}, repo);
  const access = createAccess(repo);
  // EN: "today" (UTC) can be replaced in tests; the business rules always use this one function.
  // Franco: "el naharda" (UTC) momken yetghayyar fel tests; el rules dayman betesta3mel el function di.
  const today = deps.today || (() => todayUtc());

  const app = express();
  app.disable('x-powered-by'); // EN: do not advertise the framework / Franco: mate2olsh en da Express
  app.use(requestIdMiddleware);
  app.use(requestLogger(logger));
  // EN: JSON bodies only, max 100 KB; bigger -> 413, broken JSON -> 400 (handled by errorHandler).
  // Franco: JSON bas, 100 KB bel kteer; akbar -> 413, JSON ba2ez -> 400.
  app.use(express.json({ limit: '100kb' }));

  // EN: health check used by Docker, nginx and the team to see the service is alive (no login needed).
  // Franco: check en el service 7ayya; bey-estakhdemo Docker w nginx w e7na (mafeesh login).
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'employee-training' });
  });

  app.use(createEmployeesRouter({ auth, repo, access }));
  app.use(createTeamsRouter({ auth, repo, access, today }));
  app.use(createTrainingsRouter({ auth, repo, access }));
  app.use(createAssignmentsRouter({ auth, repo, access, today }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger)); // EN: must be last / Franco: lazem yeb2a akher wa7ed
  return app;
}

module.exports = { createApp };
