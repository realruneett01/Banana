/**
 * Banana 2.0 — Persistent User Database
 * Powered by SQLite (better-sqlite3)
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'banana_workspace.db');

export const db = new Database(DB_PATH);

// Enable WAL mode for high performance concurrent reads/writes
db.pragma('journal_mode = WAL');

// Initialize Workspace Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    active_project_id TEXT,
    preferences_json TEXT,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    repo_path TEXT,
    default_branch TEXT,
    files_json TEXT,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS circuits (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    description TEXT,
    domain TEXT,
    components_json TEXT,
    nets_json TEXT,
    specs_json TEXT,
    schematic_kicad TEXT,
    jev_evaluation_json TEXT,
    verified INTEGER DEFAULT 1,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS component_alternatives_cache (
    part_number TEXT PRIMARY KEY,
    manufacturer TEXT,
    description TEXT,
    package TEXT,
    stock INTEGER,
    unit_price REAL,
    datasheet_url TEXT,
    alternatives_json TEXT,
    updated_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS review_pins (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    file_path TEXT,
    commit_sha TEXT,
    layer TEXT,
    x REAL,
    y REAL,
    comment TEXT,
    author TEXT,
    status TEXT DEFAULT 'open',
    created_at INTEGER
  );
`);

// Database Helper Methods
export const WorkspaceDB = {
  // Workspaces
  getWorkspace(id = 'default') {
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id);
    if (!row) {
      const now = Date.now();
      const defaultWs = {
        id,
        name: 'Default Workspace',
        active_project_id: null,
        preferences_json: JSON.stringify({ theme: 'dark', defaultStudio: 'diff' }),
        created_at: now,
        updated_at: now
      };
      db.prepare(`
        INSERT INTO workspaces (id, name, active_project_id, preferences_json, created_at, updated_at)
        VALUES (@id, @name, @active_project_id, @preferences_json, @created_at, @updated_at)
      `).run(defaultWs);
      return defaultWs;
    }
    return row;
  },

  updateWorkspace(id = 'default', updates = {}) {
    const ws = this.getWorkspace(id);
    const updated = {
      name: updates.name ?? ws.name,
      active_project_id: updates.active_project_id ?? ws.active_project_id,
      preferences_json: updates.preferences_json ? JSON.stringify(updates.preferences_json) : ws.preferences_json,
      updated_at: Date.now()
    };
    db.prepare(`
      UPDATE workspaces 
      SET name = @name, active_project_id = @active_project_id, preferences_json = @preferences_json, updated_at = @updated_at
      WHERE id = ?
    `).run({ ...updated, id });
    return this.getWorkspace(id);
  },

  // Projects
  getAllProjects() {
    return db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all().map(p => ({
      ...p,
      files: p.files_json ? JSON.parse(p.files_json) : []
    }));
  },

  saveProject({ id, name, repo_path, default_branch, files = [] }) {
    const projId = id || `proj_${Date.now()}`;
    const now = Date.now();
    db.prepare(`
      INSERT INTO projects (id, name, repo_path, default_branch, files_json, created_at, updated_at)
      VALUES (@id, @name, @repo_path, @default_branch, @files_json, @now, @now)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        repo_path = excluded.repo_path,
        default_branch = excluded.default_branch,
        files_json = excluded.files_json,
        updated_at = excluded.updated_at
    `).run({
      id: projId,
      name: name || 'Untitled Project',
      repo_path: repo_path || '',
      default_branch: default_branch || 'main',
      files_json: JSON.stringify(files),
      now
    });
    return this.getProject(projId);
  },

  getProject(id) {
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!row) return null;
    return {
      ...row,
      files: row.files_json ? JSON.parse(row.files_json) : []
    };
  },

  // Circuits
  getAllCircuits(projectId = null) {
    let stmt;
    if (projectId) {
      stmt = db.prepare('SELECT * FROM circuits WHERE project_id = ? ORDER BY updated_at DESC');
      return stmt.all(projectId).map(formatCircuitRow);
    }
    stmt = db.prepare('SELECT * FROM circuits ORDER BY updated_at DESC');
    return stmt.all().map(formatCircuitRow);
  },

  getCircuit(id) {
    const row = db.prepare('SELECT * FROM circuits WHERE id = ?').get(id);
    if (!row) return null;
    return formatCircuitRow(row);
  },

  saveCircuit(circuitData) {
    const id = circuitData.id || `circ_${Date.now()}`;
    const now = Date.now();

    db.prepare(`
      INSERT INTO circuits (
        id, project_id, title, prompt, description, domain,
        components_json, nets_json, specs_json, schematic_kicad,
        jev_evaluation_json, verified, created_at, updated_at
      ) VALUES (
        @id, @project_id, @title, @prompt, @description, @domain,
        @components_json, @nets_json, @specs_json, @schematic_kicad,
        @jev_evaluation_json, @verified, @now, @now
      ) ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        domain = excluded.domain,
        components_json = excluded.components_json,
        nets_json = excluded.nets_json,
        specs_json = excluded.specs_json,
        schematic_kicad = excluded.schematic_kicad,
        jev_evaluation_json = excluded.jev_evaluation_json,
        verified = excluded.verified,
        updated_at = excluded.updated_at
    `).run({
      id,
      project_id: circuitData.project_id || null,
      title: circuitData.title || 'Custom Circuit',
      prompt: circuitData.prompt || '',
      description: circuitData.description || '',
      domain: circuitData.domain || 'General',
      components_json: JSON.stringify(circuitData.components || []),
      nets_json: JSON.stringify(circuitData.nets || []),
      specs_json: JSON.stringify(circuitData.specs || []),
      schematic_kicad: circuitData.schematic_kicad || '',
      jev_evaluation_json: JSON.stringify(circuitData.jev_evaluation || {}),
      verified: circuitData.verified ? 1 : 0,
      now
    });

    return this.getCircuit(id);
  },

  // Component Alternatives Cache
  getCachedAlternatives(partNumber) {
    const clean = String(partNumber).trim().toUpperCase();
    const row = db.prepare('SELECT * FROM component_alternatives_cache WHERE part_number = ?').get(clean);
    if (!row) return null;
    return {
      ...row,
      alternatives: row.alternatives_json ? JSON.parse(row.alternatives_json) : []
    };
  },

  saveCachedAlternatives({ part_number, manufacturer, description, package_type, stock, unit_price, datasheet_url, alternatives = [] }) {
    const clean = String(part_number).trim().toUpperCase();
    db.prepare(`
      INSERT INTO component_alternatives_cache (
        part_number, manufacturer, description, package, stock, unit_price, datasheet_url, alternatives_json, updated_at
      ) VALUES (
        @part_number, @manufacturer, @description, @package, @stock, @unit_price, @datasheet_url, @alternatives_json, @now
      ) ON CONFLICT(part_number) DO UPDATE SET
        stock = excluded.stock,
        unit_price = excluded.unit_price,
        alternatives_json = excluded.alternatives_json,
        updated_at = excluded.updated_at
    `).run({
      part_number: clean,
      manufacturer: manufacturer || 'Generic',
      description: description || '',
      package: package_type || '',
      stock: stock || 10000,
      unit_price: unit_price || 0.10,
      datasheet_url: datasheet_url || '',
      alternatives_json: JSON.stringify(alternatives),
      now: Date.now()
    });
  }
};

function formatCircuitRow(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    title: row.title,
    prompt: row.prompt,
    description: row.description,
    domain: row.domain,
    components: row.components_json ? JSON.parse(row.components_json) : [],
    nets: row.nets_json ? JSON.parse(row.nets_json) : [],
    specs: row.specs_json ? JSON.parse(row.specs_json) : [],
    schematic_kicad: row.schematic_kicad,
    jev_evaluation: row.jev_evaluation_json ? JSON.parse(row.jev_evaluation_json) : {},
    verified: Boolean(row.verified),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
