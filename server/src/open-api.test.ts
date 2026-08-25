import * as yaml from 'js-yaml';

import { YAML_OPTIONS } from './open-api.ts';

describe('YAML_OPTIONS', () => {
  test('spells out a value shared by two routes instead of aliasing it', () => {
    const sharedTags = ['cards'];
    const document = { paths: { a: { tags: sharedTags }, b: { tags: sharedTags } } };

    const output = yaml.dump(document, YAML_OPTIONS);

    expect(output).not.toMatch(/[&*]ref/);
  });

  test('would alias that shared value without noRefs', () => {
    const sharedTags = ['cards'];
    const document = { paths: { a: { tags: sharedTags }, b: { tags: sharedTags } } };

    const output = yaml.dump(document, { indent: YAML_OPTIONS.indent });

    expect(output).toMatch(/[&*]ref/);
  });
});
