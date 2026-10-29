import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const [executable, ...args] = process.argv.slice(2);

const root = process.env.CURRENCY_TEST_ROOT;

assert(executable && root, 'Expected a command name and fixture directory.');

const command = path.basename(executable);

const loaded = path.join(root, 'loaded');

const installed = path.join(root, 'installed.plist');

switch (command) {
  case 'uname':
    console.log(process.env.CURRENCY_TEST_PLATFORM || 'Darwin');
    break;
  case 'id':
    console.log(args[0] === '-u' ? process.env.CURRENCY_TEST_UID || '501' : 'tcg-user');
    break;
  case 'date':
    console.log(process.env.CURRENCY_TEST_TIME || '1715');
    break;
  default:
    fs.appendFileSync(path.join(root, 'calls.jsonl'), `${JSON.stringify([command, ...args])}\n`);

    if (args.includes(process.env.CURRENCY_TEST_FAILURE ?? '')) {
      console.error('Administrative command failed');
      process.exit(1);
    }

    if (command === 'launchctl') {
      if (!fs.existsSync(loaded)) {
        console.error('Could not find service');
        process.exit(113);
      }

      console.log('last exit code = 0');
    }

    if (command === 'sudo') {
      if (args[0] === '/usr/bin/install') {
        const source = args.at(-2);
        assert(source, 'Expected the source plist.');
        fs.copyFileSync(source, installed);
      }

      if (args.includes('bootout')) {
        fs.rmSync(loaded, { force: true });
      }

      if (args.includes('bootstrap')) {
        fs.writeFileSync(loaded, 'loaded');
      }

      if (args[0] === '/bin/rm') {
        fs.rmSync(installed, { force: true });
      }
    }
}
