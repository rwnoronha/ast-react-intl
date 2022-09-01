# AST react-intl

The objective of this tool is to make easy to migrate an existing codebase to use react-intl. It's based on [ast-i18n](https://github.com/sibelius/ast-i18n), which does the same thing for i18n. 

Note that at this point you will have to inject the `intl` object yourself, whether it's through `injectIntl` or `useIntl`. 

Primarily developed using AST explorer here: https://astexplorer.net/#/gist/8331e3fcd271b8977c9e189e59a9b93f/9f2fda7a8bb6a151601a64c0e6146ea29cfaaac3 - you can just copy the content of the main transformer without imports and it'll work. 

## Usage of this codemod
```bash
npm i -g jscodeshift

jscodeshift -t src/intlTransformerCodemod.ts PATH_TO_FILES
```

For things that this codemod misses, you can use this VS Code snippet: 

```
	"Wrap with Intl": {
        "prefix": "intl",
		"scope": "javascript,typescript,typescriptreact,javascriptreact",
        "body": [
            "intl.formatMessage({",
            "\t\t  defaultMessage: $TM_SELECTED_TEXT,",
            "\t\t  description: '$0${1:DESCRIBE_ABOVE_TEXT_HERE}'",
            "\t\t})"
        ],
        "description": "Wraps a string with intl"
    }
```

Usage: 
* Open the command palette to Configure User Snippets
* Make a new global Snippets file, or use your existing file if you have one
* Copy and paste this snippet into your global snippets file
* Select the full string you want to wrap with Intl - including quotes
* Open the command palette, select "Insert Snippet", and pick the intl snippet
* Alternatively, hit ctrl-space and select the intl snippet
