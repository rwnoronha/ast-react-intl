import { NodePath } from "@babel/traverse";
import { API, Expression, FileInfo, ImportDeclaration, JSCodeshift, JSXAttribute, JSXElement, JSXExpressionContainer, JSXText, Options, Property } from "jscodeshift";
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
  hasI18nUsage = translatePropObjects(j, root) || hasI18nUsage;

  if (hasI18nUsage) {
    addI18nImport(j, root);
    return root.toSource(printOptions);
  }
}

const isWhitespace = (str: string) => str.trim().length === 0
const collapseInternalSpace = (str: string) => str.replace(/\s+/g, ' ')

const hasObjectExpression = (container: JSXExpressionContainer) => {
  return container && 
    container.value &&
    container.value.expression && 
    container.value.expression.type === "ObjectExpression";
}

const canHandlePropName = (name: String) => {
  const localizationPropNames = [ /defaultMessage/, /description/, /values/ ];
  const infraPropNames = [ /style/, /href/, /type/, /test/i, /textContentType/ ];
  const ignorePropNames = [...localizationPropNames, ...infraPropNames]
  if(ignorePropNames.some(r => r.test(name))) {
     return false;
  }
  
  return true;
}

const canHandleAttribute = (attr: JSXAttribute) => {
  if(!canHandlePropName(attr.value.name.name)) {
     return false;
  }
  
  // Support for JSX expressions isn't in yet
  if(attr && attr.value && attr.value.value && attr.value.value.type === "JSXExpressionContainer") {
    return false;
  }
  
  return true;
}

const looksLikeTextString = (str: string) => {
  if(!str || !str.trim) {
    return false;
  }
  const trimmed = str.trim();
  // Stuff that contains spaces is usually something that needs to be translated
  if(/ /.test(trimmed)) {
    return true;
  }

  // If it's all lower case it probably shouldn't be translated
  if(/^[a-z]+$/.test(trimmed)) {
    return false;
  }

  // If it's camel case (has a lower case letter followed by an upper case letter), same
  if(/[a-z][A-Z]/.test(trimmed)) {
    return false;
  }
  return false;
}

const looksLikeTextPropName = (name: string) => {
  if(!name || !name.trim) {
    return false;
  }
  
  const trimmed = name.trim();
  const usuallyTextPropNames = [ /placeholder/, /text/, /message/, /cta/i, /msg/i ];
  if(usuallyTextPropNames.some((regex) => regex.test(trimmed))) {
    return true;
 }

 return false;
}

const looksLikeText = (propName: string, propValue: string) => {
  if (looksLikeTextPropName(propName)) {
    return true;
  }

  if(looksLikeTextString(propValue)) {
    return true;
  }
  
  return false;
}

const attributeLooksLikeText = (attr: JSXAttribute) => {
  if(!attr || !attr.value || !attr.value.name.name || !attr.value.value) {
    return false;
  }
  return looksLikeText(attr.value.name.name, attr.value.value.value);
}

const generateArgName = (expression: Expression, idx: number): string => {
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

function generateFormattedMessage(j: JSCodeshift, text: string, values: Property[]) {
  const formatAttributes = [j.jsxAttribute(j.jsxIdentifier("defaultMessage"),
                                           j.literal(text))];
  if (values && values.length) {
    formatAttributes.push(j.jsxAttribute(j.jsxIdentifier("values"), 
                                         j.jsxExpressionContainer(
      										j.objectExpression(values))));
  }

  return j.jsxElement(
    j.jsxOpeningElement(j.jsxIdentifier("FormattedMessage"),
                              formatAttributes));
}

function generateIntlCall(j: JSCodeshift, text: string, values: Property[]) {
  const intlCallParams = [];
  intlCallParams.push(
    j.objectExpression([
      j.property("init", j.identifier("defaultMessage"), j.literal(text)),
      j.property("init", j.identifier("description"), j.literal("DESCRIBE_ABOVE_TEXT_HERE"))
    ])
  );
  if(values && values.length) {
  	intlCallParams.push(j.objectExpression(values));
  }
  return j.callExpression(
    	j.memberExpression(
                j.identifier("intl"),
                j.identifier("formatMessage"),
                false
              ),
              
              intlCallParams
            );
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
	    path.parent.node.children = [j.jsxExpressionContainer(generateIntlCall(j, newText, newValues))];
      });
  return usedTranslation;
}

function translateJsxAttributes(j: JSCodeshift, root: Collection<any>) {
  let usedTranslation = false;
  root.find(j.JSXAttribute)
  		.filter((path: JSXAttribute) => canHandleAttribute(path) && attributeLooksLikeText(path))
  		.forEach((path: JSXAttribute) => {
    	  const [text, params] = getTextWithPlaceholders(j, [path.value.value]);
          if ((text || "").trim().length === 0) {
            return;
          }
    	  
    	  usedTranslation = true;
    	  const callExpression = j.jsxExpressionContainer(generateIntlCall(j, text, params))
              
    	  path.value.value = callExpression;
  		})
  
  return usedTranslation;
  
}

function translatePropObjects(j: JSCodeshift, root: Collection<any>) {
  let usedTranslation = false;
  root.find(j.JSXAttribute)
  		.filter((path: JSXAttribute) => hasObjectExpression(path.value))
  		.forEach((path: JSXAttribute) => {
    	  const props = path.value.value.expression.properties;
    	  for(let i = 0; i < props.length; i++) {
            if(!canHandlePropName(props[i].key.name)) {
              continue;
            }

            if(!looksLikeText(props[i].key.name, props[i].value.value)) {
              continue;
            }
            
            const [text, params] = getTextWithPlaceholders(j, [props[i].value]);
            if ((text || "").trim().length === 0) {
              continue;
            }
            usedTranslation = true;
            const callExpression = generateIntlCall(j, text, params)
            props[i].value = callExpression;
            
          }
  		})
  
  return usedTranslation;
  
}

module.exports = transform;
module.exports.parser = 'tsx';