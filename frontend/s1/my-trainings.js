// EN: "My trainings" page logic. Calls Service 1 only: GET /api/employees/me, GET /api/assignments/me and
//     PATCH /api/assignments/{id}/complete. The status and "days overdue" come from the backend; the page only
//     shows them. Who "me" is comes from the token on the server, never from this page.
// Franco: Logic page "My trainings". Bey-kallem Service 1 bas. El status w "days overdue" gayeen men el
//     backend; el page bet-warreehom bas. "me" meen beyet7added men el token fel server, mesh men el page.
'use strict';
(function () {
  const { api, ui, s1 } = window.ETT;
  const { el } = ui;
  if (!ui.startPage(['Employee', 'Manager'])) return;

  // EN: the header line: name, team and role. / Franco: satr el header: el esm w el team w el role.
  async function loadProfile() {
    const me = await api.get('/api/employees/me');
    document.getElementById('profile').textContent = `${me.name}, ${me.teamName} team (${me.role})`;
  }

  // EN: "Mark completed": the server checks that this assignment is MINE (403 otherwise) and creates the
  //     renewal for trainings that expire. We show what happened, then reload the list.
  // Franco: "Mark completed": el server bey-check en el assignment da BTA3Y (w law la2 403) w beye3mel el
  //     renewal lel trainings elly leha sala7eya. Benwarry eh elly 7asal w ne-reload el list.
  async function complete(assignment, button) {
    ui.showInfo(null); // EN: clear the last message / Franco: nemsa7 akher resala
    const result = await ui.busy(button, () => api.patch(`/api/assignments/${encodeURIComponent(assignment.id)}/complete`));
    if (!result) return;
    ui.showInfo(result.renewal
      ? `"${assignment.trainingName}" marked completed. The next renewal is due on ${result.renewal.dueDate}.`
      : `"${assignment.trainingName}" marked completed.`);
    await ui.busy(null, loadAssignments);
  }

  const COLUMNS = [
    ['Training', (a) => a.trainingName],
    ['Category', (a) => a.category],
    ['Due date', (a) => a.dueDate],
    ['Status', (a) => s1.pill(a.status)],
    ['Days overdue', (a) => (a.daysOverdue ? String(a.daysOverdue) : '-'), 'num'],
    ['Certificate needed', (a) => (a.requiresCertificate ? 'Yes' : 'No')],
    ['Completed on', (a) => s1.dayOf(a.completedAt)],
    ['', (a) => (a.completedAt ? '' : el('button', {
      type: 'button',
      onclick: (event) => complete(a, event.currentTarget),
    }, 'Mark completed'))],
  ];

  async function loadAssignments() {
    const rows = await api.get('/api/assignments/me');
    const c = s1.countByStatus(rows);
    document.getElementById('counts').replaceChildren(
      s1.card(c.Overdue, 'Overdue', c.Overdue ? 'bad' : ''),
      s1.card(c.Assigned, 'To do (not overdue)'),
      s1.card(c.Completed, 'Completed'),
    );
    document.getElementById('assignments').replaceChildren(s1.table(COLUMNS, rows, 'You have no trainings assigned.'));
  }

  ui.busy(null, async () => {
    await Promise.all([loadProfile(), loadAssignments()]);
  });
}());
