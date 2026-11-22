// EN: Authentication + authorization for every service. Checks the Cognito access token (JWT) on every
//     request and answers 401 (no / bad token) or 403 (valid token, wrong role).
//     Uses only Node's built-in crypto to verify the RS256 signature, so every line can be read and
//     explained; there is no third-party JWT library.
// Franco: El authentication w el authorization le kol service. Bey-check el Cognito access token (JWT)
//     fe kol request w beyrod 401 (mafeesh token aw token ghalat) aw 403 (token sa7 bas el role ghalat).
//     Beyesta3mel crypto bta3 Node bas 3ashan ye-verify el RS256 signature, f kol satr momken neshra7o.
'use strict';
const crypto = require('node:crypto');

class AuthError extends Error {
  // EN: status 401 = who are you? (token problem). status 403 = I know you, but you may not do this.
  // Franco: 401 = enta meen? (moshkela fel token). 403 = 3arfak, bas mamnoo3 te3mel kda.
  constructor(status, message) {
    super(message);
    this.status = status;
    this.code = status === 401 ? 'UNAUTHENTICATED' : 'FORBIDDEN';
  }
}

function base64UrlToJson(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

// EN: Download the user pool's public keys (JWKS) and keep them in memory for 1 hour. If a token has a key
//     id (kid) we don't know, we refresh at most once a minute (Cognito rotates keys), so a stream of fake
//     kids cannot make us hammer the JWKS endpoint.
// Franco: Benanazzel el public keys bta3et el user pool (JWKS) w nekhalleehom fel memory sa3a. Law el
//     token leh kid mesh 3arfeeno, bne-refresh mara wa7da fel de2ee2a bel kteer, 3ashan tokens mozawwara
//     matkhallenash nedrab el JWKS endpoint.
function createJwksCache({ jwksUrl, fetchImpl = globalThis.fetch, ttlMs = 3600_000, minRefreshMs = 60_000, now = Date.now }) {
  let keys = new Map();
  let fetchedAt = 0;
  async function refresh() {
    const res = await fetchImpl(jwksUrl, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`JWKS fetch failed with HTTP ${res.status}`);
    const body = await res.json();
    keys = new Map((body.keys || []).map((jwk) => [jwk.kid, jwk]));
    fetchedAt = now();
  }
  return async function getKey(kid) {
    if (now() - fetchedAt > ttlMs) await refresh();
    if (!keys.has(kid) && now() - fetchedAt > minRefreshMs) await refresh();
    return keys.get(kid);
  };
}

// EN: Creates the auth helpers for one service. All settings come from the environment (no secrets here:
//     the issuer, client ids and JWKS URL are public values).
// Franco: Bey3mel el auth helpers le service wa7da. Kol el settings men el environment (mafeesh secrets:
//     el issuer w el client ids w el JWKS URL 7agat public).
function createAuth(options = {}) {
  const env = options.env || process.env;
  const issuer = options.issuer || env.COGNITO_ISSUER;
  const webClientIds = options.webClientIds
    || String(env.COGNITO_WEB_CLIENT_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
  const serviceClientId = options.serviceClientId || env.COGNITO_SERVICE_CLIENT_ID || null;
  const clockSkewSec = options.clockSkewSec ?? 5;
  const nowSec = options.nowSec || (() => Math.floor(Date.now() / 1000));
  const getKey = options.getKey || createJwksCache({
    jwksUrl: options.jwksUrl || env.COGNITO_JWKS_URL || `${issuer}/.well-known/jwks.json`,
  });
  if (!issuer || webClientIds.length === 0) {
    throw new Error('auth: COGNITO_ISSUER and COGNITO_WEB_CLIENT_ID must be set');
  }

  // EN: Verify one token. Returns the user, or throws AuthError(401). The order matters: the signature is
  //     checked BEFORE we trust any claim inside the token.
  // Franco: Ye-verify token wa7ed. Beyrga3 el user aw beyrmy AuthError(401). El tarteeb mohem: el
  //     signature bet-et-check ABL ma nese2 ay claim gowwa el token.
  async function verifyToken(token) {
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3) throw new AuthError(401, 'Malformed token');
    let header;
    let payload;
    try {
      header = base64UrlToJson(parts[0]);
      payload = base64UrlToJson(parts[1]);
    } catch {
      throw new AuthError(401, 'Malformed token');
    }

    // EN: Only RS256 is accepted. This blocks "alg: none" and the HS256 trick where an attacker signs with
    //     the PUBLIC key as if it were a shared secret (algorithm confusion).
    // Franco: RS256 bas masmoo7. Da beyemna3 "alg: none" w 7eelet HS256 elly el attacker beyemdy feeha bel
    //     PUBLIC key ka2enno secret (algorithm confusion).
    if (header.alg !== 'RS256') throw new AuthError(401, 'Unsupported token algorithm');
    if (!header.kid) throw new AuthError(401, 'Token has no key id');

    let jwk;
    try {
      jwk = await getKey(header.kid);
    } catch {
      // EN: if we cannot reach the JWKS we fail closed (401), we never "let it through".
      // Franco: law mesh 2aderin newsal lel JWKS bnersef (401), 3omrena ma bnedakhkhal.
      throw new AuthError(401, 'Cannot verify token right now');
    }
    if (!jwk || jwk.kty !== 'RSA') throw new AuthError(401, 'Unknown signing key');

    // EN: The signature covers "header.payload". Any change to the payload (e.g. adding the Manager group)
    //     makes this check fail.
    // Franco: El signature bet-ghatty "header.payload". Ay taghyeer fel payload (zay ezafet group Manager)
    //     beykhalli el check da yefshal.
    const signedPart = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = Buffer.from(parts[2], 'base64url');
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    if (!crypto.verify('RSA-SHA256', signedPart, publicKey, signature)) {
      throw new AuthError(401, 'Invalid token signature');
    }

    // EN: Claims are trusted only now. Issuer = our user pool; token_use = access (an ID token is for the
    //     browser, not for APIs); client_id = one of OUR app clients; exp = not expired.
    // Franco: Dilwa2ty bas nese2 el claims. Issuer = el user pool bta3na; token_use = access (el ID token
    //     lel browser mesh lel API); client_id = app client bta3na; exp = mesh expired.
    if (payload.iss !== issuer) throw new AuthError(401, 'Wrong token issuer');
    if (payload.token_use !== 'access') throw new AuthError(401, 'Not an access token');
    const isService = Boolean(serviceClientId) && payload.client_id === serviceClientId;
    if (!isService && !webClientIds.includes(payload.client_id)) {
      throw new AuthError(401, 'Token was issued to another application');
    }
    const now = nowSec();
    if (typeof payload.exp !== 'number' || payload.exp + clockSkewSec <= now) {
      throw new AuthError(401, 'Token expired');
    }
    if (typeof payload.iat === 'number' && payload.iat - clockSkewSec > now) {
      throw new AuthError(401, 'Token issued in the future');
    }
    if (!payload.sub) throw new AuthError(401, 'Token has no subject');

    const groups = Array.isArray(payload['cognito:groups']) ? payload['cognito:groups'] : [];
    // EN: roles come only from the signed token: Cognito groups for people, "Service" for the job client.
    // Franco: el roles betegi men el token el mamdy bas: groups Cognito lel nas, w "Service" lel job client.
    const roles = isService ? ['Service'] : groups.filter((g) => g === 'Employee' || g === 'Manager');
    return { sub: payload.sub, username: payload.username || null, roles, isService, clientId: payload.client_id };
  }

  // EN: Express middleware: requireAuth(['Manager']) lets only Managers in. requireAuth() = any valid user.
  //     On success req.user = { sub, roles, isService, employeeId? }.
  // Franco: Middleware Express: requireAuth(['Manager']) beydakhkhal el Managers bas. requireAuth() = ay user
  //     sa7. Law tamam req.user = { sub, roles, isService, employeeId? }.
  function requireAuth(allowedRoles = ['Employee', 'Manager']) {
    return async function authMiddleware(req, res, next) {
      try {
        const header = req.headers.authorization || '';
        const match = header.match(/^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/);
        if (!match) throw new AuthError(401, 'Missing or malformed Authorization header');
        const user = await verifyToken(match[1]);
        if (!user.roles.some((r) => allowedRoles.includes(r))) {
          throw new AuthError(403, 'Your role is not allowed to do this');
        }
        // EN: optional hook (S1 only): map the Cognito sub to our employees.id.
        // Franco: hook ekhteyari (S1 bas): ye7awel el Cognito sub le employees.id bta3na.
        if (options.resolveEmployeeId && !user.isService) {
          user.employeeId = await options.resolveEmployeeId(user.sub);
        }
        req.user = user;
        return next();
      } catch (err) {
        return next(err);
      }
    };
  }

  return { verifyToken, requireAuth };
}

// EN: helpers used by the services.
// Franco: helpers el services betesta3melha.
function isServiceToken(req) {
  return Boolean(req.user && req.user.isService);
}

function hasRole(req, role) {
  return Boolean(req.user && req.user.roles.includes(role));
}

// EN: For scheduled jobs: get an access token with the client-credentials flow. The client id and secret
//     are read from Secrets Manager by the caller and passed in; this function never logs them.
// Franco: Lel jobs el mewa3ada: tegib access token b client-credentials flow. El client id w el secret
//     el caller bey2rahom men Secrets Manager w yeba3athom; el function di 3omraha ma tekteb-hom fel log.
async function getServiceToken({ tokenUrl, clientId, clientSecret, scope, fetchImpl = globalThis.fetch }) {
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  if (scope) body.set('scope', scope);
  const res = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body,
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Service token request failed with HTTP ${res.status}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('Service token response has no access_token');
  return json.access_token;
}

module.exports = { createAuth, createJwksCache, AuthError, isServiceToken, hasRole, getServiceToken };
