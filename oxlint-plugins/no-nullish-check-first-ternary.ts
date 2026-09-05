// Forbids `x == null ? a : b` style ternaries where the nullish branch comes first,
// in favor of `x != null ? b : a`, so the value-producing branch reads first.

interface LiteralNode {
  type: 'Literal';
  value: unknown;
}

interface IdentifierNode {
  type: 'Identifier';
  name: string;
}

type ExpressionNode = LiteralNode | IdentifierNode | { type: string };

interface BinaryExpressionNode {
  type: 'BinaryExpression';
  operator: string;
  left: ExpressionNode;
  right: ExpressionNode;
}

interface LogicalExpressionNode {
  type: 'LogicalExpression';
  operator: string;
  left: ExpressionNode;
  right: ExpressionNode;
}

interface ConditionalExpressionNode {
  type: 'ConditionalExpression';
  test: ExpressionNode;
  consequent: ExpressionNode;
  alternate: ExpressionNode;
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

const EQUALITY_OPERATORS: Record<string, string> = { '==': '!=', '===': '!==' };

function isNullish(node: ExpressionNode): boolean {
  return (
    (node.type === 'Literal' && (node as LiteralNode).value === null) ||
    (node.type === 'Identifier' && (node as IdentifierNode).name === 'undefined')
  );
}

function isNullishEqualityCheck(node: ExpressionNode): node is BinaryExpressionNode {
  return (
    node.type === 'BinaryExpression' &&
    (node as BinaryExpressionNode).operator in EQUALITY_OPERATORS &&
    (isNullish((node as BinaryExpressionNode).left) || isNullish((node as BinaryExpressionNode).right))
  );
}

function isLogicalOr(node: ExpressionNode): node is LogicalExpressionNode {
  return node.type === 'LogicalExpression' && (node as LogicalExpressionNode).operator === '||';
}

function flattenOrOperands(node: ExpressionNode): ExpressionNode[] {
  if (!isLogicalOr(node)) return [node];
  return [...flattenOrOperands(node.left), ...flattenOrOperands(node.right)];
}

export default {
  meta: { name: 'local-ternary' },
  rules: {
    'no-nullish-check-first-ternary': {
      meta: { fixable: 'code' },
      create(context: RuleContext) {
        return {
          ConditionalExpression(node: ConditionalExpressionNode) {
            const operands = flattenOrOperands(node.test);
            if (!operands.every(isNullishEqualityCheck)) return;
            const checks: BinaryExpressionNode[] = operands as BinaryExpressionNode[];

            if (!isNullish(node.consequent)) return;

            context.report({
              node,
              message:
                'Put the value-producing branch first: use `!= null`/`!== null`/`!== undefined` (joined with `&&` for multiple checks) and swap the branches instead of checking nullish first.',
              fix(fixer) {
                const flippedTest = checks
                  .map(check => {
                    const leftText = context.sourceCode.getText(check.left);
                    const rightText = context.sourceCode.getText(check.right);
                    return `${leftText} ${EQUALITY_OPERATORS[check.operator]} ${rightText}`;
                  })
                  .join(' && ');
                const consequentText = context.sourceCode.getText(node.consequent);
                const alternateText = context.sourceCode.getText(node.alternate);
                return fixer.replaceText(node, `${flippedTest} ? ${alternateText} : ${consequentText}`);
              },
            });
          },
        };
      },
    },
  },
};
