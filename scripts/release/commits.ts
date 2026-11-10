import { ShaSchema } from './contracts.ts';
import { InfraFailure } from '../infra/errors.ts';

type Command = (program: string, args: string[]) => Promise<string>;

export async function selectRelease(command: Command, revision: string, main: string): Promise<string> {
  try {
    const sha = ShaSchema.parse(
      await command('git', ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]),
    );

    await command('git', ['merge-base', '--is-ancestor', sha, main]);

    return sha;
  } catch {
    throw new InfraFailure('Cannot select release. Choose a commit already merged into origin/main.');
  }
}

export async function commitSummary(command: Command, deployed: string | null, selected: string): Promise<string> {
  try {
    ShaSchema.parse(selected);

    if (deployed !== null) {
      ShaSchema.parse(deployed);
      await command('git', ['cat-file', '-e', `${deployed}^{commit}`]);
    }

    const range = deployed === null ? selected : `${deployed}..${selected}`;

    const output = await command('git', [
      '--no-pager',
      'log',
      '--no-color',
      '--format=%h %s',
      '--topo-order',
      range,
      '--',
    ]);

    const commits = output.trim();

    const summary = commits
      ? `Commits to release (${commits.split('\n').length}):\n${commits}`
      : 'No unreleased commits.';

    if (deployed === null) {
      return `First release\n${summary}`;
    }

    const ancestors = await command('git', ['rev-list', '--max-count=1', `${selected}..${deployed}`, '--']);

    return ancestors ? `Selected revision is older than or divergent from the deployed revision.\n${summary}` : summary;
  } catch {
    throw new InfraFailure(
      'Commit comparison unavailable. Check Git history and fetch the deployed revision before retrying.',
    );
  }
}
