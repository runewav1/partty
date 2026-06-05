/**
 * Configuration, data, and markup file extensions to icon mapping.
 */

export const CONFIG_DATA_EXTENSIONS: Map<string, string> = new Map([
  // Config files
  ["json", "json"],
  ["jsonc", "json"],
  ["json5", "json"],
  ["json_schema", "json"],
  ["xml", "xml"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["toml", "toml"],
  ["ini", "settings"],
  ["cfg", "settings"],
  ["conf", "settings"],
  ["env", "tune"],
  ["dotenv", "tune"],
  ["properties", "settings"],
  ["prefs", "settings"],
  ["config", "settings"],
  ["rc", "settings"],
  
  // Data formats
  ["csv", "table"],
  ["tsv", "table"],
  ["tab", "table"],
  ["rdf", "rdf"],
  ["owl", "rdf"],
  ["turtle", "rdf"],
  ["nt", "rdf"],
  ["n3", "rdf"],
  ["ttl", "rdf"],
  ["trig", "rdf"],
  ["nquads", "rdf"],
  ["nq", "rdf"],
  ["jsonld", "json"],
  ["json-ld", "json"],
  ["ld", "json"],
  ["hjson", "hjson"],
  ["cson", "settings"],
  ["bson", "json"],
  ["msgpack", "database"],
  ["cbor", "database"],
  ["ubjson", "database"],
  ["smile", "database"],
  ["avro", "database"],
  ["parquet", "database"],
  ["orc", "database"],
  ["arrow", "database"],
  ["feather", "database"],
  ["fst", "database"],
  
  // Markup
  ["md", "markdown"],
  ["markdown", "markdown"],
  ["mdown", "markdown"],
  ["mkdn", "markdown"],
  ["mkd", "markdown"],
  ["mdwn", "markdown"],
  ["mdtxt", "markdown"],
  ["mdtext", "markdown"],
  ["mdx", "markdown"],
  ["rst", "text"],
  ["adoc", "asciidoc"],
  ["asciidoc", "asciidoc"],
  ["doctree", "text"],
  
  // Database
  ["sql", "database"],
  ["db", "database"],
  ["sqlite", "database"],
  ["sqlite3", "database"],
  ["db3", "database"],
  ["mdb", "database"],
  ["accdb", "database"],
  ["proto", "proto"],
  ["graphql", "graphql"],
  ["gql", "graphql"],
  ["graphqls", "graphql"],
  ["prisma", "prisma"],
  
  // Lock files
  ["lock", "lock"],
  ["lockfile", "lock"],
  
  // Key/certificate
  ["key", "key"],
  ["pem", "key"],
  ["crt", "key"],
  ["cer", "key"],
  ["der", "key"],
  ["p12", "key"],
  ["pfx", "key"],
  ["p7b", "key"],
  ["p7c", "key"],
  
  // Auth/credentials
  ["auth", "key"],
  ["credentials", "key"],
  ["secrets", "key"],
  
  // Logs
  ["log", "log"],
  
  // URL
  ["url", "url"],
  
  // Label
  ["label", "label"],
  
  // Installation
  ["installation", "installation"],
  
  // Authors
  ["authors", "authors"],
  
  // License
  ["license", "license"],
  ["licence", "license"],
  ["unlicense", "unlicense"],
  
  // Readme
  ["readme", "readme"],
  ["readme.md", "readme"],
  ["readme.txt", "readme"],
  ["readme.rst", "readme"],
  
  // Changelog
  ["changelog", "changelog"],
  ["changelog.md", "changelog"],
  ["changes", "changelog"],
  ["history", "changelog"],
  
  // Contributing
  ["contributing", "text"],
  ["contributing.md", "text"],
  
  // Todo
  ["todo", "todo"],
  ["todo.md", "todo"],
  
  // Roadmap
  ["roadmap", "roadmap"],
  ["roadmap.md", "roadmap"],
  
  // ToC
  ["toc", "toc"],
  ["toc.md", "toc"],
  
  // Trigger
  ["trigger", "trigger"],
  
  // Tune
  ["tune", "tune"],
  
  // Hosts
  ["hosts", "hosts"],
  
  // Regedit
  ["reg", "regedit"],
  
  // Search
  ["search", "search"],
  
  // Settings
  ["settings", "settings"],
  
  // Prompt
  ["prompt", "prompt"],
  
  // Palette
  ["palette", "palette"],
  
  // Pipeline
  ["pipeline", "pipeline"],
  
  // Routing
  ["routing", "routing"],
  
  // Pkl
  ["pkl", "pkl"],
  
  // HCL
  ["hcl", "hcl"],
  ["tf", "terraform"],
  ["nomad", "nomad"],
  ["consul", "consul"],
  
  // Docker
  ["dockerfile", "docker"],
  ["docker-compose.yml", "docker"],
  ["docker-compose.yaml", "docker"],
  ["docker-compose.override.yml", "docker"],
  ["docker-compose.override.yaml", "docker"],
  ["docker-compose.prod.yml", "docker"],
  ["docker-compose.prod.yaml", "docker"],
  ["docker-compose.dev.yml", "docker"],
  ["docker-compose.dev.yaml", "docker"],
  ["docker-compose.test.yml", "docker"],
  ["docker-compose.test.yaml", "docker"],
  [".dockerignore", "docker"],
  ["dockerignore", "docker"],
  ["containerfile", "docker"],
  
  // Kubernetes
  ["k8s.yaml", "kubernetes"],
  ["k8s.yml", "kubernetes"],
  ["k8s.json", "kubernetes"],
  ["kustomization", "kubernetes"],
  ["kustomization.yaml", "kubernetes"],
  ["kustomization.yml", "kubernetes"],
  
  // Helm
  ["chart.yaml", "helm"],
  ["values.yaml", "helm"],
  ["values.yml", "helm"],
  ["values.schema.json", "helm"],
  ["requirements.yaml", "helm"],
  ["requirements.yml", "helm"],
  [".helmignore", "helm"],
  
  // Terraform
  ["terraform.tfvars", "terraform"],
  ["terraform.tfvars.json", "terraform"],
  ["terraform.tfstate", "terraform"],
  ["terraform.tfstate.backup", "terraform"],
  ["terraform.tfstate.json", "terraform"],
  ["terraform.tfstate.json.backup", "terraform"],
  ["terragrunt", "terraform"],
  ["terragrunt.hcl", "terraform"],
  ["terragrunt.hcl.json", "terraform"],
  
  // Ansible
  ["ansible.cfg", "ansible"],
  ["ansible-playbook.yml", "ansible"],
  ["ansible-playbook.yaml", "ansible"],
  ["playbook.yml", "ansible"],
  ["playbook.yaml", "ansible"],
  ["inventory", "ansible"],
  ["hosts", "ansible"],
  ["galaxy", "ansible"],
  ["requirements.yml", "ansible"],
  ["requirements.yaml", "ansible"],
  ["vault.yml", "ansible"],
  ["vault.yaml", "ansible"],
  
  // Chef
  ["berksfile", "chef"],
  ["berksfile.lock", "chef"],
  ["chefignore", "chef"],
  ["kitchen.yml", "chef"],
  ["kitchen.yaml", "chef"],
  
  // Puppet
  ["puppetfile", "puppet"],
  ["puppetfile.lock", "puppet"],
  ["hiera.yaml", "puppet"],
  ["hiera.yml", "puppet"],
  
  // Salt
  ["salt.sls", "salt"],
  ["saltstack", "salt"],
  ["cloud", "salt"],
  ["cloud.init", "salt"],
  ["cloud-config", "salt"],
  ["cloud-init", "salt"],
  
  // Vagrant
  ["vagrantfile", "vagrant"],
  
  // Packer
  ["packer.json", "packer"],
  ["packer.hcl", "packer"],
  ["packer.auto.pkrvars.hcl", "packer"],
  ["packer.auto.pkrvars.json", "packer"],
  
  // Serverless
  ["serverless.yml", "serverless"],
  ["serverless.yaml", "serverless"],
  ["serverless.js", "serverless"],
  ["serverless.ts", "serverless"],
  ["serverless.json", "serverless"],
  ["serverless.cjs", "serverless"],
  ["serverless.mjs", "serverless"],
  ["serverless.cts", "serverless"],
  ["serverless.mts", "serverless"],
  
  // Netlify
  ["netlify.toml", "netlify"],
  ["netlify.yml", "netlify"],
  ["netlify.yaml", "netlify"],
  
  // Vercel
  ["vercel.json", "vercel"],
  ["now.json", "vercel"],
  ["now.yml", "vercel"],
  ["now.yaml", "vercel"],
  
  // Firebase
  ["firebase.json", "firebase"],
  ["firebaserc", "firebase"],
  [".firebaserc", "firebase"],
  ["firestore.rules", "firebase"],
  ["firestore.indexes.json", "firebase"],
  ["storage.rules", "firebase"],
  ["database.rules.json", "firebase"],
  ["remoteconfig.template.json", "firebase"],
  
  // Azure
  ["azure-pipelines.yml", "azure-pipelines"],
  ["azure-pipelines.yaml", "azure-pipelines"],
  
  // GCP
  ["cloudbuild.yaml", "gcp"],
  ["cloudbuild.yml", "gcp"],
  ["cloudbuild.json", "gcp"],
  ["app.yaml", "gcp"],
  ["app.yml", "gcp"],
  ["appengine", "gcp"],
  ["cloudfunctions", "gcp"],
  ["cloudrun", "gcp"],
  
  // Heroku
  ["heroku.yml", "heroku"],
  ["heroku.yaml", "heroku"],
  ["procfile", "heroku"],
  ["procfile.windows", "heroku"],
  
  // Render
  ["render.yaml", "render"],
  ["render.yml", "render"],
  
  // Railway
  ["railway.json", "railway"],
  ["railway.toml", "railway"],
  
  // Fly
  ["fly.toml", "fly"],
  
  // Deno
  ["deno.json", "deno"],
  ["deno.jsonc", "deno"],
  ["deno.lock", "deno"],
  ["import_map.json", "deno"],
  ["import_map.jsonc", "deno"],
  
  // Bun
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["bunfig.toml", "bun"],
  
  // Turbo
  ["turbo.json", "turborepo"],
  
  // NX
  ["nx.json", "nx"],
  ["workspace.json", "nx"],
  ["project.json", "nx"],
  
  // Lerna
  ["lerna.json", "lerna"],
  ["lerna.yaml", "lerna"],
  ["lerna.yml", "lerna"],
  
  // Rush
  ["rush.json", "rush"],
  ["rush-stack", "rush"],
  ["rushstack", "rush"],
  ["common", "rush"],
  ["config", "rush"],
  
  // pnpm workspace
  ["pnpm-workspace.yaml", "pnpm"],
  ["pnpm-workspace.yml", "pnpm"],
  
  // Yarn workspace
  ["yarn-workspace.yaml", "yarn"],
  ["yarn-workspace.yml", "yarn"],
  ["yarn.lock", "yarn"],
  ["yarnrc", "yarn"],
  [".yarnrc", "yarn"],
  [".yarnrc.yml", "yarn"],
  [".yarnrc.yaml", "yarn"],
  ["yarnrc.yml", "yarn"],
  ["yarnrc.yaml", "yarn"],
  ["yarn-path", "yarn"],
  [".yarn-path", "yarn"],
  ["yarn-path.txt", "yarn"],
  [".yarn-path.txt", "yarn"],
  ["yarn-integrity", "yarn"],
  [".yarn-integrity", "yarn"],
  ["yarn-unplugged", "yarn"],
  [".yarn-unplugged", "yarn"],
  ["yarn-state", "yarn"],
  [".yarn-state", "yarn"],
  
  // Git
  [".git", "folder-git"],
  [".gitignore", "git"],
  [".gitattributes", "git"],
  [".gitmodules", "git"],
  [".gitkeep", "git"],
  [".gitconfig", "git"],
  [".git-credentials", "git"],
  [".git-credential-cache", "git"],
  [".git-credential-store", "git"],
  [".git-credential-osxkeychain", "git"],
  [".git-credential-manager", "git"],
  
  // GitLab
  [".gitlab-ci.yml", "gitlab"],
  [".gitlab-ci.yaml", "gitlab"],
  
  // Mercurial
  [".hg", "mercurial"],
  [".hgignore", "mercurial"],
  
  // SVN
  [".svn", "svn"],
  
  // Bazaar
  [".bzr", "bazaar"],
  [".bzrignore", "bazaar"],
  
  // CVS
  [".cvsignore", "cvs"],
  ["CVS", "cvs"],
  
  // Package managers
  ["package.json", "nodejs"],
  ["package-lock.json", "nodejs"],
  ["yarn.lock", "yarn"],
  ["pnpm-lock.yaml", "pnpm"],
  ["composer.json", "php"],
  ["composer.lock", "php"],
  ["Gemfile", "ruby"],
  ["Gemfile.lock", "ruby"],
  ["go.mod", "go"],
  ["go.sum", "go"],
  ["go.work", "go"],
  ["go.work.sum", "go"],
  ["Cargo.toml", "rust"],
  ["Cargo.lock", "rust"],
  ["requirements.txt", "python"],
  ["requirements.pip", "python"],
  ["setup.py", "python"],
  ["setup.cfg", "python"],
  ["pyproject.toml", "python"],
  ["poetry.lock", "python"],
  ["Pipfile", "python"],
  ["Pipfile.lock", "python"],
  ["environment.yml", "python"],
  ["environment.yaml", "python"],
  ["environment.yml.lock", "python"],
  ["environment.yaml.lock", "python"],
  ["conda-lock", "python"],
  ["conda-lock.yml", "python"],
  ["conda-lock.yaml", "python"],
  ["conda-lock.json", "python"],
  ["pixi.toml", "python"],
  ["pixi.lock", "python"],
  
  // Build tools
  ["gradle", "gradle"],
  ["gradle.properties", "gradle"],
  ["settings.gradle", "gradle"],
  ["settings.gradle.kts", "kotlin"],
  ["build.gradle", "gradle"],
  ["build.gradle.kts", "kotlin"],
  ["maven", "maven"],
  ["pom.xml", "maven"],
  ["ivy.xml", "maven"],
  ["sbt", "scala"],
  ["build.sbt", "scala"],
  ["project", "scala"],
  ["project.properties", "scala"],
  ["leiningen", "clojure"],
  ["project.clj", "clojure"],
  ["deps.edn", "clojure"],
  ["shadow-cljs", "clojure"],
  ["build.boot", "clojure"],
  ["mix.exs", "elixir"],
  ["rebar.config", "erlang"],
  ["rebar.lock", "erlang"],
  ["rebar3", "erlang"],
  ["erlang.mk", "erlang"],
  ["emakefile", "erlang"],
  ["emakefile.lock", "erlang"],
  ["app.src", "erlang"],
  ["rel", "erlang"],
  ["relx.config", "erlang"],
  ["sys.config", "erlang"],
  ["vm.args", "erlang"],
  ["appup.src", "erlang"],
  ["appup", "erlang"],
  ["relup", "erlang"],
  ["script", "erlang"],
  ["escript", "erlang"],
  ["default.nix", "nix"],
  ["shell.nix", "nix"],
  ["flake.nix", "nix"],
  ["flake.lock", "nix"],
  ["cabal.project", "haskell"],
  ["cabal.file", "haskell"],
  ["stack.yaml", "haskell"],
  ["stack.yml", "haskell"],
  ["package.yaml", "haskell"],
  ["hpack", "haskell"],
  ["hpack.yaml", "haskell"],
  ["hpack.yml", "haskell"],
  ["rust-toolchain", "rust"],
  ["rust-toolchain.toml", "rust"],
  ["rustfmt", "rust"],
  ["rustfmt.toml", "rust"],
  ["clippy", "rust"],
  ["clippy.toml", "rust"],
  ["gopls", "go"],
  ["gopls.mod", "go"],
  
  // Linters/Formaters
  ["eslint", "eslint"],
  [".eslintrc", "eslint"],
  [".eslintrc.js", "eslint"],
  [".eslintrc.cjs", "eslint"],
  [".eslintrc.mjs", "eslint"],
  [".eslintrc.json", "eslint"],
  [".eslintrc.yaml", "eslint"],
  [".eslintrc.yml", "eslint"],
  [".eslintrc.toml", "eslint"],
  ["eslint.config.js", "eslint"],
  ["eslint.config.cjs", "eslint"],
  ["eslint.config.mjs", "eslint"],
  ["eslint.config.json", "eslint"],
  ["eslint.config.yaml", "eslint"],
  ["eslint.config.yml", "eslint"],
  ["eslint.config.toml", "eslint"],
  [".eslintignore", "eslint"],
  ["eslintignore", "eslint"],
  
  ["prettier", "prettier"],
  [".prettierrc", "prettier"],
  [".prettierrc.js", "prettier"],
  [".prettierrc.cjs", "prettier"],
  [".prettierrc.mjs", "prettier"],
  [".prettierrc.json", "prettier"],
  [".prettierrc.yaml", "prettier"],
  [".prettierrc.yml", "prettier"],
  [".prettierrc.toml", "prettier"],
  ["prettier.config.js", "prettier"],
  ["prettier.config.cjs", "prettier"],
  ["prettier.config.mjs", "prettier"],
  ["prettier.config.json", "prettier"],
  ["prettier.config.yaml", "prettier"],
  ["prettier.config.yml", "prettier"],
  ["prettier.config.toml", "prettier"],
  [".prettierignore", "prettier"],
  ["prettierignore", "prettier"],
  
  ["stylelint", "stylelint"],
  [".stylelintrc", "stylelint"],
  [".stylelintrc.js", "stylelint"],
  [".stylelintrc.cjs", "stylelint"],
  [".stylelintrc.mjs", "stylelint"],
  [".stylelintrc.json", "stylelint"],
  [".stylelintrc.yaml", "stylelint"],
  [".stylelintrc.yml", "stylelint"],
  [".stylelintrc.toml", "stylelint"],
  ["stylelint.config.js", "stylelint"],
  ["stylelint.config.cjs", "stylelint"],
  ["stylelint.config.mjs", "stylelint"],
  ["stylelint.config.json", "stylelint"],
  ["stylelint.config.yaml", "stylelint"],
  ["stylelint.config.yml", "stylelint"],
  ["stylelint.config.toml", "stylelint"],
  [".stylelintignore", "stylelint"],
  ["stylelintignore", "stylelint"],
  
  ["tailwind", "tailwindcss"],
  ["tailwind.config.js", "tailwindcss"],
  ["tailwind.config.cjs", "tailwindcss"],
  ["tailwind.config.mjs", "tailwindcss"],
  ["tailwind.config.ts", "tailwindcss"],
  ["tailwind.config.json", "tailwindcss"],
  
  ["postcss", "postcss"],
  ["postcss.config.js", "postcss"],
  ["postcss.config.cjs", "postcss"],
  ["postcss.config.mjs", "postcss"],
  ["postcss.config.ts", "postcss"],
  ["postcss.config.json", "postcss"],
  [".postcssrc", "postcss"],
  [".postcssrc.js", "postcss"],
  [".postcssrc.cjs", "postcss"],
  [".postcssrc.mjs", "postcss"],
  [".postcssrc.json", "postcss"],
  [".postcssrc.yaml", "postcss"],
  [".postcssrc.yml", "postcss"],
  [".postcssrc.toml", "postcss"],
  
  ["vite", "vite"],
  ["vite.config.js", "vite"],
  ["vite.config.cjs", "vite"],
  ["vite.config.mjs", "vite"],
  ["vite.config.ts", "vite"],
  ["vite.config.cts", "vite"],
  ["vite.config.mts", "vite"],
  
  ["webpack", "webpack"],
  ["webpack.config.js", "webpack"],
  ["webpack.config.cjs", "webpack"],
  ["webpack.config.mjs", "webpack"],
  ["webpack.config.ts", "webpack"],
  ["webpack.config.cts", "webpack"],
  ["webpack.config.mts", "webpack"],
  ["webpack.config.json", "webpack"],
  ["webpack.config.babel.js", "webpack"],
  ["webpack.config.base.js", "webpack"],
  ["webpack.config.common.js", "webpack"],
  ["webpack.config.dev.js", "webpack"],
  ["webpack.config.prod.js", "webpack"],
  ["webpack.config.production.js", "webpack"],
  ["webpack.config.server.js", "webpack"],
  ["webpack.config.test.js", "webpack"],
  
  ["rollup", "rollup"],
  ["rollup.config.js", "rollup"],
  ["rollup.config.cjs", "rollup"],
  ["rollup.config.mjs", "rollup"],
  ["rollup.config.ts", "rollup"],
  ["rollup.config.cts", "rollup"],
  ["rollup.config.mts", "rollup"],
  ["rollup.config.json", "rollup"],
  
  ["babel", "babel"],
  [".babelrc", "babel"],
  [".babelrc.js", "babel"],
  [".babelrc.cjs", "babel"],
  [".babelrc.mjs", "babel"],
  [".babelrc.json", "babel"],
  [".babelrc.yaml", "babel"],
  [".babelrc.yml", "babel"],
  [".babelignore", "babel"],
  ["babel.config.js", "babel"],
  ["babel.config.cjs", "babel"],
  ["babel.config.mjs", "babel"],
  ["babel.config.json", "babel"],
  ["babel.config.yaml", "babel"],
  ["babel.config.yml", "babel"],
  
  ["jest", "jest"],
  ["jest.config.js", "jest"],
  ["jest.config.cjs", "jest"],
  ["jest.config.mjs", "jest"],
  ["jest.config.ts", "jest"],
  ["jest.config.cts", "jest"],
  ["jest.config.mts", "jest"],
  ["jest.config.json", "jest"],
  ["jest.config.yaml", "jest"],
  ["jest.config.yml", "jest"],
  ["jest.config.toml", "jest"],
  [".jestrc", "jest"],
  [".jestrc.js", "jest"],
  [".jestrc.cjs", "jest"],
  [".jestrc.mjs", "jest"],
  [".jestrc.json", "jest"],
  [".jestrc.yaml", "jest"],
  [".jestrc.yml", "jest"],
  [".jestrc.toml", "jest"],
  
  ["vitest", "vitest"],
  ["vitest.config.js", "vitest"],
  ["vitest.config.cjs", "vitest"],
  ["vitest.config.mjs", "vitest"],
  ["vitest.config.ts", "vitest"],
  ["vitest.config.cts", "vitest"],
  ["vitest.config.mts", "vitest"],
  ["vitest.config.json", "vitest"],
  ["vitest.config.yaml", "vitest"],
  ["vitest.config.yml", "vitest"],
  ["vitest.config.toml", "vitest"],
  
  ["cypress", "cypress"],
  ["cypress.config.js", "cypress"],
  ["cypress.config.cjs", "cypress"],
  ["cypress.config.mjs", "cypress"],
  ["cypress.config.ts", "cypress"],
  ["cypress.config.cts", "cypress"],
  ["cypress.config.mts", "cypress"],
  ["cypress.config.json", "cypress"],
  ["cypress.config.yaml", "cypress"],
  ["cypress.config.yml", "cypress"],
  ["cypress.config.toml", "cypress"],
  
  ["playwright", "playwright"],
  ["playwright.config.js", "playwright"],
  ["playwright.config.cjs", "playwright"],
  ["playwright.config.mjs", "playwright"],
  ["playwright.config.ts", "playwright"],
  ["playwright.config.cts", "playwright"],
  ["playwright.config.mts", "playwright"],
  ["playwright.config.json", "playwright"],
  ["playwright.config.yaml", "playwright"],
  ["playwright.config.yml", "playwright"],
  ["playwright.config.toml", "playwright"],
  
  ["puppeteer", "puppeteer"],
  ["puppeteer.config.js", "puppeteer"],
  ["puppeteer.config.cjs", "puppeteer"],
  ["puppeteer.config.mjs", "puppeteer"],
  ["puppeteer.config.ts", "puppeteer"],
  ["puppeteer.config.cts", "puppeteer"],
  ["puppeteer.config.mts", "puppeteer"],
  ["puppeteer.config.json", "puppeteer"],
  ["puppeteer.config.yaml", "puppeteer"],
  ["puppeteer.config.yml", "puppeteer"],
  ["puppeteer.config.toml", "puppeteer"],
  
  // TypeScript specific
  ["tsconfig", "tsconfig"],
  ["tsconfig.json", "tsconfig"],
  ["tsconfig.base.json", "tsconfig"],
  ["tsconfig.build.json", "tsconfig"],
  ["tsconfig.common.json", "tsconfig"],
  ["tsconfig.dev.json", "tsconfig"],
  ["tsconfig.eslint.json", "tsconfig"],
  ["tsconfig.json", "tsconfig"],
  ["tsconfig.node.json", "tsconfig"],
  ["tsconfig.prod.json", "tsconfig"],
  ["tsconfig.spec.json", "tsconfig"],
  ["tsconfig.test.json", "tsconfig"],
  ["tsconfig.web.json", "tsconfig"],
  ["jsconfig", "jsconfig"],
  ["jsconfig.json", "jsconfig"],
  ["tsdoc", "tsdoc"],
  ["tsdoc.json", "tsdoc"],
  ["typedoc", "typedoc"],
  ["typedoc.json", "typedoc"],
  ["typedoc.yaml", "typedoc"],
  ["typedoc.yml", "typedoc"],
  ["typedoc.toml", "typedoc"],
  ["typedoc.cjs", "typedoc"],
  ["typedoc.mjs", "typedoc"],
  ["typedoc.js", "typedoc"],
  
  // Python tools
  ["ruff", "python"],
  ["ruff.toml", "python"],
  ["ruff.ini", "python"],
  ["pyrightconfig", "python"],
  ["pyrightconfig.json", "python"],
  ["mypy", "python"],
  ["mypy.ini", "python"],
  ["tox", "python"],
  ["tox.ini", "python"],
  ["pytest", "python"],
  ["pytest.ini", "python"],
  ["pylintrc", "python"],
  [".coveragerc", "python"],
  ["coveragerc", "python"],
  ["coverage.toml", "python"],
  ["coverage.json", "python"],
  ["black", "python"],
  ["black.toml", "python"],
  ["black.ini", "python"],
  ["isort", "python"],
  ["isort.ini", "python"],
  ["bandit", "python"],
  ["bandit.yaml", "python"],
  ["bandit.ini", "python"],
  ["flake8", "python"],
  [".flake8", "python"],
  ["pylint", "python"],
  [".pylintrc", "python"],
  ["pylintrc", "python"],
  ["pylint.ini", "python"],
  ["autoflake", "python"],
  [".autoflake", "python"],
  ["autopep8", "python"],
  [".autopep8", "python"],
  ["yapf", "python"],
  [".yapf", "python"],
  ["pycodestyle", "python"],
  [".pycodestyle", "python"],
  
  // Node
  [".npmrc", "npm"],
  [".npmignore", "npm"],
  ["npm", "npm"],
  ["nodemon", "nodemon"],
  ["nodemon.json", "nodemon"],
  ["nodemon.yml", "nodemon"],
  ["nodemon.yaml", "nodemon"],
  ["nodemon.toml", "nodemon"],
  [".nodemonignore", "nodemon"],
  ["nodemonignore", "nodemon"],
  ["nvm", "nodejs"],
  [".nvmrc", "nodejs"],
  ["node", "nodejs"],
]);
