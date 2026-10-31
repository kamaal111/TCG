async function main(): Promise<void> {
  const response = await fetch('http://127.0.0.1:8080/health/ping', {
    signal: AbortSignal.timeout(2000),
  });

  const body = await response.text();

  if (!response.ok || body !== '{"message":"PONG"}') {
    process.exitCode = 1;

    return;
  }

  process.stdout.write(body);
}

void main().catch(() => {
  process.exitCode = 1;
});
