import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import util from 'node:util';

import * as yaml from 'js-yaml';

const execute = util.promisify(childProcess.execFile);

test('the generated independent Swift contract matches the Hono routes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'devportal-spec-'));
  onTestFinished(() => fs.rm(directory, { recursive: true, force: true }));
  const relative = 'app/Modules/MintomoDevportal/Sources/MintomoDevportal/openapi.yaml';
  const generated = path.join(directory, relative);
  await fs.mkdir(path.dirname(generated), { recursive: true });
  await execute(process.execPath, [url.fileURLToPath(new URL('./spec.ts', import.meta.url))], { cwd: directory });
  const contract = new URL(`../../${relative}`, import.meta.url);
  expect(yaml.load(await fs.readFile(generated, 'utf8'))).toEqual(yaml.load(await fs.readFile(contract, 'utf8')));
});
