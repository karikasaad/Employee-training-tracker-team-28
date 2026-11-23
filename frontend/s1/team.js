// EN: "Team trainings" page logic (Managers). Calls Service 1 only:
//       GET /api/teams, GET /api/teams/{id}/summary, GET /api/teams/{id}/assignments?status=,
//       GET /api/trainings, POST /api/assignments, POST /api/trainings.
//     Security: the page hides nothing important by itself. If an Employee opens it, we still ask the API,
//     and the server's 403 answer is shown in the banner, so the demo proves the BACKEND blocks it.
// Franco: Logic page "Team trainings" (lel Managers). Bey-kallem Service 1 bas.
//     El amn: el page mesh heya elly bet7mi. Law Employee fata7ha, bardo bnes2al el API, w radd el server
//     403 beyezhar fel banner, f el demo beyethbet en el BACKEND howa elly beyemna3.
'use strict';
(function () {
  const { api, ui, s1 } = window.ETT;
  const { el } = ui;
  const user = ui.startPage(['Employee', 'Manager']);
  if (!user) return;

  const teamSelect = document.getElementById('team');
  const statusSelect = document.getElementById('status');
  const refreshButton = document.getElementById('refresh');
  const teamBase = () => `/api/teams/${encodeURIComponent(teamSelect.value)}`;

  // EN: not a Manager: ask the server anyway and show its 403 (clear message, nothing else is loaded).
  // Franco: mesh Manager: nes2al el server bardo w nwarry el 403 bta3o (resala wad7a, w mafeesh 7aga tanya).
  if (!user.roles.includes('Manager')) {
    document.getElementById('manager-only').hidden = true;
    api.get('/api/teams').catch((err) => {
      ui.showError(`${err.status || ''} ${err.status === 403 ? 'Forbidden: only managers can open Team trainings.' : err.message}`.trim());
    });
    return;
  }

  // ------------------------------------------------------------ summary (contract 4.5b)
  const PEOPLE_COLUMNS = [
    ['Employee', (r) => r.name],
    ['Role', (r) => r.role],
    ['Overdue', (r) => (r.overdue ? el('span', { class: 'pill bad' }, `${r.overdue} overdue`) : '0'), 'num'],
    ['Most days late', (r) => (r.maxDaysOverdue ? String(r.maxDaysOverdue) : '-'), 'num'],
    ['To do', (r) => String(r.assigned), 'num'],
    ['Completed', (r) => String(r.completed), 'num'],
    ['Next due', (r) => r.nextDueDate || '-'],
  ];

  let members = [];
  async function loadSummary() {
    const summary = await api.get(`${teamBase()}/summary`);
    members = summary.employees;
    const t = summary.totals;
    document.getElementById('totals').replaceChildren(
      s1.card(t.employees, 'Team members'),
      s1.card(t.overdue, 'Overdue trainings', t.overdue ? 'bad' : ''),
      s1.card(t.employeesWithOverdue, 'People with something overdue'),
      s1.card(t.assigned, 'To do (not overdue)'),
      s1.card(t.completed, 'Completed'),
    );
    document.getElementById('people').replaceChildren(s1.table(PEOPLE_COLUMNS, members, 'This team has no members.'));
    // EN: the "To" list of the assign form: the whole team, then each member.
    // Franco: list "To" fel form: el team kollo, ba3den kol mowazzaf.
    document.getElementById('assign-target').replaceChildren(
      el('option', { value: 'team' }, 'Whole team'),
      ...members.map((m) => el('option', { value: m.employeeId }, m.name)),
    );
  }

  // ------------------------------------------------------------ assignments (contract 4.5)
  const ASSIGNMENT_COLUMNS = [
    ['Employee', (a) => a.employeeName],
    ['Training', (a) => a.trainingName],
    ['Category', (a) => a.category],
    ['Due date', (a) => a.dueDate],
    ['Status', (a) => s1.pill(a.status)],
    ['Days overdue', (a) => (a.daysOverdue ? String(a.daysOverdue) : '-'), 'num'],
    ['Completed on', (a) => s1.dayOf(a.completedAt)],
  ];

  async function loadAssignments() {
    const query = statusSelect.value ? `?status=${encodeURIComponent(statusSelect.value)}` : '';
    const rows = await api.get(`${teamBase()}/assignments${query}`);
    document.getElementById('assignments').replaceChildren(s1.table(ASSIGNMENT_COLUMNS, rows, 'Nothing to show for this filter.'));
  }

  // ------------------------------------------------------------ trainings dropdown
  async function loadTrainings() {
    const trainings = await api.get('/api/trainings');
    document.getElementById('assign-training').replaceChildren(
      el('option', { value: '' }, 'Choose a training'),
      ...trainings.map((t) => el('option', { value: t.id },
        `${t.name} (${t.category}${t.requiresCertificate ? ', certificate' : ''}${t.validityMonths ? `, every ${t.validityMonths} months` : ''})`)),
    );
  }

  async function loadTeamData() {
    if (!teamSelect.value) return;
    await Promise.all([loadSummary(), loadAssignments()]);
  }

  // ------------------------------------------------------------ assign form (contract 4.9)
  const dueInput = document.getElementById('assign-due');
  dueInput.min = s1.todayUtc();
  document.getElementById('assign-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const built = s1.buildAssignBody({
      target: document.getElementById('assign-target').value,
      teamId: teamSelect.value,
      trainingId: document.getElementById('assign-training').value,
      dueDate: dueInput.value,
    });
    ui.showInfo(null); // EN: clear the last message / Franco: nemsa7 akher resala
    if (built.error) { ui.showError(built.error); return; }
    ui.busy(document.getElementById('assign-button'), async () => {
      const result = await api.post('/api/assignments', built.body);
      ui.showInfo(result.created ? s1.assignResultText(result) : `Assigned "${result.trainingName}" to ${result.employeeName}.`);
      await loadTeamData();
    });
  });

  // ------------------------------------------------------------ create training form (contract 4.6)
  document.getElementById('training-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const built = s1.buildTrainingBody({
      name: document.getElementById('training-name').value,
      category: document.getElementById('training-category').value,
      requiresCertificate: document.getElementById('training-cert').checked,
      validityMonths: document.getElementById('training-validity').value,
    });
    ui.showInfo(null);
    if (built.error) { ui.showError(built.error); return; }
    ui.busy(document.getElementById('training-button'), async () => {
      const created = await api.post('/api/trainings', built.body);
      ui.showInfo(`Training "${created.name}" created. You can assign it now.`);
      event.target.reset();
      await loadTrainings();
    });
  });

  // ------------------------------------------------------------ start
  teamSelect.addEventListener('change', () => {
    sessionStorage.setItem('ett.s1.team', teamSelect.value);
    ui.busy(refreshButton, loadTeamData);
  });
  statusSelect.addEventListener('change', () => ui.busy(null, loadAssignments));
  refreshButton.addEventListener('click', () => ui.busy(refreshButton, loadTeamData));

  ui.busy(refreshButton, async () => {
    // EN: only the teams this manager manages come back from the server (contract 4.3).
    // Franco: el server beyrga3 el teams elly el manager da modeerha bas.
    const teams = await api.get('/api/teams');
    teamSelect.replaceChildren(...teams.map((t) => el('option', { value: t.id }, t.name)));
    if (!teams.length) {
      ui.showInfo('You do not manage a team yet.');
      return;
    }
    const saved = sessionStorage.getItem('ett.s1.team');
    if (saved && teams.some((t) => t.id === saved)) teamSelect.value = saved;
    await Promise.all([loadTeamData(), loadTrainings()]);
  });
}());
