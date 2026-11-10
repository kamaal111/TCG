import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';

import { commitSummary, pendingCommits, selectRelease } from './commits.ts';

const execute = util.promisify(childProcess.execFile);

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-commits-'));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true }));

  const command = async (program: string, args: string[]) => {
    const result = await execute(program, args, { cwd: root });

    return result.stdout.trim();
  };

  const git = (args: string[]) => command('git', args);
  await git(['init', '-b', 'main']);
  await git(['config', 'user.name', 'Release Test']);
  await git(['config', 'user.email', 'release@example.com']);

  const commit = async (subject: string) => {
    await git(['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', subject]);

    return git(['rev-parse', 'HEAD']);
  };

  const base = await commit('Initial release');
  const app = await commit('feat(app): add collection search');
  const server = await commit('fix(server): correct card prices');

  return { command, git, commit, base, app, server };
}

test('lists all absent commits newest first without including the deployed commit', async () => {
  const f = await fixture();
  expect(await commitSummary(f.command, f.base, f.server)).toBe(
    `Commits to release (2):\n${f.server.slice(0, 7)} fix(server): correct card prices\n${f.app.slice(0, 7)} feat(app): add collection search`,
  );
});

test('an older selected release excludes newer main commits', async () => {
  const f = await fixture();
  expect(await selectRelease(f.command, f.app, f.server)).toBe(f.app);
  expect(await commitSummary(f.command, f.base, f.app)).toBe(
    `Commits to release (1):\n${f.app.slice(0, 7)} feat(app): add collection search`,
  );
});

test('identical revisions explicitly report no unreleased commits', async () => {
  const f = await fixture();
  expect(await commitSummary(f.command, f.server, f.server)).toBe('No unreleased commits.');
});

test('first releases label the complete selected history', async () => {
  const f = await fixture();
  expect(await commitSummary(f.command, null, f.base)).toBe(
    `First release\nCommits to release (1):\n${f.base.slice(0, 7)} Initial release`,
  );
});

test('older targets are distinguished from identical revisions', async () => {
  const f = await fixture();
  expect(await commitSummary(f.command, f.server, f.app)).toBe(
    'Selected revision is older than or divergent from the deployed revision.\nNo unreleased commits.',
  );
});

test('missing deployed history fails rather than claiming an empty release', async () => {
  const f = await fixture();
  await expect(commitSummary(f.command, 'a'.repeat(40), f.server)).rejects.toThrow('Commit comparison unavailable');
});

test('unmerged revisions cannot be selected', async () => {
  const f = await fixture();
  await f.git(['checkout', '-b', 'feature', f.base]);
  const feature = await f.commit('Unmerged change');
  await expect(selectRelease(f.command, feature, f.server)).rejects.toThrow('already merged');
});

test('divergent targets list only commits absent from deployed history', async () => {
  const f = await fixture();
  await f.git(['checkout', '-b', 'feature', f.base]);
  const feature = await f.commit('Feature change');
  expect(await commitSummary(f.command, f.server, feature)).toBe(
    `Selected revision is older than or divergent from the deployed revision.\nCommits to release (1):\n${feature.slice(0, 7)} Feature change`,
  );
});

test('merge commits and their merged branch commits appear in the comparison', async () => {
  const f = await fixture();
  await f.git(['checkout', '-b', 'feature', f.base]);
  const feature = await f.commit('Feature change');
  await f.git(['checkout', 'main']);
  await f.git(['-c', 'core.hooksPath=/dev/null', 'merge', '--no-ff', 'feature', '-m', 'Merge feature']);
  const merged = await f.git(['rev-parse', 'HEAD']);
  const summary = await commitSummary(f.command, f.server, merged);
  expect(summary).toBe(
    `Commits to release (2):\n${merged.slice(0, 7)} Merge feature\n${feature.slice(0, 7)} Feature change`,
  );
});

test('structured preview includes all commits and flags divergence using the same history rules', async () => {
  const f = await fixture();
  const pending = await pendingCommits(f.command, f.base, f.server, 0);
  expect(pending.pending).toBe(2);
  expect(pending.commits.map(commit => commit.sha)).toEqual([f.server, f.app]);
  expect(pending.blocker).toBeNull();
  expect((await pendingCommits(f.command, f.server, f.server, 0)).commits).toEqual([]);
  expect((await pendingCommits(f.command, null, f.server, 0)).pending).toBe(3);
  expect((await pendingCommits(f.command, f.server, f.app, 0)).blocker).toContain('diverges');
  await expect(pendingCommits(f.command, 'a'.repeat(40), f.server, 0)).rejects.toThrow('comparison unavailable');
});

test('structured preview pages without skipping or repeating commits', async () => {
  const f = await fixture();

  for (let index = 0; index < 51; index += 1) {
    await f.commit(`Change ${index}`);
  }

  const selected = await f.git(['rev-parse', 'HEAD']);
  const first = await pendingCommits(f.command, f.base, selected, 0);
  const second = await pendingCommits(f.command, f.base, selected, 1);
  expect(first.pending).toBe(53);
  expect(first.commits).toHaveLength(50);
  expect(first.nextPage).toBe(1);
  expect(second.commits).toHaveLength(3);
  expect(second.nextPage).toBeNull();
  expect(new Set([...first.commits, ...second.commits].map(commit => commit.sha)).size).toBe(53);
});
