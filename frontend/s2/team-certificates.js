// EN: "Team certificates" page logic (managers). Calls Service 2: GET /api/certificates?teamId=&reviewStatus=,
//     GET .../{id}/download, PATCH .../{id}/verify; and Service 1: GET /api/teams, /api/teams/{id}/employees,
//     /api/employees/me. The server decides who may do what; this page only hides buttons that cannot work.
// Franco: Logic page "Team certificates" (lel managers). Bey-kallem Service 2 w Service 1. El server howa elly
//     beyqarrar meen yeqdar ye3mel eh; el page bte5abbi el zorar elly mesh hatshtaghal bas.
'use strict';
(function () {
  const { api, ui, s2 } = window.ETT;
  const { el } = ui;
  if (!ui.startPage(['Manager'])) return;

  const teamSelect = document.getElementById('team');
  const statusSelect = document.getElementById('status');
  let employeeNames = new Map();
  let myId = null;

  // EN: send the decision. "reject" asks for a reason first (1-500 characters); the server checks it again.
  // Franco: nebaa3at el qarar. "reject" bey-es2al 3an el sabab el awel (1-500 7arf); el server bey-check tany.
  async function decide(certificate, decision, button) {
    let reason = null;
    if (decision === 'reject') {
      reason = window.prompt('Why are you rejecting this certificate?');
      if (reason === null) return; // EN: cancelled / Franco: et-alghet
      const problem = s2.rejectProblem(reason);
      if (problem) { ui.showError(problem); return; }
    }
    await ui.busy(button, async () => {
      await api.patch(`/api/certificates/${encodeURIComponent(certificate.id)}/verify`, { decision, reason });
      ui.showInfo(decision === 'verify' ? 'Certificate verified.' : 'Certificate rejected.');
      await loadCertificates();
    });
  }

  const COLUMNS = [
    ['Employee', (c) => employeeNames.get(c.employeeId) || '-'],
    ['Certificate', (c) => c.title],
    ['Issuer', (c) => c.issuer],
    ['Expires on', (c) => c.expiryDate],
    ['Validity', (c) => s2.pill(c.validity)],
    ['Review', (c) => el('span', {}, s2.pill(c.reviewStatus), c.rejectReason ? ` ${c.rejectReason}` : '')],
    ['', (c) => el('span', { class: 'row' },
      el('button', { type: 'button', class: 'secondary', onclick: (e) => ui.busy(e.currentTarget, () => s2.download(c.id)) }, 'Download'),
      // EN: a manager can never decide their OWN certificate (the server answers 403 anyway).
      // Franco: el manager 3omro ma yeqarrar fe certificate bta3o HOWA (el server beyrod 403 bardo).
      c.reviewStatus === 'Pending' && c.employeeId !== myId
        ? [
          el('button', { type: 'button', onclick: (e) => decide(c, 'verify', e.currentTarget) }, 'Verify'),
          el('button', { type: 'button', class: 'danger', onclick: (e) => decide(c, 'reject', e.currentTarget) }, 'Reject'),
        ]
        : null,
      c.reviewStatus === 'Pending' && c.employeeId === myId ? 'Your own certificate' : null)],
  ];

  async function loadCertificates() {
    if (!teamSelect.value) return;
    const teamId = encodeURIComponent(teamSelect.value);
    const status = statusSelect.value ? `&reviewStatus=${encodeURIComponent(statusSelect.value)}` : '';
    const [employees, rows] = await Promise.all([
      api.get(`/api/teams/${teamId}/employees`),
      api.get(`/api/certificates?teamId=${teamId}${status}`),
    ]);
    employeeNames = new Map(employees.map((e) => [e.id, e.name]));
    document.getElementById('certificates').replaceChildren(s2.table(COLUMNS, rows, 'No certificates for this filter.'));
  }

  teamSelect.addEventListener('change', () => ui.busy(null, loadCertificates));
  statusSelect.addEventListener('change', () => ui.busy(null, loadCertificates));

  ui.busy(null, async () => {
    myId = (await api.get('/api/employees/me')).id;
    const teams = await s2.loadTeams(teamSelect);
    if (!teams.length) { ui.showInfo('You do not manage a team yet.'); return; }
    await loadCertificates();
  });
}());
