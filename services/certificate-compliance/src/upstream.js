// EN: Small client for the calls S2 makes to S1 (docs/API_CONTRACT.md section 7).
//     - forwards the CALLER's own token, so S1 applies its own ownership rules;
//     - forwards X-Request-Id, so one user action can be followed across the services;
//     - 3-second timeout; if S1 is down we answer 503 and never guess.
// Franco: Client so8ayyar lel calls elly S2 bey3melha le S1.
//     - bey-forward token el caller nafsoh, f S1 bey-apply rules el ownership bta3to;
//     - bey-forward X-Request-Id 3ashan netaba3 el action 3abr el services;
//     - timeout 3 sawani; law S1 wa2e3 benrod 503 w mabnekhammenesh.
'use strict';
const {
  badRequest, unauthorized, forbidden, notFound, upstreamError, upstreamUnavailable,
} = require('../../common/errors');

function createUpstream({
  s1Url = process.env.S1_URL || 'http://s1:5001',
  fetchImpl = globalThis.fetch,
  timeoutMs = 3000,
} = {}) {
  // EN: one GET to S1. notFoundMessage says WHAT was not found, so the 404 is clear.
  // Franco: GET wa7ed le S1. notFoundMessage beyqool eh elly mesh mawgood 3ashan el 404 yeb2a wade7.
  async function get(path, { token, requestId }, notFoundMessage) {
    let res;
    try {
      res = await fetchImpl(`${s1Url}${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'X-Request-Id': requestId || '', Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // EN: network error or timeout -> 503. Franco: moshkelet network aw timeout -> 503.
      throw upstreamUnavailable('S1 is unavailable');
    }
    if (res.status === 400) throw badRequest('S1 rejected the request');
    if (res.status === 401) throw unauthorized('Token was rejected');
    if (res.status === 403) throw forbidden();
    if (res.status === 404) throw notFound(notFoundMessage);
    if (!res.ok) throw upstreamError('S1 failed');
    try {
      return await res.json();
    } catch {
      throw upstreamError('S1 sent an invalid answer');
    }
  }

  const enc = encodeURIComponent;
  return {
    // EN: the caller's own profile: gives us the employeeId that owns the certificate.
    // Franco: profile el caller nafsoh: beydeena el employeeId elly beyemlek el certificate.
    getMe: (ctx) => get('/api/employees/me', ctx, 'No employee profile exists for this user'),
    getTraining: (trainingId, ctx) => get(`/api/trainings/${enc(trainingId)}`, ctx, 'Training not found'),
    // EN: an employee (S1 answers only for the employee themself or their team's manager): gives the owner's managerId.
    // Franco: mowazzaf (S1 beyrod bas lel mowazzaf nafso aw manager el team): beydeena managerId bta3 sa7eb el certificate.
    getEmployee: (id, ctx) => get(`/api/employees/${enc(id)}`, ctx, 'Employee not found'),
    // EN: the teams this caller manages, and the employees of one team (403/404 come from S1).
    // Franco: el teams elly el caller modeerha, w mowazzafeen team wa7da (403/404 gayeen men S1).
    // EN: the team's COMPLETED assignments (each one says if its training requires a certificate).
    // Franco: el assignments el COMPLETED bta3et el team (kol wa7da beteqool el training me7taga certificate wala la2).
    getTeamCompletedAssignments: (teamId, ctx) => get(`/api/teams/${enc(teamId)}/assignments?status=completed`, ctx, 'Team not found'),
    getTeams: (ctx) => get('/api/teams', ctx, 'Team not found'),
    getTeamEmployees: (teamId, ctx) => get(`/api/teams/${enc(teamId)}/employees`, ctx, 'Team not found'),
  };
}

module.exports = { createUpstream };
