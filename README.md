# AST react-intl

The objective of this tool is to make easy to migrate an existing codebase to use react-intl. It's based on [ast-i18n](https://github.com/sibelius/ast-i18n), which does the same thing for i18n. 

## Usage of this codemod
```bash
npm i -g jscodeshift

jscodeshift -t src/i18nTransformerCodemod.ts PATH_TO_FILES
```