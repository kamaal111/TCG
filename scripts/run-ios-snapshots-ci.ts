import childProcess from 'node:child_process';
import os from 'node:os';

const gracePeriodMs = 2000;

const shutdownTimeoutMs = 2000;

function log(message: string): void {
  console.error(`[iOS snapshots ${new Date().toISOString()}] ${message}`);
}

function signalGroup(child: childProcess.ChildProcess | undefined, signal: NodeJS.Signals): void {
  if (child?.pid === undefined) {
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return;
    }

    log(`Could not send ${signal} to process group ${child.pid}: ${String(error)}`);
  }
}

function run(): void {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.platform === 'win32') {
    log('This supervisor requires GitHub Actions on a POSIX runner; use the local just recipes instead.');
    process.exitCode = 1;

    return;
  }

  const idleTimeoutSeconds = Number(process.env.TCG_IOS_SNAPSHOT_IDLE_TIMEOUT_SECONDS ?? 180);

  if (!Number.isSafeInteger(idleTimeoutSeconds) || idleTimeoutSeconds <= 0) {
    log('TCG_IOS_SNAPSHOT_IDLE_TIMEOUT_SECONDS must be a positive integer.');
    process.exitCode = 1;

    return;
  }

  let tests: childProcess.ChildProcess | undefined;
  let shutdown: childProcess.ChildProcess | undefined;
  let exitCode = 1;
  let cancelled = false;
  let timedOut = false;
  let cleaningUp = false;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function finish(): void {
    clearTimeout(graceTimer);
    clearTimeout(shutdownTimer);
    clearTimeout(idleTimer);
    signalGroup(shutdown, 'SIGKILL');
    log(`Cleanup complete; exiting ${exitCode}.`);
    process.exit(exitCode);
  }

  function cleanup(): void {
    if (cleaningUp) {
      return;
    }

    cleaningUp = true;
    clearTimeout(graceTimer);
    clearTimeout(idleTimer);
    signalGroup(tests, 'SIGKILL');
    log('Stopping CI simulators (two-second deadline).');
    shutdown = childProcess.spawn('xcrun', ['simctl', 'shutdown', 'all'], { detached: true, stdio: 'inherit' });
    shutdown.once('error', error => {
      log(`Could not launch simulator shutdown: ${error.message}`);
      finish();
    });
    shutdown.once('exit', (code, signal) => {
      if (code !== 0) {
        log(`Simulator shutdown exited with code ${code}, signal ${signal}.`);
      }

      finish();
    });
    shutdownTimer = setTimeout(() => {
      log('Simulator shutdown timed out; sending SIGKILL.');
      finish();
    }, shutdownTimeoutMs);
  }

  function cancel(signal: 'SIGINT' | 'SIGTERM'): void {
    const repeated = cancelled;

    if (!cancelled) {
      exitCode = signal === 'SIGINT' ? 130 : 143;
    }

    cancelled = true;
    clearTimeout(idleTimer);
    log(`Received ${signal}${repeated ? ' again' : ''}; cancelling iOS snapshots.`);

    if (cleaningUp) {
      finish();
    } else if (signal === 'SIGTERM' || repeated) {
      log('Sending SIGKILL to the test process group.');
      cleanup();
    } else {
      signalGroup(tests, 'SIGINT');
      graceTimer = setTimeout(() => {
        log('Graceful cancellation timed out; sending SIGKILL to the test process group.');
        cleanup();
      }, gracePeriodMs);
    }
  }

  function resetIdleDeadline(): void {
    clearTimeout(idleTimer);

    if (cancelled || cleaningUp) {
      return;
    }

    idleTimer = setTimeout(() => {
      timedOut = true;
      exitCode = 124;
      log(`No build or test output for ${idleTimeoutSeconds} seconds; failing stalled iOS snapshots.`);
      cleanup();
    }, idleTimeoutSeconds * 1000);
  }

  process.on('SIGINT', () => cancel('SIGINT'));
  process.on('SIGTERM', () => cancel('SIGTERM'));
  tests = childProcess.spawn('just', ['test-snapshots-ios', ...process.argv.slice(2)], {
    detached: true,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  tests.stdout?.pipe(process.stdout);
  tests.stderr?.pipe(process.stderr);
  tests.stdout?.on('data', resetIdleDeadline);
  tests.stderr?.on('data', resetIdleDeadline);
  resetIdleDeadline();
  log(`Started iOS snapshots in process group ${tests.pid ?? 'unavailable'}.`);
  tests.once('error', error => {
    log(`Could not launch iOS snapshots: ${error.message}`);
    cleanup();
  });
  tests.once('exit', (code, signal) => {
    if (!cancelled && !timedOut) {
      exitCode = code ?? (signal === null ? 1 : 128 + os.constants.signals[signal]);
    }

    cleanup();
  });
}

run();
