// EN: Safe database access for every service. Each service creates its own pg Pool (with its own
//     least-privilege role, e.g. svc_s1) and wraps it here. The helpers ONLY run parameterised SQL:
//     user input travels in `params` ($1, $2...) and is never glued into the SQL text, which stops SQL
//     injection.
// Franco: Database access aman le kol service. Kol service beta3mel pg Pool bta3ha (bel role bta3ha
//     zay svc_s1) w telaffo hena. El helpers beyshaghalo SQL parameterised BAS: el input bta3 el user
//     beyemshi fe `params` ($1, $2...) w 3omro ma byetlezeq fel SQL text, w da beyemna3 SQL injection.
//
// Usage in a service / el estekhdam:
//   const { Pool } = require('pg');
//   const db = createDb({ pool: new Pool(poolConfigFromEnv()) });
//   const rows = await db.query('SELECT * FROM trainings WHERE category = $1', [category]);
'use strict';

class UnsafeQueryError extends Error {}

// EN: Guard rails, checked before every query:
//     1. the SQL must be a plain string and params an array;
//     2. NO quote characters in the SQL text: every value, even a constant like 'Pending', must be a
//        parameter, so nobody can build SQL by string concatenation "by accident";
//     3. only one statement (no ";" in the middle, which blocks stacked queries);
//     4. the highest $n must equal params.length (no missing or extra parameters).
// Franco: Qawa3ed aman, bet-et-check abl kol query:
//     1. el SQL string w el params array;
//     2. MAFEESH quotes fel SQL text: kol value, 7atta constant zay 'Pending', lazem parameter, 3ashan
//        ma7addesh yebny SQL b lazq el strings "bel ghalat";
//     3. statement wa7ed bas (mafeesh ";" fel nos), w da beyemna3 el stacked queries;
//     4. akbar $n lazem yesawy params.length (mafeesh parameter na2es aw zayed).
function assertSafeQuery(sql, params) {
  if (typeof sql !== 'string' || sql.trim() === '') throw new UnsafeQueryError('SQL must be a non-empty string');
  if (!Array.isArray(params)) throw new UnsafeQueryError('params must be an array');
  if (/['"`]/.test(sql)) throw new UnsafeQueryError('Quotes are not allowed in SQL text; pass values as $n parameters');
  if (/;\s*\S/.test(sql)) throw new UnsafeQueryError('Only one SQL statement per query');
  const used = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  const highest = used.length ? Math.max(...used) : 0;
  if (highest !== params.length) {
    throw new UnsafeQueryError(`SQL uses $1..$${highest} but ${params.length} parameter(s) were given`);
  }
}

// EN: read the pool settings from the environment. The password comes from the environment (filled from
//     Secrets Manager or the local, git-ignored .env), never from the code.
// Franco: ye2ra settings el pool men el environment. El password men el environment (men Secrets
//     Manager aw el .env el local), 3omro ma yeb2a fel code.
function poolConfigFromEnv(env = process.env) {
  const missing = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`db: missing environment variables ${missing.join(', ')}`);
  return {
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 5432),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    max: Number(env.DB_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 3_000,
    // EN: stop runaway queries after 5 seconds.
    // Franco: wa22ef ay query ba3d 5 sawany.
    statement_timeout: 5_000,
    // EN: TLS to the database on real AWS (RDS); off for the local container.
    // Franco: TLS lel database 3ala AWS el 7a2i2i (RDS); ma2fool lel container el local.
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  };
}

function createDb({ pool }) {
  if (!pool || typeof pool.query !== 'function') throw new Error('db: a pg Pool is required');

  async function query(sql, params = []) {
    assertSafeQuery(sql, params);
    const result = await pool.query(sql, params);
    return result.rows;
  }

  async function queryOne(sql, params = []) {
    const rows = await query(sql, params);
    return rows[0] || null;
  }

  // EN: run several queries as ONE unit: all succeed or none does (e.g. complete + create the renewal).
  // Franco: yeshaghal kaza query ka wa7da: ya kollohom yenga7o ya wala wa7ed (zay complete + el renewal).
  async function withTransaction(work) {
    const client = await pool.connect();
    const tx = {
      query: async (sql, params = []) => { assertSafeQuery(sql, params); return (await client.query(sql, params)).rows; },
    };
    tx.queryOne = async (sql, params = []) => (await tx.query(sql, params))[0] || null;
    try {
      await client.query('BEGIN');
      const result = await work(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  return { query, queryOne, withTransaction, close: () => pool.end() };
}

// EN: Postgres error codes the services turn into HTTP answers (see errors.js fromDbError).
// Franco: akwad errors Postgres elly el services bet7awwelha le HTTP (shoof errors.js fromDbError).
const PG = { UNIQUE_VIOLATION: '23505', FOREIGN_KEY_VIOLATION: '23503', CHECK_VIOLATION: '23514', INVALID_TEXT: '22P02' };

module.exports = { createDb, assertSafeQuery, poolConfigFromEnv, UnsafeQueryError, PG };
