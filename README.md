# AST react-intl

The objective of this tool is to make easy to migrate an existing codebase to use react-intl. It's based on [ast-i18n](https://github.com/sibelius/ast-i18n), which does the same thing for i18n. 

Primarily developed using AST explorer here: https://astexplorer.net/#/gist/8331e3fcd271b8977c9e189e59a9b93f/9f2fda7a8bb6a151601a64c0e6146ea29cfaaac3 - you can just copy the content of the main transformer without imports and it'll work. 

## Usage of this codemod
```bash
npm i -g jscodeshift

jscodeshift -t src/intlTransformerCodemod.ts PATH_TO_FILES
```