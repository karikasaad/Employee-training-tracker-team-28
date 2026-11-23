// EN: Small helpers shared by the two Service 2 pages (my-certificates.html and team-certificates.html). The pure
//     ones (form checks, the upload form, colours) are also exported for Node, so they are unit-tested. Every value
//     from the API is shown with textContent through ETT.ui.el(), never raw HTML (no XSS). The browser checks
//     only help the user: the API repeats ALL of them (the browser is never trusted).
// Franco: Helpers so8ayyara moshtaraka bein page-ein Service 2. El pure menhom (checks el form, el upload form,
//     el alwan) bardo exported le Node 3ashan yet-test. Kol value men el API betezhar b textContent 3an taree2
//     ETT.ui.el(), 3omrena ma bnektob HTML kham (mafeesh XSS). Checks el browser betsa3ed el user bas:
//     el API bey3eed KOL check (el browser 3omro ma beyetsada2).
'use strict';
(function (root) {
  const MAX_FILE_BYTES = 5 * 1024 * 1024; // EN: 5 MB, same as the API / Franco: 5 MB zay el API
  const ALLOWED_NAME = /\.(pdf|jpe?g|png)$/i;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  // EN: status / validity -> colour of the badge.
  // Franco: el status / validity -> loon el badge.
  const KINDS = { Verified: 'ok', Valid: 'ok', Pending: 'warn', 'Expiring soon': 'warn', Rejected: 'bad', Expired: 'bad' };
  const kindOf = (text) => KINDS[text] || '';

  // EN: the friendly checks before sending the upload. Returns a list of problems (empty = fine to send).
  //     The file TYPE is checked by the server from the file's first bytes; the name check here is only a hint.
  // Franco: el checks el lateefa abl ma nebaa3at el upload. Beyrga3 list moshkelat (fadya = tamam nebaa3at).
  //     NOO3 el file el server bey-check-o men awel bytes; check el esm hena ta3leema bas.
  function uploadProblems({ file, trainingId, title, issuer, issueDate, expiryDate }) {
    const problems = [];
    if (!file) problems.push('Choose a file (PDF, JPG or PNG).');
    else if (file.size > MAX_FILE_BYTES) problems.push('The file is larger than 5 MB.');
    else if (file.size === 0) problems.push('The file is empty.');
    else if (!ALLOWED_NAME.test(file.name || '')) problems.push('The file must be a PDF, JPG or PNG.');
    if (!trainingId) problems.push('Choose the training.');
    if (!String(title || '').trim()) problems.push('Enter a title.');
    if (!String(issuer || '').trim()) problems.push('Enter the issuer.');
    if (!DATE.test(issueDate || '')) problems.push('Enter the issue date.');
    if (!DATE.test(expiryDate || '')) problems.push('Enter the expiry date.');
    if (DATE.test(issueDate || '') && DATE.test(expiryDate || '') && issueDate > expiryDate) {
      problems.push('The issue date must not be after the expiry date.');
    }
    return problems;
  }

  // EN: the multipart form for POST /api/certificates. There is NO employeeId: the server takes the owner from the token.
  // Franco: el form multipart le POST /api/certificates. Mafeesh employeeId: el server beyakhod el sa7eb men el token.
  function buildUploadForm({ trainingId, title, issuer, certificateNumber, issueDate, expiryDate }, file) {
    const form = new root.FormData();
    form.append('trainingId', trainingId);
    form.append('title', title.trim());
    form.append('issuer', issuer.trim());
    if (certificateNumber && certificateNumber.trim()) form.append('certificateNumber', certificateNumber.trim());
    form.append('issueDate', issueDate);
    form.append('expiryDate', expiryDate);
    form.append('file', file);
    return form;
  }

  // EN: a rejection needs a reason of 1-500 characters (the API checks it again).
  // Franco: el reject lazem leh sabab men 1 le 500 7arf (el API bey-check tany).
  function rejectProblem(reason) {
    const text = String(reason || '').trim();
    if (!text) return 'Write a reason for the rejection.';
    if (text.length > 500) return 'The reason must be 500 characters or fewer.';
    return null;
  }

  const pure = { MAX_FILE_BYTES, kindOf, uploadProblems, buildUploadForm, rejectProblem };

  // ---------------------------------------------------------------- the parts that need the page
  function pill(text) {
    return root.ETT.ui.el('span', { class: `pill ${kindOf(text)}` }, String(text || ''));
  }

  // EN: a table from rows: columns = [[header, (row) => cell content, 'num'?], ...]
  // Franco: gadwal men rows: columns = [[header, (row) => el mo7tawa, 'num'?], ...]
  function table(columns, rows, emptyText) {
    const { el } = root.ETT.ui;
    if (!rows.length) return el('p', { class: 'empty' }, emptyText);
    return el('table', {},
      el('thead', {}, el('tr', {}, columns.map(([h, , cls]) => el('th', { class: cls }, h)))),
      el('tbody', {}, rows.map((row) => el('tr', {}, columns.map(([, cell, cls]) => el('td', { class: cls }, cell(row)))))));
  }

  // EN: Download: ask the API for a 5-minute link, then let the browser open it. The link forces a DOWNLOAD
  //     (Content-Disposition: attachment), so the file is never opened or run inside our page.
  // Franco: Download: nesaal el API 3an link 5 da2ay2, ba3dein el browser yeftah-o. El link beygbor el DOWNLOAD
  //     (Content-Disposition: attachment), f el file 3omro ma beyetfata7 aw beyeshtaghal gowwa el page bta3na.
  async function download(certificateId) {
    const { el } = root.ETT.ui;
    const { url } = await root.ETT.api.get(`/api/certificates/${encodeURIComponent(certificateId)}/download`);
    const link = el('a', { href: url, rel: 'noopener noreferrer' });
    root.document.body.append(link);
    link.click();
    link.remove();
  }

  // EN: fill the team <select> from S1 GET /api/teams (only the manager's own teams come back).
  // Franco: nemla el <select> bta3 el team men S1 GET /api/teams (el teams bta3et el manager bas bterga3).
  async function loadTeams(select) {
    const teams = await root.ETT.api.get('/api/teams');
    select.replaceChildren(...teams.map((t) => root.ETT.ui.el('option', { value: t.id }, t.name)));
    const saved = root.sessionStorage.getItem('ett.s2.team');
    if (saved && teams.some((t) => t.id === saved)) select.value = saved;
    select.addEventListener('change', () => root.sessionStorage.setItem('ett.s2.team', select.value));
    return teams;
  }

  if (root.document) root.ETT = Object.assign(root.ETT || {}, { s2: { ...pure, pill, table, download, loadTeams } });
  if (typeof module !== 'undefined') module.exports = pure;
}(typeof window !== 'undefined' ? window : globalThis));
