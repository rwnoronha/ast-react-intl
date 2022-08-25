import { NodePath } from "@babel/traverse";
import { API, FileInfo, ImportDeclaration, JSCodeshift, JSXAttribute, JSXElement, JSXExpressionContainer, JSXText, Options, Property } from "jscodeshift";
import { Collection } from "jscodeshift/src/Collection";

const getImportStatement = () => {
  return `import { FormattedMessage, useIntl, injectIntl } from 'react-intl'`;
};

const addI18nImport = (j: JSCodeshift, root: Collection<any>) => {
  const statement = getImportStatement();

  const reactIntlImports = root
    .find(j.ImportDeclaration)
    .filter((path : NodePath<ImportDeclaration>) => path.node.source.value === 'react-intl');

  if (reactIntlImports.length > 0) {
    return;
  }

  const imports = root.find(j.ImportDeclaration);

  if(imports.length > 0){
     j(imports.at(imports.length-1).get()).insertAfter(statement); // after the imports
  }else{
     root.get().node.program.body.unshift(statement); // beginning of file
  }
};

function transform(file: FileInfo, api: API, options: Options) {
  const j = api.jscodeshift; // alias the jscodeshift API
  if (file.path.endsWith('.spec.js') || file.path.endsWith('.test.js')) {
    return;
  }
  const root = j(file.source); // parse JS code into an AST

  const printOptions = options.printOptions || {
    quote: 'single',
    trailingComma: false,
    lineTerminator: '\n'
  };

  let hasI18nUsage = false;

  hasI18nUsage = translateJsxAttributes(j, root) || hasI18nUsage;
  hasI18nUsage = translateJsxContent(j, root) || hasI18nUsage;

  if (hasI18nUsage) {
    addI18nImport(j, root);
    return root.toSource(printOptions);
  }
}

const isWhitespace = (str: string) => str.trim().length === 0
const collapseInternalSpace = (str: string) => str.replace(/\s+/g, ' ')

const canHandleAttribute = (attr: JSXAttribute) => {
  const localizationPropNames = [ /defaultMessage/, /description/, /values/ ];
  const infraPropNames = [ /style/, /href/, /type/ ];
  const ignorePropNames = [...localizationPropNames, ...infraPropNames]
  if(ignorePropNames.some(r => r.test(attr.value.name.name))) {
     return false;
  }
  
  // Support for JSX expressions isn't in yet
  if(attr?.value?.value?.type === "JSXExpressionContainer") {
    return false;
  }
  
  return true;
}
const looksLikeText = (attr: JSXAttribute) => {
  const usuallyTextPropNames = [ /placeholder/, /text/, /message/ ];
  if(usuallyTextPropNames.some((regex) => regex.test(attr.value.name.name))) {
     return true;
  }
  
  // Stuff that contains spaces is usually something that needs to be translated
  if(attr.value && attr.value.value && / /.test(attr.value.value)) {
    return true;
  }
  
  return false;
}

const generateArgName = (expression: JSXExpressionContainer, idx: number): string => {
  if(expression.type === "Identifier") {
    return expression.name;
  } else if (expression.type === "MemberExpression") {
    return generateArgName(expression.property, idx);
  } else {
    return `arg${idx}`;
  }
}

const generateTagName = (element: JSXElement, idx: number): string => {
  if(element && element.openingElement && element.openingElement.name.name) {
    return element.openingElement.name.name + idx;
  }
  
  return `tag${idx}`;
}

const generateArgProps = (j: JSCodeshift, expression: JSXExpressionContainer, argName: string): Property => {
  return j.property("init", j.literal(argName), expression)
}

const generateTagProps = (j: JSCodeshift, element: JSXElement, tagName: string): Property => {
  const arrowFn = j.arrowFunctionExpression([j.identifier("chunks")], 
                                            j.jsxElement(element.openingElement,
                                                         element.closingElement,
                                                         [j.jsxExpressionContainer(j.identifier("chunks"))]),
                                           false)
                                                         
  return j.property("init", j.literal(tagName), arrowFn)
}

const getTextWithPlaceholders = (j: JSCodeshift, children: any[]): [string, Property[]] => {
  const text: string[] = [];
  const properties: Property[] = [];
  children.forEach((child, idx) => {
    if(child.type === "JSXText" || child.type === "StringLiteral") {
      text.push(child.value);
    } else if (child.type === "JSXExpressionContainer") {
      const argName = generateArgName(child.expression, idx);
      const placeholderProps = generateArgProps(j, child.expression, argName);
      text.push(`{${argName}}`);
      properties.push(placeholderProps);
    } else if (child.type === "JSXElement") {
      const tagName = generateTagName(child, idx);
      const tagProps = generateTagProps(j, child, tagName);
      const [childText, moreProps] = getTextWithPlaceholders(j, child.children);
      text.push(`<${tagName}>${childText}</${tagName}>`);
      properties.push(tagProps);
      properties.push.apply(properties, moreProps);
    }
  });
  return [collapseInternalSpace(text.join('')).trim(), properties]
  
}

//<span>test</span>
function translateJsxContent(j: JSCodeshift, root: Collection<any>) {
  let usedTranslation = false;
    root.find(j.JSXText)
      .filter((path: JSXText) => !isWhitespace(path.value.value))
      .forEach((path: JSXText) => {
        usedTranslation = true;
        const oldChildren = path.parent.node.children;
        const [newText, newValues] = getTextWithPlaceholders(j, oldChildren);
        const formatAttributes = [j.jsxAttribute(j.jsxIdentifier("defaultMessage"),
                                                  j.literal(newText))];
        if (newValues.length) {
            formatAttributes.push(j.jsxAttribute(j.jsxIdentifier("values"), 
                                                j.jsxExpressionContainer(
              j.objectExpression(newValues))));
          }

        path.parent.node.children = [j.jsxElement(
              j.jsxOpeningElement(j.jsxIdentifier("FormattedMessage"),
                              formatAttributes))];
      });
  return usedTranslation;
}

function translateJsxAttributes(j: JSCodeshift, root: Collection<any>) {
  let usedTranslation = false;
  root.find(j.JSXAttribute)
  		.filter((path: JSXAttribute) => canHandleAttribute(path) && looksLikeText(path))
  		.forEach((path: JSXAttribute) => {
    	  const [text, params] = getTextWithPlaceholders(j, [path.value.value]);
          if ((text || "").trim().length === 0) {
            return;
          }
    		usedTranslation = true;
    	  const callExpression = j.jsxExpressionContainer(
            j.callExpression(
              j.memberExpression(
                j.identifier("intl"),
                j.identifier("formatMessage"),
                false
              ),
              
              [j.objectExpression([
                j.property("init", j.identifier("defaultMessage"), j.literal(text))
              ])]
            )
          )
              
    	  path.value.value = callExpression;
  		})
  
  return usedTranslation;
  
}

module.exports = transform;
module.exports.parser = 'tsx';