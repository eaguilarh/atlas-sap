// ============================================================
// ATLAS SAP Operations Suite — Frontend Integrity & UI Tests
// Runner: node --test tests/frontend-lint.test.js
// ============================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const findFile = (filename) => {
  const candidates = [
    path.join(__dirname, '..', filename),
    path.join(__dirname, '..', 'frontend', filename),
    path.join(__dirname, filename)
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
};

test('1. index.html Existence and Basic Structure', () => {
  const htmlPath = findFile('index.html');
  assert.ok(htmlPath, 'index.html must exist');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.ok(html.includes('<!DOCTYPE html>'), 'Must contain <!DOCTYPE html>');
  assert.ok(html.includes('<html'), 'Must contain <html>');
  assert.ok(html.includes('</html>'), 'Must contain </html>');
});

test('2. Required DOM IDs for TQS & Alertas Filtering', () => {
  const htmlPath = findFile('index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  
  const requiredIds = [
    'sidebar-rfc-scope',
    'sidebar-scope-indicator',
    'alerts-search-input',
    'alerts-tqs-filter',
    'alerts-full-list',
    'vobo-search-input',
    'vobo-tqs-filter',
    'vobo-table-content'
  ];

  for (const id of requiredIds) {
    assert.ok(
      html.includes(`id="${id}"`),
      `Element with id="${id}" must exist in index.html`
    );
  }
});

test('3. styles.css Integrity', () => {
  const cssPath = findFile('styles.css');
  assert.ok(cssPath, 'styles.css must exist');
  const css = fs.readFileSync(cssPath, 'utf8');
  assert.ok(css.length > 1000, 'styles.css must not be empty');
  assert.ok(css.includes(':root'), 'styles.css must contain CSS custom properties :root');
});
