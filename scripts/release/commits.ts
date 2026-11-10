import { ShaSchema } from './contracts.ts';
import { gitCommitCount, gitCommitExists, gitFirstCommit, gitIsAncestor, gitLog, gitRevision } from '../git.ts';
import { InfraFailure } from '../infra/errors.ts';

type Command = (program: string, args: string[]) => Promise<string>;

export async function selectRelease(command: Command, revision: string, main: string): Promise<string> {
  try {
    const sha = ShaSchema.parse(await gitRevision(command, revision));
    await gitIsAncestor(command, sha, main);

    return sha;
  } catch {
    throw new InfraFailure('Cannot select release. Choose a commit already merged into origin/main.');
  }
}

export async function commitSummary(command: Command, deployed: string | null, selected: string): Promise<string> {
  try {
    const { range, divergent } = await commitComparison(command, deployed, selected);

    const output = await gitLog(command, { range, format: 'summary' });

    const commits = output.trim();

    const summary = commits
      ? `Commits to release (${commits.split('\n').length}):\n${commits}`
      : 'No unreleased commits.';

    if (deployed === null) {
      return `First release\n${summary}`;
    }

    return divergent ? `Selected revision is older than or divergent from the deployed revision.\n${summary}` : summary;
  } catch {
    throw new InfraFailure(
      'Commit comparison unavailable. Check Git history and fetch the deployed revision before retrying.',
    );
  }
}

/** Structured counterpart to the terminal preview, shared with the native portal. */
export async function pendingCommits(command: Command, deployed: string | null, selected: string, page: number) {
  try {
    const { range, divergent } = await commitComparison(command, deployed, selected);
    const pending = Number(await gitCommitCount(command, range));

    const output = await gitLog(command, { range, format: 'commits', limit: 50, skip: page * 50 });

    const commits = output.trim()
      ? output
          .trim()
          .split('\n')
          .map(line => {
            const [sha, subject, author, date] = line.split('\0');

            return { sha, subject, author, date };
          })
      : [];

    return {
      main: selected,
      pending,
      commits,
      nextPage: (page + 1) * 50 < pending ? page + 1 : null,
      blocker: divergent ? 'The deployed revision diverges from main. Review it in the terminal.' : null,
    };
  } catch {
    throw new InfraFailure(
      'Commit comparison unavailable. Check Git history and fetch the deployed revision before retrying.',
    );
  }
}

async function commitComparison(command: Command, deployed: string | null, selected: string) {
  ShaSchema.parse(selected);

  if (deployed !== null) {
    ShaSchema.parse(deployed);
    await gitCommitExists(command, deployed);
  }

  const divergent = deployed ? Boolean(await gitFirstCommit(command, `${selected}..${deployed}`)) : false;

  return { range: deployed === null ? selected : `${deployed}..${selected}`, divergent };
}
