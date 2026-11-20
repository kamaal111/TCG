export default {
  meta: { name: 'tcg' },
  rules: {
    'no-default-parameters': {
      meta: { type: 'problem' },
      create(context) {
        function checkPattern(pattern) {
          switch (pattern.type) {
            case 'AssignmentPattern':
              context.report({ node: pattern.right, message: 'Pass this argument explicitly.' });
              checkPattern(pattern.left);
              break;
            case 'ObjectPattern':
              for (const property of pattern.properties) {
                if (property.type === 'Property') {
                  checkPattern(property.value);
                }
              }

              break;
            case 'ArrayPattern':
              for (const element of pattern.elements) {
                if (element != null) {
                  checkPattern(element);
                }
              }

              break;
            case 'RestElement':
              checkPattern(pattern.argument);
              break;
            case 'TSParameterProperty':
              checkPattern(pattern.parameter);
              break;
          }
        }

        function checkParameters(node) {
          node.params.forEach(checkPattern);
        }

        return {
          ArrowFunctionExpression: checkParameters,
          FunctionDeclaration: checkParameters,
          FunctionExpression: checkParameters,
        };
      },
    },
  },
};
