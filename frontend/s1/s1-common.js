// EN: Small helpers shared by the two Service 1 pages (my-trainings.html and team.html). The pure ones
//     (counts, labels, form checks) are also exported for Node, so they are unit-tested. Every value from
//     the API is shown with textContent through ETT.ui.el(), never innerHTML (no XSS).
// Franco: Helpers so8ayyara moshtaraka bein page-ein Service 1. El pure menhom (el ar2am, el labels,
//     checks el forms) bardo exported le Node 3ashan yet-test. Kol value men el API betezhar b textContent
//     3an taree2 ETT.ui.el(), 3omrena ma bnesta3mel innerHTML (mafeesh XSS).
'use strict';
(function (root) {
  // EN: status -> colour of the badge: Completed green, Assigned orange, Overdue red (to-do 3.1).
  // Franco: el status -> loon el badge: Completed akhdar, Assigned borto2any, Overdue a7mar.
  const STATUS_CLASS = { Completed: 'ok', Assigned: 'warn', Overdue: 'bad' };

  function statusClass(status) {
    return STATUS_CLASS[status] || '';
  }

  // EN: counts for the cards at the top of "My trainings". Uses the status the BACKEND calculated;
  //     the page never decides by itself what is overdue.
  // Franco: el ar2am lel cards fo2 fe "My trainings". Bnesta3mel el status elly el BACKEND 7asabo;
  //     el page 3omraha ma bt2arrar lewa7daha eh el overdue.
  function countByStatus(assignments) {
    const counts = { Assigned: 0, Overdue: 0, Completed: 0 };
    for (const a of assignments) if (counts[a.status] !== undefined) counts[a.status] += 1;
    return counts;
  }

  // EN: "2026-11-23T09:00:00.000Z" -> "2026-11-23"; null -> "-".
  // Franco: tareekh kamel -> el yom bas; null -> "-".
  function dayOf(value) {
    return value ? String(value).slice(0, 10) : '-';
  }

  // EN: today's date in UTC as "YYYY-MM-DD", used as the lowest allowed due date in the form.
  // Franco: tareekh el naharda bel UTC, a2al due date masmoo7 fel form.
  function todayUtc(now = new Date()) {
    return now.toISOString().slice(0, 10);
  }

  // EN: build the POST /api/assignments body from the form. target = "team" or an employee id.
  //     These checks only help the user; the API repeats ALL of them (the browser is not trusted).
  // Franco: nebny body POST /api/assignments men el form. target = "team" aw employee id.
  //     El checks di betsa3ed el user bas; el API bey3eedha KOLLAHA (el browser mesh mawsoo2 feeh).
  function buildAssignBody({ target, teamId, trainingId, dueDate }, today = todayUtc()) {
    if (!trainingId) return { error: 'Choose a training.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate || '')) return { error: 'Choose a due date.' };
    if (dueDate < today) return { error: 'The due date cannot be in the past.' };
    if (!target) return { error: 'Choose who gets the training.' };
    const body = target === 'team' ? { teamId } : { employeeId: target };
    return { body: { ...body, trainingId, dueDate } };
  }

  // EN: build the POST /api/trainings body. An empty "valid for" box means the training never expires.
  // Franco: nebny body POST /api/trainings. Law khanet "valid for" fadya ya3ni el training malhash sala7eya.
  function buildTrainingBody({ name, category, requiresCertificate, validityMonths }) {
    const cleanName = String(name || '').trim();
    const cleanCategory = String(category || '').trim();
    if (!cleanName) return { error: 'Enter a training name.' };
    if (!cleanCategory) return { error: 'Enter a category.' };
    let months = null;
    if (String(validityMonths || '').trim() !== '') {
      months = Number(validityMonths);
      if (!Number.isInteger(months) || months < 1 || months > 120) return { error: 'Valid for must be 1 to 120 months, or empty.' };
    }
    return { body: { name: cleanName, category: cleanCategory, requiresCertificate: Boolean(requiresCertificate), validityMonths: months } };
  }

  // EN: one sentence after "Assign to whole team": how many got it and how many already had it open.
  // Franco: gomla wa7da ba3d "Assign le el team kollo": kam wa7ed khado w kam kan 3ando maftoo7 aslan.
  function assignResultText(result) {
    if (!result || !Array.isArray(result.created)) return 'Training assigned.';
    const skipped = (result.skipped || []).length;
    return `Assigned to ${result.created.length} team member(s).${skipped ? ` ${skipped} already had it open and were skipped.` : ''}`;
  }

  // ------------------------------------------------------------ browser-only helpers
  // EN: a coloured status badge. / Franco: badge molawwan lel status.
  function pill(status) {
    return root.ETT.ui.el('span', { class: `pill ${statusClass(status)}` }, status);
  }

  // EN: a table from rows: columns = [[header, (row) => cell, 'num'?], ...]; empty -> a short message.
  // Franco: gadwal men rows; law fady -> resala so8ayyara.
  function table(columns, rows, emptyText) {
    const { el } = root.ETT.ui;
    if (!rows.length) return el('p', { class: 'empty' }, emptyText);
    return el('table', {},
      el('thead', {}, el('tr', {}, columns.map(([h, , cls]) => el('th', { class: cls }, h)))),
      el('tbody', {}, rows.map((row) => el('tr', {}, columns.map(([, cell, cls]) => el('td', { class: cls }, cell(row)))))));
  }

  function card(value, label, kind) {
    const { el } = root.ETT.ui;
    return el('div', { class: `card ${kind || ''}` }, el('div', { class: 'value' }, String(value)), el('div', { class: 'label' }, label));
  }

  const pure = { statusClass, countByStatus, dayOf, todayUtc, buildAssignBody, buildTrainingBody, assignResultText };
  if (root.document) root.ETT = Object.assign(root.ETT || {}, { s1: { ...pure, pill, table, card } });
  if (typeof module !== 'undefined') module.exports = pure;
}(typeof window !== 'undefined' ? window : globalThis));
