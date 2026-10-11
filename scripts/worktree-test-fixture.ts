import childProcess from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function worktreeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tcg-worktree-'));
  onTestFinished(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const main = path.join(root, 'main');
  const checkout = path.join(root, 'checkout with spaces');
  await fs.mkdir(main);
  const realGit = childProcess.spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();

  const git = (args: string[], cwd = main) => {
    const result = childProcess.spawnSync(realGit, args, { cwd, encoding: 'utf8' });
    expect(result.status).toBe(0);

    return result.stdout.trim();
  };

  git(['init', '-b', 'main']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '--allow-empty', '-m', 'Fixture']);

  return { root, main: await fs.realpath(main), checkout, realGit, git };
}
