type Command<Output> = (program: string, args: string[]) => Output;

interface FetchOptions {
  remote?: string;
  revision?: string;
  noTags?: boolean;
}

interface LogOptions {
  range: string;
  format: 'summary' | 'commits';
  limit?: number;
  skip?: number;
}

const LOG_FORMATS = { summary: '%h %s', commits: '%H%x00%s%x00%an%x00%aI' } as const;

export function gitFetch<Output>(command: Command<Output>, options: FetchOptions = {}): Output {
  return command('git', [
    'fetch',
    ...(options.noTags ? ['--no-tags'] : []),
    options.remote ?? 'origin',
    options.revision ?? 'main',
  ]);
}

export function gitRevision<Output>(command: Command<Output>, revision = 'HEAD'): Output {
  return command('git', ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]);
}

export function gitCurrentBranch<Output>(command: Command<Output>): Output {
  return command('git', ['branch', '--show-current']);
}

export function gitStatus<Output>(command: Command<Output>): Output {
  return command('git', ['status', '--porcelain']);
}

export function gitFastForward<Output>(command: Command<Output>, revision: string): Output {
  return command('git', ['merge', '--ff-only', revision]);
}

export function gitCommitExists<Output>(command: Command<Output>, revision: string): Output {
  return command('git', ['cat-file', '-e', `${revision}^{commit}`]);
}

export function gitIsAncestor<Output>(command: Command<Output>, ancestor: string, descendant: string): Output {
  return command('git', ['merge-base', '--is-ancestor', ancestor, descendant]);
}

export function gitLog<Output>(command: Command<Output>, options: LogOptions): Output {
  return command('git', [
    '--no-pager',
    'log',
    '--no-color',
    '--topo-order',
    `--format=${LOG_FORMATS[options.format]}`,
    ...(options.limit === undefined ? [] : [`--max-count=${options.limit}`]),
    ...(options.skip === undefined ? [] : [`--skip=${options.skip}`]),
    options.range,
    '--',
  ]);
}

export function gitCommitCount<Output>(command: Command<Output>, range: string): Output {
  return command('git', ['rev-list', '--count', range, '--']);
}

export function gitFirstCommit<Output>(command: Command<Output>, range: string): Output {
  return command('git', ['rev-list', '--max-count=1', range, '--']);
}

export function gitChangedFiles<Output>(
  command: Command<Output>,
  options: { from: string; to: string; paths: string[] },
): Output {
  return command('git', ['diff', '--name-only', options.from, options.to, '--', ...options.paths]);
}

export function gitAddDetachedWorktree<Output>(command: Command<Output>, worktree: string, revision: string): Output {
  return command('git', ['worktree', 'add', '--detach', worktree, revision]);
}

export function gitRemoveWorktree<Output>(
  command: Command<Output>,
  options: { path: string; force?: boolean },
): Output {
  return command('git', ['worktree', 'remove', ...(options.force ? ['--force'] : []), options.path]);
}

export function gitRemoteUrl<Output>(command: Command<Output>, remote = 'origin'): Output {
  return command('git', ['remote', 'get-url', remote]);
}
