// EN: "My certificates" page logic. Calls Service 2 (POST /api/certificates, GET /api/certificates/me,
//     GET .../{id}/download, DELETE .../{id}) and Service 1 (GET /api/trainings, for the training list).
//     Who "me" is comes from the token on the server, never from this page: the form has no employee field.
// Franco: Logic page "My certificates". Bey-kallem Service 2 (upload, list, download, delete) w Service 1
//     (list el trainings). "me" meen beyet7added men el token fel server, mesh men el page: el form mafeehash khanet mowazzaf.
'use strict';
(function () {
  const { api, ui, s2 } = window.ETT;
  const { el } = ui;
  if (!ui.startPage(['Employee', 'Manager'])) return;

  const form = document.getElementById('upload-form');
  const uploadButton = document.getElementById('upload');
  let trainingNames = new Map();

  // EN: the training list for the <select> (S1). Names are also used in the table below.
  // Franco: list el trainings lel <select> (men S1). El asamy bet-estakhdem fel gadwal ta7t kaman.
  async function loadTrainings() {
    const trainings = await api.get('/api/trainings');
    trainingNames = new Map(trainings.map((t) => [t.id, t.name]));
    document.getElementById('training').replaceChildren(
      ...trainings.map((t) => el('option', { value: t.id }, `${t.name} (${t.category})`)),
    );
  }

  // EN: delete = soft delete, allowed only while Pending (the server checks it). Ask first.
  // Franco: delete = soft delete, masmoo7 lama el certificate lessa Pending bas (el server bey-check). Bn-es2al el awel.
  function remove(certificate, button) {
    if (!window.confirm(`Delete "${certificate.title}"?`)) return;
    ui.busy(button, async () => {
      await api.del(`/api/certificates/${encodeURIComponent(certificate.id)}`);
      ui.showInfo('Certificate deleted.');
      await loadCertificates();
    });
  }

  const COLUMNS = [
    ['Certificate', (c) => c.title],
    ['Training', (c) => trainingNames.get(c.trainingId) || '-'],
    ['Issuer', (c) => c.issuer],
    ['Expires on', (c) => c.expiryDate],
    ['Validity', (c) => s2.pill(c.validity)],
    ['Review', (c) => el('span', {}, s2.pill(c.reviewStatus), c.rejectReason ? ` ${c.rejectReason}` : '')],
    ['', (c) => el('span', { class: 'row' },
      el('button', { type: 'button', class: 'secondary', onclick: (e) => ui.busy(e.currentTarget, () => s2.download(c.id)) }, 'Download'),
      c.reviewStatus === 'Pending'
        ? el('button', { type: 'button', class: 'danger', onclick: (e) => remove(c, e.currentTarget) }, 'Delete')
        : null)],
  ];

  async function loadCertificates() {
    const rows = await api.get('/api/certificates/me');
    document.getElementById('certificates').replaceChildren(s2.table(COLUMNS, rows, 'You have not uploaded any certificate yet.'));
  }

  // EN: upload: friendly checks first, then POST the form. The server checks everything again and answers
  //     413 (too big) or 415 (wrong type), which api.js turns into a readable message.
  // Franco: upload: el checks el lateefa el awel, ba3dein POST lel form. El server bey-check kol 7aga tany w
  //     beyrod 413 (kebeer) aw 415 (noo3 ghalat), w api.js bey7awwelhom le resala mafhooma.
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const values = {
      trainingId: document.getElementById('training').value,
      title: document.getElementById('title').value,
      issuer: document.getElementById('issuer').value,
      certificateNumber: document.getElementById('number').value,
      issueDate: document.getElementById('issue-date').value,
      expiryDate: document.getElementById('expiry-date').value,
    };
    const file = document.getElementById('file').files[0];
    const problems = s2.uploadProblems({ ...values, file });
    if (problems.length) {
      ui.showError(problems.join(' '));
      return;
    }
    ui.busy(uploadButton, async () => {
      await api.post('/api/certificates', s2.buildUploadForm(values, file));
      ui.showInfo('Certificate uploaded. It stays Pending until your manager verifies it.');
      form.reset();
      await loadCertificates();
    });
  });

  ui.busy(null, async () => {
    await loadTrainings();
    await loadCertificates();
  });
}());
