import { definePlugin } from '@oxlint/plugins';

export default definePlugin({
  meta: { name: 'tcg-zod' },
  rules: {
    'prefer-nullish': {
      meta: { type: 'suggestion' },
      create(context) {
        return {
          CallExpression(node) {
            const outer = node.callee;

            if (outer.type !== 'MemberExpression' || outer.computed || outer.property.type !== 'Identifier') {
              return;
            }

            const inner = outer.object;

            if (inner.type !== 'CallExpression' || inner.callee.type !== 'MemberExpression') {
              return;
            }

            const member = inner.callee;

            if (member.computed || member.property.type !== 'Identifier') {
              return;
            }

            if (
              (outer.property.name === 'optional' && member.property.name === 'nullable') ||
              (outer.property.name === 'nullable' && member.property.name === 'optional')
            ) {
              context.report({
                node,
                message: 'Use .nullish() instead of chaining .nullable() and .optional().',
              });
            }
          },
        };
      },
    },
  },
});
