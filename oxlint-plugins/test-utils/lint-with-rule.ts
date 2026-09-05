import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const OXLINT_PLUGINS_DIR = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(OXLINT_PLUGINS_DIR, '..');
const OXLINT_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'oxlint');

interface LintWithRuleInput {
  plugin: string;
  ruleId: string;
  source: string;
}

interface LintWithRuleResult {
  isReported: boolean;
  fixedSource: string;
}

function ruleDiagnosticCode(ruleId: string): string {
  const [namespace, ruleName] = ruleId.split('/');
  return `${namespace}(${ruleName})`;
}

export async function lintWithRule({ plugin, ruleId, source }: LintWithRuleInput): Promise<LintWithRuleResult> {
  const pluginPath = path.join(OXLINT_PLUGINS_DIR, plugin);
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'oxlint-rule-test-'));

  try {
    const configPath = path.join(workspace, '.oxlintrc.json');
    const fixturePath = path.join(workspace, 'fixture.ts');

    await fs.writeFile(
      configPath,
      JSON.stringify({
        jsPlugins: [pluginPath],
        rules: { [ruleId]: 'error' },
      }),
    );
    await fs.writeFile(fixturePath, source);

    const reportRun = childProcess.spawnSync(OXLINT_BIN, ['-c', configPath, '--format', 'json', fixturePath], {
      encoding: 'utf8',
    });
    const diagnosticCode = ruleDiagnosticCode(ruleId);
    const isReported = reportRun.stdout.includes(diagnosticCode);

    childProcess.spawnSync(OXLINT_BIN, ['-c', configPath, '--fix', fixturePath], { encoding: 'utf8' });
    const fixedSource = await fs.readFile(fixturePath, 'utf8');

    return { isReported, fixedSource };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}
