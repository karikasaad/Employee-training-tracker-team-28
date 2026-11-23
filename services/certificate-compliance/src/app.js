// EN: the Express app of Service 2 - Certificate & Compliance (no listen() call, so the tests can start it
//     on a random port). Dependencies (db, auth settings, S1 client, file storage, today) can be passed in,
//     so the tests use fakes. By default everything is created on first use, so /health always works.
// Franco: el Express app bta3 Service 2 (men gheir listen, 3ashan el tests teshaghalo 3ala port 3ashwa2i).
//     El dependencies (db, settings el auth, client S1, storage, today) momken tetba3at, f el tests betesta3mel
//     fakes. By default kol 7aga betet3emel awel ma nesta3melha, f /health dayman beyeshtaghal.
'use strict';
const express = require('express');
const { createAuth } = require('../../common/auth');
const { createLogger, requestIdMiddleware, requestLogger } = require('../../common/logging');
const { notFoundHandler, errorHandler } = require('../../common/errors');
const { createRepo } = require('./repo');
const { createStorage } = require('./storage');
const { createUpstream } = require('./upstream');
const { createCertificatesRouter } = require('./routes/certificates');
const { createManageRouter } = require('./routes/manage');
const { createReviewRouter } = require('./routes/review');
const { createComplianceRouter } = require('./routes/compliance');
const { createAccess } = require('./access');
const { createMailer } = require('./mailer');
const { createDailyCheck } = require('./dailyCheck');

// EN: the database pool is created on first use. It logs in with DB_USER / DB_PASSWORD from the
//     environment, which must be S2's own least-privilege role svc_s2 (never the admin user).
// Franco: el pool bta3 el database beyet3emel awel ma nesta3melo. Beydkhol b DB_USER / DB_PASSWORD men el
//     environment, w lazem yeb2a el role bta3 S2 svc_s2 (3omro ma yeb2a el admin).
function lazyDb() {
  let real = null;
  const get = () => {
    if (!real) {
      const { Pool } = require('pg');
      const { createDb, poolConfigFromEnv } = require('../../common/db');
      real = createDb({ pool: new Pool(poolConfigFromEnv()) });
    }
    return real;
  };
  return {
    query: (sql, params) => get().query(sql, params),
    queryOne: (sql, params) => get().queryOne(sql, params),
    withTransaction: (work) => get().withTransaction(work),
  };
}

// EN: the real auth needs the Cognito settings from the environment; created on first use.
//     Missing settings -> 500, never "let it through".
// Franco: el auth el 7a2i2i me7tag settings Cognito; beyet3emel awel ma nesta3melo.
//     Settings na2sa -> 500, 3omrena ma nedakhkhal.
function lazyAuth(authOptions) {
  let real = null;
  return {
    requireAuth(roles) {
      return (req, res, next) => {
        try {
          if (!real) real = createAuth(authOptions);
        } catch (err) {
          return next(err);
        }
        return real.requireAuth(roles)(req, res, next);
      };
    },
  };
}

// EN: today's date in UTC as YYYY-MM-DD (all "today" rules in the contract use UTC).
// Franco: tareekh el yom bel UTC bel shakl YYYY-MM-DD (kol rules "today" fel contract UTC).
const utcToday = () => new Date().toISOString().slice(0, 10);

function createApp(deps = {}) {
  const logger = deps.logger || createLogger('certificate-compliance');
  const repo = createRepo(deps.db || lazyDb());
  const auth = deps.auth || lazyAuth(deps.authOptions || {});
  const upstream = deps.upstream || createUpstream();
  const storage = deps.storage || createStorage();
  const today = deps.today || utcToday;
  const access = createAccess({ upstream, repo });
  const now = deps.now || (() => new Date());
  const mailer = deps.mailer || createMailer({ logger });
  const dailyCheck = createDailyCheck({ upstream, repo, mailer, logger, today });

  const app = express();
  app.disable('x-powered-by'); // EN: do not advertise the framework / Franco: mate2olsh en da Express
  app.use(requestIdMiddleware);
  app.use(requestLogger(logger));
  // EN: JSON bodies max 100 KB (multipart uploads are handled by upload.js, limit 5 MB).
  // Franco: JSON 100 KB bel kteer (el uploads multipart fe upload.js, el hadd 5 MB).
  app.use(express.json({ limit: '100kb' }));

  // EN: health check used by Docker, nginx and the team to see the service is alive (no login needed).
  // Franco: check en el service 7ayya; bey-estakhdemo Docker w nginx w e7na (mafeesh login).
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'certificate-compliance' });
  });

  app.use(createCertificatesRouter({ auth, upstream, storage, repo, today }));
  app.use(createManageRouter({ auth, upstream, repo, access, today }));
  app.use(createReviewRouter({ auth, repo, access, storage, today }));
  app.use(createComplianceRouter({ auth, upstream, repo, access, today, now, dailyCheck }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger)); // EN: must be last / Franco: lazem yeb2a akher wa7ed
  return app;
}

module.exports = { createApp };
