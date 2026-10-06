async function main(): Promise<void> {
  const response = await fetch('http://127.0.0.1:8080/health/ping', {
    signal: AbortSignal.timeout(2000),
  });

  if (!response.ok) {
    process.exit(1);
  }

  process.stdout.write(await response.text());
}

void main();
