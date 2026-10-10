import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import stringDecoder from 'node:string_decoder';

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
  let bootTimer: ReturnType<typeof setTimeout> | undefined;
  const started = performance.now();
  const milestones = new Map<string, number>();
  let testCount = 0;

  function milestone(name: string): void {
    if (!milestones.has(name)) {
      milestones.set(name, performance.now() - started);
      log(`${name} (${((performance.now() - started) / 1000).toFixed(1)}s since start).`);
    }
  }

  function observeLine(line: string): void {
    if (line.includes('Resolve Package Graph')) {
      milestone('Package resolution started');
    }

    if (line.includes('Resolved source packages:')) {
      milestone('Package resolution completed');
    }

    if (line.includes("Test Suite 'Selected tests' started") || line.includes('◇ Test run started.')) {
      milestone('First test started');
    }

    const count = /Test run with (\d+) tests?\b/.exec(line)?.[1];

    if (count !== undefined) {
      testCount += Number(count);
    }
  }

  function observeOutput(): (data: Buffer) => void {
    const decoder = new stringDecoder.StringDecoder('utf8');
    let pending = '';

    return data => {
      pending += decoder.write(data);
      let newline: number;

      while ((newline = pending.indexOf('\n')) !== -1) {
        observeLine(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }

      // xcodebuild emits newline-delimited output; bound unexpected partial lines.
      if (pending.length > 65_536) {
        pending = pending.slice(-65_536);
      }
    };
  }

  function summarize(): void {
    milestone('Snapshot step completed');

    const seconds = (value: number | undefined) =>
      value === undefined ? 'Unavailable' : `${(value / 1000).toFixed(1)}s`;

    const resolutionStart = milestones.get('Package resolution started');
    const resolutionEnd = milestones.get('Package resolution completed');

    const summary = [
      '### iOS snapshot performance',
      '',
      '| Measurement | Result |',
      '| --- | --- |',
      `| Snapshot step | ${seconds(performance.now() - started)} |`,
      `| Swift dependency cache hit | ${process.env.TCG_SWIFT_PACKAGE_CACHE_HIT === 'true' ? 'Yes' : 'No'} |`,
      `| Package resolution | ${seconds(resolutionStart !== undefined && resolutionEnd !== undefined ? resolutionEnd - resolutionStart : undefined)} |`,
      `| Time to first test (resolution, build, startup) | ${seconds(milestones.get('First test started'))} |`,
      `| Reported completed tests | ${testCount} |`,
      `| Exit code | ${exitCode} |`,
      '',
    ].join('\n');

    const summaryPath = process.env.GITHUB_STEP_SUMMARY;

    if (summaryPath) {
      try {
        fs.appendFileSync(summaryPath, summary + '\n');
      } catch (error) {
        log(`Could not write performance summary: ${String(error)}`);
      }
    }
  }

  function finish(): void {
    clearTimeout(graceTimer);
    clearTimeout(shutdownTimer);
    clearTimeout(idleTimer);
    clearTimeout(bootTimer);
    signalGroup(shutdown, 'SIGKILL');
    summarize();
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
    clearTimeout(bootTimer);
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
    clearTimeout(bootTimer);
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

  const simulator = process.env.TCG_IOS_SNAPSHOT_SIMULATOR;
  const snapshotArgs = process.argv.slice(2);

  const buildArgs = snapshotArgs.filter(
    (argument, index) => argument !== '-resultBundlePath' && snapshotArgs[index - 1] !== '-resultBundlePath',
  );

  function launch(command: string, args: string[], phase: 'build' | 'boot' | 'test' = 'test'): void {
    tests = childProcess.spawn(command, args, {
      detached: true,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    tests.stdout?.pipe(process.stdout);
    tests.stderr?.pipe(process.stderr);
    tests.stdout?.on('data', resetIdleDeadline);
    tests.stderr?.on('data', resetIdleDeadline);
    tests.stdout?.on('data', observeOutput());
    tests.stderr?.on('data', observeOutput());
    resetIdleDeadline();
    log(`Started ${phase} in process group ${tests.pid ?? 'unavailable'}.`);
    tests.once('error', error => {
      log(`Could not launch ${phase === 'test' ? 'iOS snapshots' : phase}: ${error.message}`);
      cleanup();
    });
    tests.once('exit', (code, signal) => {
      clearTimeout(bootTimer);

      if (phase !== 'test' && code === 0 && !cancelled && !timedOut && !cleaningUp) {
        signalGroup(tests, 'SIGKILL');

        if (phase === 'build' && simulator) {
          log('Snapshot build completed; booting simulator.');
          launch('xcrun', ['simctl', 'bootstatus', simulator, '-b'], 'boot');
          bootTimer = setTimeout(() => {
            timedOut = true;
            exitCode = 124;
            log(`Simulator boot exceeded ${idleTimeoutSeconds} seconds; failing before tests.`);
            cleanup();
          }, idleTimeoutSeconds * 1000);
        } else {
          log('Simulator boot completed; starting snapshots.');
          launch('just', ['test-built-snapshots-ios', ...snapshotArgs]);
        }

        return;
      }

      if (!cancelled && !timedOut) {
        exitCode = code ?? (signal === null ? 1 : 128 + os.constants.signals[signal]);
      }

      cleanup();
    });
  }

  process.on('SIGINT', () => cancel('SIGINT'));
  process.on('SIGTERM', () => cancel('SIGTERM'));

  if (simulator) {
    launch('just', ['build-snapshots-ios', ...buildArgs], 'build');
  } else {
    launch('just', ['test-snapshots-ios', ...snapshotArgs]);
  }
}

run();
