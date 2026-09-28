// Run before every push that changes the app: node scripts/release.cjs
// Bumps the app version in docs/version.js, docs/version.json and docs/sw.js together, so phones
// download fresh files and the Home screen shows "New version available".
const fs = require('fs');
const path = require('path');
const d = (f) => path.join(__dirname, '..', 'docs', f);
const cur = JSON.parse(fs.readFileSync(d('version.json'), 'utf8')).v;
const v = cur + 1;
fs.writeFileSync(d('version.json'), JSON.stringify({ v }) + '\n');
fs.writeFileSync(d('version.js'), fs.readFileSync(d('version.js'), 'utf8').replace(/APP_VERSION = \d+/, `APP_VERSION = ${v}`));
fs.writeFileSync(d('sw.js'), fs.readFileSync(d('sw.js'), 'utf8').replace(/const VERSION = 'fit-v\d+'/, `const VERSION = 'fit-v${v}'`));
console.log(`App version ${cur} → ${v}`);
