// EN: All SQL of Service 1 in one place. S1 logs in as its own role svc_s1, which may only touch
//     teams, employees, trainings and assignments (infra/db/schema.sql). Every query goes through
//     services/common/db.js, so values always travel as $1, $2... parameters (no SQL injection).
// Franco: Kol el SQL bta3 Service 1 fe makan wa7ed. S1 betdkhol bel role bta3ha svc_s1 elly mesmoo7laha
//     telmes teams w employees w trainings w assignments bas. Kol query bet-3ady 3ala services/common/db.js,
//     f el values dayman betemshi ka parameters $1, $2... (mafeesh SQL injection).
'use strict';
const { calculateStatus, daysOverdue } = require('./rules');

// ---------------------------------------------------------------- employees + teams
// EN: one employee with the team name and the team's manager (needed for the Employee JSON shape).
// Franco: mowazzaf wa7ed ma3 esm el team w manager el team (me7tageenhom fe shakl Employee JSON).
const EMPLOYEE_COLUMNS = `
  SELECT e.id, e.name, e.email, e.team_id, t.name AS team_name, t.manager_id
    FROM employees e
    JOIN teams t ON t.id = e.team_id`;

const TEAM_COLUMNS = `
  SELECT t.id, t.name, t.manager_id, m.name AS manager_name,
         (SELECT count(*)::int FROM employees x WHERE x.team_id = t.id) AS employee_count
    FROM teams t
    LEFT JOIN employees m ON m.id = t.manager_id`;

// EN: database row -> Employee JSON (docs/API_CONTRACT.md section 3). role is calculated, not stored:
//     an employee is a "Manager" when they are the manager of their own team.
// Franco: row el database -> Employee JSON. El role mesh mat-khazzan: el mowazzaf "Manager" law howa
//     manager el team bta3o.
function toEmployee(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    teamId: r.team_id,
    teamName: r.team_name,
    managerId: r.manager_id,
    role: r.manager_id === r.id ? 'Manager' : 'Employee',
  };
}

function toTeam(r) {
  return { id: r.id, name: r.name, managerId: r.manager_id, managerName: r.manager_name, employeeCount: r.employee_count };
}

// ---------------------------------------------------------------- trainings
const TRAINING_COLUMNS = `
  SELECT id, name, category, requires_certificate, validity_months, created_by, created_at
    FROM trainings`;

