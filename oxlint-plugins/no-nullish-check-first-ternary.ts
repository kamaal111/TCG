interface AstNode {
  type: string;
}

interface LiteralNode extends AstNode {
  type: 'Literal';
  value: null;
}

interface IdentifierNode extends AstNode {
  type: 'Identifier';
  name: 'undefined';
}

type ExpressionNode = LiteralNode | IdentifierNode | BinaryExpressionNode | LogicalExpressionNode | AstNode;

interface BinaryExpressionNode extends AstNode {
  type: 'BinaryExpression';
  operator: '==' | '===';
  left: ExpressionNode;
  right: ExpressionNode;
}

interface LogicalExpressionNode extends AstNode {
  type: 'LogicalExpression';
  operator: '||';
  left: ExpressionNode;
  right: ExpressionNode;
}

interface ConditionalExpressionNode extends AstNode {
  type: 'ConditionalExpression';
  test: ExpressionNode;
  consequent: ExpressionNode;
  alternate: ExpressionNode;
}

interface RuleFixer {
  replaceText(node: AstNode, text: string): AstNode;
}

interface SourceCode {
  getText(node: AstNode): string;
}

interface RuleContext {
  sourceCode: SourceCode;
  report(descriptor: { node: AstNode; message: string; fix?: (fixer: RuleFixer) => AstNode }): void;
}

const EQUALITY_OPERATORS = { '==': '!=', '===': '!==' } as const;

function isNullish(node: ExpressionNode): node is LiteralNode | IdentifierNode {
  return (
    (node.type === 'Literal' && 'value' in node && node.value === null) ||
    (node.type === 'Identifier' && 'name' in node && node.name === 'undefined')
  );
}

function isNullishEqualityCheck(node: ExpressionNode): node is BinaryExpressionNode {
  return (
    node.type === 'BinaryExpression' &&
    'left' in node &&
    'right' in node &&
    (isNullish(node.left) || isNullish(node.right))
  );
}

function flattenOrOperands(node: ExpressionNode): ExpressionNode[] {
  if (node.type !== 'LogicalExpression' || !('left' in node && 'right' in node)) {
    return [node];
  }

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
            const checks = flattenOrOperands(node.test);

            if (!checks.every(isNullishEqualityCheck) || !isNullish(node.consequent)) {
              return;
            }

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
