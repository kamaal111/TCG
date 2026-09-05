// Forbids `import { type A, type B } from 'x'` in favor of `import type { A, B } from 'x'`.
// Mixed imports such as `import { ok, type Result } from 'neverthrow'` are left untouched,
// since splitting those into two statements is not desired here.

interface ImportSpecifierNode {
  type: 'ImportSpecifier';
  importKind?: 'type' | 'value';
  imported: { name: string };
  local: { name: string };
}

interface ImportDeclarationNode {
  type: 'ImportDeclaration';
  importKind?: 'type' | 'value';
  specifiers: (ImportSpecifierNode | { type: 'ImportDefaultSpecifier' | 'ImportNamespaceSpecifier' })[];
  source: unknown;
}

interface RuleFixer {
  replaceText(node: unknown, text: string): unknown;
}

interface SourceCode {
  getText(node: unknown): string;
}

interface RuleContext {
  sourceCode: SourceCode;
  report(descriptor: { node: unknown; message: string; fix?: (fixer: RuleFixer) => unknown }): void;
}

function isImportSpecifier(specifier: ImportDeclarationNode['specifiers'][number]): specifier is ImportSpecifierNode {
  return specifier.type === 'ImportSpecifier';
}

export default {
  meta: { name: 'local' },
  rules: {
    'no-all-inline-type-imports': {
      meta: { fixable: 'code' },
      create(context: RuleContext) {
        return {
          ImportDeclaration(node: ImportDeclarationNode) {
            if (node.importKind === 'type') return;

            const namedSpecifiers = node.specifiers.filter(isImportSpecifier);
            if (namedSpecifiers.length === 0) return;

            const hasNonNamedSpecifiers = namedSpecifiers.length !== node.specifiers.length;
            if (hasNonNamedSpecifiers) return;

            const allInlineType = namedSpecifiers.every(specifier => specifier.importKind === 'type');
            if (!allInlineType) return;

            context.report({
              node,
              message:
                'Use a top-level `import type` instead of marking every named specifier with an inline `type` modifier.',
              fix(fixer) {
                const names = namedSpecifiers.map(specifier =>
                  specifier.imported.name === specifier.local.name
                    ? specifier.imported.name
                    : `${specifier.imported.name} as ${specifier.local.name}`,
                );
                const sourceText = context.sourceCode.getText(node.source);
                return fixer.replaceText(node, `import type { ${names.join(', ')} } from ${sourceText};`);
              },
            });
          },
        };
      },
    },
  },
};
