import fs from 'node:fs/promises';

import { createLintFixture, lintFixture } from './oxlint-test-utils.ts';

const RULE_CODE = '@stylistic(lines-between-class-members)';

const COMPACT_CLASS = `export class Example {
  private readonly value: string;
  readonly label = 'example';
  constructor(value: string) {
    this.value = value;
  }
  read(): string {
    return this.value;
  }
}
`;

const SPACED_CLASS = `export class Example {
  private readonly value: string;
  readonly label = 'example';

  constructor(value: string) {
    this.value = value;
  }

  read(): string {
    return this.value;
  }
}
`;

test('Oxlint rejects a constructor touching fields and a method touching its constructor', async () => {
  const filename = await createLintFixture(COMPACT_CLASS);
  const result = lintFixture(filename);
  expect(result.status).toBe(1);
  expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual([RULE_CODE, RULE_CODE]);
});

test('Oxlint accepts spaced methods while allowing consecutive fields to stay grouped', async () => {
  const filename = await createLintFixture(SPACED_CLASS);
  const result = lintFixture(filename);
  expect(result.status).toBe(0);
  expect(result.diagnostics).toEqual([]);
});

test('Oxlint fixes missing class-member spacing automatically', async () => {
  const filename = await createLintFixture(COMPACT_CLASS);
  const result = lintFixture(filename, true);
  expect(result.status).toBe(0);
  expect(result.diagnostics).toEqual([]);
  expect(await fs.readFile(filename, 'utf8')).toBe(SPACED_CLASS);
});
