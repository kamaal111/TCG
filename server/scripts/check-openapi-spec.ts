import fs from 'node:fs/promises';

import z from 'zod';

import App from '../src/app.ts';

const ArgsSchema = z.tuple([
  z
    .string()
    .nonempty()
    .refine(path => path.endsWith('.yaml'), 'Output file must have .yaml extension'),
]);

async function checkOpenAPISpec(outputFile: string) {
  const app = new App();
  console.log('🔄 Generating OpenAPI spec from the server app...');
  const generatedSpec = await app.generateSpec();
  const existingSpec = await fs.readFile(outputFile, 'utf8');
  if (generatedSpec === existingSpec) {
    console.log('✅ OpenAPI spec is up to date.');
    return;
  }

  console.error('❌ OpenAPI spec is out of date. Run `just download-spec` and commit the updated file.');
  process.exit(1);
}

function parseArgs() {
  try {
    return ArgsSchema.parse(process.argv.slice(2))[0];
  } catch (error) {
    console.log('🐸🐸🐸 error', error);
    assert(error instanceof z.ZodError);

    console.error('❌ Invalid arguments:');
    error.issues.forEach(issue => {
      const argName = issue.path.length > 0 ? `Argument ${Number(issue.path[0]) + 1}` : 'Arguments';
      console.error(`   ${argName}: ${issue.message}`);
    });
    console.error('Usage: tsx scripts/check-openapi-spec.ts <outputFile>');
    process.exit(1);
  }
}

const outputFile = parseArgs();
await checkOpenAPISpec(outputFile);
