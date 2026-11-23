// EN: The ownership checks of Service 2 in ONE place. A route never trusts an id from the URL: it loads the
//     certificate, finds WHO the caller is (from the token, through S1), and only then decides.
//     Rule: the owner may access it; the manager of the OWNER'S team may access it; nobody else (403).
// Franco: Checks el ownership bta3et Service 2 fe makan wa7ed. El route 3omro ma beyesda2 id gai men el URL:
//     bey-load el certificate, w beylaqi el caller meen (men el token, 3an taree2 S1), w ba3dein yeqarrar.
//     El rule: el sa7eb yeqdar yeft7o; manager team el SA7EB yeqdar yeft7o; ma7adesh tany (403).
'use strict';
const { badRequest, forbidden, notFound } = require('../../common/errors');
const { UUID } = require('./validate');

function createAccess({ upstream, repo }) {
  // EN: the caller's own token and request id, forwarded to S1.
  // Franco: token el caller w el request id, bnwasselhom le S1.
  const ctxOf = (req) => ({ token: (req.headers.authorization || '').slice('Bearer '.length), requestId: req.requestId });

  function requireUuid(value, field) {
    if (typeof value !== 'string' || !UUID.test(value)) {
      throw badRequest(`${field} must be a UUID`, [{ field, issue: 'not a UUID' }]);
    }
    return value.toLowerCase();
  }

  // EN: answer 403. If the action is a change (update/delete), a "denied" row goes to the audit log first.
  // Franco: nrod 403. Law el action taghyeer (update/delete), satr "denied" bey-etkteb fel audit log el awel.
  async function deny(req, me, action, certificateId, message) {
    if (action) await repo.audit(me.id, action, certificateId, req.ip, 'denied').catch(() => {});
    throw forbidden(message);
  }

  // EN: Security check (IDOR): load one certificate and prove the caller may see it.
  //     1) id is a UUID (400); 2) who is the caller (S1, from the token); 3) the certificate exists (404);
  //     4) the caller is the owner, OR a Manager whose id equals the owner's managerId (403 otherwise).
  //     We also require the Manager ROLE in the token, so an employee can never pass as a manager.
  // Franco: Check aman (IDOR): n-load certificate wa7ed w nethbet en el caller yeqdar yeshoofo.
  //     1) el id UUID (400); 2) el caller meen (S1, men el token); 3) el certificate mawgood (404);
  //     4) el caller howa el sa7eb, AW Manager w id-o = managerId bta3 el sa7eb (3'er keda 403).
  //     w kaman bnotlob role Manager fel token, f mowazzaf 3ady 3omro ma yeb2a manager.
  async function loadCertificate(req, rawId, action = null) {
    const id = requireUuid(rawId, 'id');
    const ctx = ctxOf(req);
    const me = await upstream.getMe(ctx);
    const row = await repo.findById(id);
    if (!row) throw notFound('Certificate not found');
    if (row.employee_id === me.id) return { row, me, isOwner: true };

    let owner = null;
    if (req.user.roles.includes('Manager')) {
      try {
        owner = await upstream.getEmployee(row.employee_id, ctx);
      } catch (err) {
        if (err.status !== 403) throw err; // EN: S1 says "not your team" / Franco: S1 bey2ool "mesh team-ak"
      }
    }
    if (!owner || owner.managerId !== me.id) {
      await deny(req, me, action, row.id, 'You are not allowed to access this certificate');
    }
    return { row, me, isOwner: false };
  }

  // EN: Security check (team ownership): S1's GET /api/teams lists ONLY the teams this manager manages.
  //     If the team is not in the list, S1 answers 404 (unknown) or 403 (another manager's team) when asked
  //     for its employees, and we pass that on. Returns the team's employees.
  // Franco: Check aman (team ownership): GET /api/teams men S1 beyrga3 el teams elly el manager modeerha BAS.
  //     Law el team mesh fel list, S1 beyrod 404 (mesh mawgood) aw 403 (team manager tany) lama nes2alo 3an
  //     mowazzafeeno, w bnwasselha. Beyrga3 mowazzafeen el team.
  async function teamEmployeesOfManager(req, rawTeamId) {
    const teamId = requireUuid(rawTeamId, 'teamId');
    const ctx = ctxOf(req);
    const teams = await upstream.getTeams(ctx);
    const mine = Array.isArray(teams) && teams.some((t) => t.id === teamId);
    const employees = await upstream.getTeamEmployees(teamId, ctx);
    if (!mine) throw forbidden('You are not the manager of this team');
    return employees;
  }

  return { ctxOf, requireUuid, deny, loadCertificate, teamEmployeesOfManager };
}

module.exports = { createAccess };
