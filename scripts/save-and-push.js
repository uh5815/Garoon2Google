const { spawnSync } = require('node:child_process');

const COMMIT_MESSAGE = 'Save current changes';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function getOutput(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.trim();
}

const branch = getOutput('git', ['branch', '--show-current']);
if (branch !== 'main') {
  console.error(`Refusing to push from ${branch}. Switch to main first.`);
  process.exit(1);
}

console.log('Running tests...');
run(process.execPath, ['--test'], { env: process.env });

console.log('Checking the diff...');
run('git', ['diff', '--check']);

console.log('Staging tracked changes...');
run('git', ['add', '-u']);
run('git', ['add', '--', 'scripts/save-and-push.js']);
run('git', ['diff', '--cached', '--check']);

const stagedChanges = getOutput('git', ['diff', '--cached', '--name-only']);
if (stagedChanges) {
  console.log(`Committing: ${COMMIT_MESSAGE}`);
  run('git', ['commit', '-m', COMMIT_MESSAGE]);
} else {
  console.log('No new tracked changes to commit.');
}

console.log('Pushing main...');
run('git', ['push', 'origin', 'main']);
console.log('Done.');
