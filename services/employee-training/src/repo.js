// EN: All SQL of Service 1 in one place. S1 logs in as its own role svc_s1, which may only touch
//     teams, employees, trainings and assignments (infra/db/schema.sql). Every query goes through
//     services/common/db.js, so values always travel as $1, $2... parameters (no SQL injection).
// Franco: Kol el SQL bta3 Service 1 fe makan wa7ed. S1 betdkhol bel role bta3ha svc_s1 elly mesmoo7laha
//     telmes teams w employees w trainings w assignments bas. Kol query bet-3ady 3ala services/common/db.js,
//     f el values dayman betemshi ka parameters $1, $2... (mafeesh SQL injection).
'use strict';

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

function createRepo(db) {
  return {
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

module.exports = { createRepo, toEmployee, toTeam, toTraining };
