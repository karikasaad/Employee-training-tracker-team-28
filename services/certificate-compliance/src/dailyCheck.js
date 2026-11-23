// EN: The DAILY CHECK (POST /api/compliance/run-check). For every team: work out which flags should be open,
//     raise the new ones, resolve the old ones, and e-mail the team's manager about what needs attention.
//     It is safe to run twice: flags are identified by employee + training + type, and a reminder is
//     remembered in notified_at. It talks to S1 with the Service token it was called with.
// Franco: El DAILY CHECK (POST /api/compliance/run-check). Le kol team: ne7seb el flags elly lazem tkoon maftoo7a,
//     nerfa3 el gedeeda, n-resolve el adeema, w nebaa3at e-mail le manager el team 3an elly me7taga entebah.
//     Momken yeshtaghal marteen be-aman: el flag bey-et3araf b mowazzaf + training + noo3, w el tazkeer
//     bey-et3amal lo noota fe notified_at. Beykellem S1 b Service token elly et-nada beeh.
'use strict';
const { desiredFlags, planFlagChanges, remindersDue } = require('./compliance');

const LABELS = { Missing: 'certificate missing', Expired: 'certificate expired', ExpiringSoon: 'certificate expiring soon' };

function createDailyCheck({ upstream, repo, mailer, logger, today }) {
  // EN: one e-mail per manager per run, listing everything that needs attention in that team.
  // Franco: e-mail wa7ed le kol manager fe kol run, feeh kol elly me7taga entebah fe el team beta3o.
  async function emailManager(team, due, employees, assignments, certRows, ctx) {
    const manager = await upstream.getEmployee(team.managerId, ctx);
    if (!manager || !manager.email) {
      logger.warn('email_skipped', { message: 'email skipped: the manager has no e-mail address', teamId: team.id });
      return 'skipped';
    }
    const nameOf = new Map(employees.map((e) => [e.id, e.name]));
    const trainingOf = new Map(assignments.map((a) => [a.trainingId, a.trainingName]));
    const expiryOf = new Map(certRows.map((c) => [c.id, c.expiry_date]));
    const lines = due.map((f) => {
      const expiry = expiryOf.get(f.certificate_id);
      return `- ${nameOf.get(f.employee_id) || 'An employee'}: ${LABELS[f.flag_type]} for ${trainingOf.get(f.training_id) || 'a training'}${expiry ? ` (expires ${expiry})` : ''}`;
    });
    return mailer.send({
      to: manager.email,
      subject: `Training certificates need attention: ${team.name || 'your team'}`,
      text: `Hello ${manager.name || ''},\n\nThese certificates need your attention:\n\n${lines.join('\n')}\n\nEmployee Training Tracker`,
    });
  }

  async function run(ctx) {
    const day = today();
    const totals = { flagsRaised: 0, flagsResolved: 0, remindersSent: 0, remindersSkipped: 0 };
    const teams = await upstream.getTeams(ctx); // EN: Service sees ALL teams / Franco: el Service beyshoof kol el teams

    for (const team of teams) {
      const employees = await upstream.getTeamEmployees(team.id, ctx);
      if (employees.length === 0) continue;
      const assignments = await upstream.getTeamCompletedAssignments(team.id, ctx);
      const ids = employees.map((e) => e.id);
      const certRows = await repo.listByEmployees(ids, null);

      const { toRaise, toResolve } = planFlagChanges(
        desiredFlags({ employees, certRows, assignments, today: day }),
        await repo.openFlags(ids),
      );
      const changed = await repo.applyFlagChanges(toRaise, toResolve);
      totals.flagsRaised += changed.raised;
      totals.flagsResolved += changed.resolved;

      const due = remindersDue({ openRows: await repo.openFlags(ids), certRows, today: day });
      if (due.length === 0) continue;
      const outcome = await emailManager(team, due, employees, assignments, certRows, ctx);
      if (outcome === 'sent') {
        totals.remindersSent += 1;
        await repo.markNotified(due.map((f) => f.id)); // EN: only after a real send / Franco: ba3d el send el 7a2i2i bas
      } else {
        totals.remindersSkipped += 1; // EN: not marked, so it is tried again next run / Franco: mesh bet-et3alem, f betet7awel tany
      }
    }
    logger.info('daily_check_done', totals);
    return totals;
  }

  return { run };
}

module.exports = { createDailyCheck };