// EN: database row -> Training JSON (contract section 3). validityMonths null = never expires.
// Franco: row el database -> Training JSON. validityMonths null = malhash sala7eya.
function toTraining(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    requiresCertificate: r.requires_certificate,
    validityMonths: r.validity_months,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

// ---------------------------------------------------------------- assignments
// EN: due_date is read as text ("YYYY-MM-DD") so no time zone can shift the day.
// Franco: due_date bet-et2ery ka text ("YYYY-MM-DD") 3ashan mafeesh time zone ye7arrak el yom.
const ASSIGNMENT_COLUMNS = `
  SELECT a.id, a.employee_id, e.name AS employee_name, a.training_id, t.name AS training_name,
         t.category, t.requires_certificate, a.assigned_by, a.assigned_at,
         a.due_date::text AS due_date, a.completed_at, a.renewal_of_id
    FROM assignments a
    JOIN employees e ON e.id = a.employee_id
    JOIN trainings t ON t.id = a.training_id`;

// EN: open ones first (by due date), then completed ones (newest first).
// Franco: el maftoo7a el awel (bel due date), ba3den elly khelset (el a7das el awel).
const ASSIGNMENT_ORDER = `
  ORDER BY (a.completed_at IS NOT NULL), a.due_date, a.completed_at DESC, t.name`;

// EN: database row -> Assignment JSON (contract section 3). status and daysOverdue are CALCULATED here
//     from today's UTC date with the rules in rules.js; they are never stored.
// Franco: row el database -> Assignment JSON. status w daysOverdue BET-ET7SEB hena men tareekh el
//     naharda bel UTC b rules.js; 3omrhom ma byetkhazzano.
function toAssignment(r, today) {
  const completedAt = r.completed_at ? new Date(r.completed_at).toISOString() : null;
  return {
    id: r.id,
    employeeId: r.employee_id,
    employeeName: r.employee_name,
    trainingId: r.training_id,
    trainingName: r.training_name,
    category: r.category,
    requiresCertificate: r.requires_certificate,
    assignedBy: r.assigned_by,
    assignedAt: new Date(r.assigned_at).toISOString(),
    dueDate: r.due_date,
    completedAt,
    status: calculateStatus(r.due_date, completedAt, today),
    daysOverdue: daysOverdue(r.due_date, completedAt, today),
    renewalOfId: r.renewal_of_id,
  };
}

function createRepo(db) {
  return {
    // ------------------------------------------------------------ assignments
    // EN: insert one assignment. If the employee already has an OPEN one of this training, the partial
    //     unique index refuses it: ON CONFLICT DO NOTHING returns no row and we return null (-> 409 / skipped).
    // Franco: ndakhal assignment wa7ed. Law el mowazzaf 3ando wa7ed MAFTOO7 le nafs el training, el index
    //     beyrfod: ON CONFLICT DO NOTHING mabyrga3sh row w benrga3 null (-> 409 aw skipped).
    async insertAssignment({ employeeId, trainingId, assignedBy, dueDate, renewalOfId = null }, dbOrTx = db) {
      const row = await dbOrTx.queryOne(`
        INSERT INTO assignments (employee_id, training_id, assigned_by, due_date, renewal_of_id)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (employee_id, training_id) WHERE completed_at IS NULL DO NOTHING
        RETURNING id`, [employeeId, trainingId, assignedBy, dueDate, renewalOfId]);
      return row ? row.id : null;
    },

    async getAssignment(id, today, dbOrTx = db) {
      const row = await dbOrTx.queryOne(`${ASSIGNMENT_COLUMNS} WHERE a.id = $1`, [id]);
      return row ? toAssignment(row, today) : null;
    },

    async getAssignmentsByIds(ids, today, dbOrTx = db) {
      if (ids.length === 0) return [];
      const rows = await dbOrTx.query(`${ASSIGNMENT_COLUMNS} WHERE a.id = ANY($1::uuid[]) ${ASSIGNMENT_ORDER}`, [ids]);
      return rows.map((r) => toAssignment(r, today));
    },

    async listAssignmentsOfEmployee(employeeId, today) {
      const rows = await db.query(`${ASSIGNMENT_COLUMNS} WHERE a.employee_id = $1 ${ASSIGNMENT_ORDER}`, [employeeId]);
      return rows.map((r) => toAssignment(r, today));
    },

    async listAssignmentsOfTeam(teamId, today) {
      const rows = await db.query(`${ASSIGNMENT_COLUMNS} WHERE e.team_id = $1 ${ASSIGNMENT_ORDER}`, [teamId]);
      return rows.map((r) => toAssignment(r, today));
    },

    // EN: close an assignment. The WHERE makes it safe even if two requests arrive at the same moment:
    //     only an assignment that belongs to THIS employee and is still OPEN is updated. No row back = nothing
    //     changed. It also returns the training's validity_months for the renewal rule.
    // Franco: ye2fel assignment. El WHERE bey-khalleeh aman 7atta law etnein requests gom fe nafs el lahza:
    //     bas el assignment bta3 el mowazzaf DA w lessa MAFTOO7 beyet3addel. Law mafeesh row = mafeesh
    //     7aga etghayyaret. Bey-rga3 kaman validity_months bta3 el training 3ashan rule el renewal.
    async completeAssignment(id, employeeId, tx) {
      return tx.queryOne(`
        UPDATE assignments a
           SET completed_at = now()
          FROM trainings t
         WHERE a.id = $1 AND a.employee_id = $2 AND a.completed_at IS NULL AND t.id = a.training_id
        RETURNING a.completed_at, a.training_id, a.assigned_by, t.validity_months`, [id, employeeId]);
    },

    withTransaction: (work) => db.withTransaction(work),

    // ------------------------------------------------------------ trainings
    async createTraining({ name, category, requiresCertificate, validityMonths, createdBy }) {
      const row = await db.queryOne(`
        INSERT INTO trainings (name, category, requires_certificate, validity_months, created_by)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, name, category, requires_certificate, validity_months, created_by, created_at`,
      [name, category, requiresCertificate, validityMonths, createdBy]);
      return toTraining(row);
    },

    // EN: the category filter is a $1 parameter, so an injection string just matches nothing.
    // Franco: el filter bta3 el category parameter $1, f ay injection string mabey-match-sh 7aga.
    async listTrainings(category) {
      const rows = category === null
        ? await db.query(`${TRAINING_COLUMNS} ORDER BY name`, [])
        : await db.query(`${TRAINING_COLUMNS} WHERE category = $1 ORDER BY name`, [category]);
      return rows.map(toTraining);
    },

    async getTraining(id) {
      const row = await db.queryOne(`${TRAINING_COLUMNS} WHERE id = $1`, [id]);
      return row ? toTraining(row) : null;
    },

    async updateTraining(id, { name, category, requiresCertificate, validityMonths }) {
      const row = await db.queryOne(`
        UPDATE trainings
           SET name = $2, category = $3, requires_certificate = $4, validity_months = $5
         WHERE id = $1
        RETURNING id, name, category, requires_certificate, validity_months, created_by, created_at`,
      [id, name, category, requiresCertificate, validityMonths]);
      return row ? toTraining(row) : null;
    },

    // ------------------------------------------------------------ employees + teams
    // EN: Cognito "sub" -> our employees.id (used by the auth hook for every request).
    // Franco: el "sub" bta3 Cognito -> employees.id bta3na (el auth hook beyesta3melha fe kol request).
    async employeeIdBySub(sub) {
      const row = await db.queryOne('SELECT id FROM employees WHERE cognito_sub = $1', [sub]);
      return row ? row.id : null;
    },

    async getEmployee(id) {
      const row = await db.queryOne(`${EMPLOYEE_COLUMNS} WHERE e.id = $1`, [id]);
      return row ? toEmployee(row) : null;
    },

    async listTeamEmployees(teamId) {
      const rows = await db.query(`${EMPLOYEE_COLUMNS} WHERE e.team_id = $1 ORDER BY e.name`, [teamId]);
      return rows.map(toEmployee);
    },

    async getTeam(teamId) {
      const row = await db.queryOne(`${TEAM_COLUMNS} WHERE t.id = $1`, [teamId]);
      return row ? toTeam(row) : null;
    },

    // EN: a Manager sees ONLY the teams they manage; the Service token (daily jobs) sees all teams.
    // Franco: el Manager yeshoof el teams elly howa modeerha BAS; el Service token (el jobs) yeshoof kollo.
    async listTeamsManagedBy(employeeId) {
      const rows = await db.query(`${TEAM_COLUMNS} WHERE t.manager_id = $1 ORDER BY t.name`, [employeeId]);
      return rows.map(toTeam);
    },

    async listAllTeams() {
      const rows = await db.query(`${TEAM_COLUMNS} ORDER BY t.name`, []);
      return rows.map(toTeam);
    },
  };
}

module.exports = { createRepo, toEmployee, toTeam, toTraining, toAssignment };
