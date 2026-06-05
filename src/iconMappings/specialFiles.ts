/**
 * Special file names (exact filename matches) to icon mapping.
 */

export const SPECIAL_FILENAMES: Map<string, string> = new Map([
  // Git
  ["dockerfile", "docker"],
  [".dockerignore", "docker"],
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
  
  // Docker
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
  ["containerfile", "docker"],
  
  // Node.js
  ["package.json", "nodejs"],
  ["package-lock.json", "nodejs"],
  ["yarn.lock", "yarn"],
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lockb", "nodejs"],
  ["bun.lock", "nodejs"],
  ["bunfig.toml", "bun"],
  [".npmrc", "npm"],
  [".npmignore", "npm"],
  ["nodemon.json", "nodemon"],
  ["nodemon.yml", "nodemon"],
  ["nodemon.yaml", "nodemon"],
  ["nodemon.toml", "nodemon"],
  [".nodemonignore", "nodemon"],
  ["nodemonignore", "nodemon"],
  ["nvm", "nodejs"],
  [".nvmrc", "nodejs"],
  
  // TypeScript
  ["tsconfig.json", "tsconfig"],
  ["tsconfig.base.json", "tsconfig"],
  ["tsconfig.build.json", "tsconfig"],
  ["tsconfig.common.json", "tsconfig"],
  ["tsconfig.dev.json", "tsconfig"],
  ["tsconfig.eslint.json", "tsconfig"],
  ["tsconfig.node.json", "tsconfig"],
  ["tsconfig.prod.json", "tsconfig"],
  ["tsconfig.spec.json", "tsconfig"],
  ["tsconfig.test.json", "tsconfig"],
  ["tsconfig.web.json", "tsconfig"],
  ["jsconfig.json", "jsconfig"],
  ["tsdoc.json", "tsdoc"],
  ["typedoc.json", "typedoc"],
  ["typedoc.yaml", "typedoc"],
  ["typedoc.yml", "typedoc"],
  ["typedoc.toml", "typedoc"],
  ["typedoc.cjs", "typedoc"],
  ["typedoc.mjs", "typedoc"],
  ["typedoc.js", "typedoc"],
  
  // Linting/Formatting
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
  
  ["tailwind.config.js", "tailwindcss"],
  ["tailwind.config.cjs", "tailwindcss"],
  ["tailwind.config.mjs", "tailwindcss"],
  ["tailwind.config.ts", "tailwindcss"],
  ["tailwind.config.json", "tailwindcss"],
  
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
  
  // Build tools
  ["vite.config.js", "vite"],
  ["vite.config.cjs", "vite"],
  ["vite.config.mjs", "vite"],
  ["vite.config.ts", "vite"],
  ["vite.config.cts", "vite"],
  ["vite.config.mts", "vite"],
  
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
  
  ["rollup.config.js", "rollup"],
  ["rollup.config.cjs", "rollup"],
  ["rollup.config.mjs", "rollup"],
  ["rollup.config.ts", "rollup"],
  ["rollup.config.cts", "rollup"],
  ["rollup.config.mts", "rollup"],
  ["rollup.config.json", "rollup"],
  
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
  
  // Testing
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
  
  // Python
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
  ["ruff.toml", "python"],
  ["ruff.ini", "python"],
  ["pyrightconfig.json", "python"],
  ["mypy.ini", "python"],
  ["tox.ini", "python"],
  ["pytest.ini", "python"],
  [".pylintrc", "python"],
  [".coveragerc", "python"],
  ["coveragerc", "python"],
  ["coverage.toml", "python"],
  ["coverage.json", "python"],
  ["black.toml", "python"],
  ["black.ini", "python"],
  ["isort.ini", "python"],
  ["bandit.yaml", "python"],
  ["bandit.ini", "python"],
  [".flake8", "python"],
  ["pylint.ini", "python"],
  [".autoflake", "python"],
  [".autopep8", "python"],
  [".yapf", "python"],
  [".pycodestyle", "python"],
  
  // Rust
  ["Cargo.toml", "rust"],
  ["Cargo.lock", "rust"],
  ["rust-toolchain", "rust"],
  ["rust-toolchain.toml", "rust"],
  ["rustfmt.toml", "rust"],
  ["clippy.toml", "rust"],
  
  // Go
  ["go.mod", "go"],
  ["go.sum", "go"],
  ["go.work", "go"],
  ["go.work.sum", "go"],
  ["gopls.mod", "go"],
  
  // Java/Kotlin
  ["pom.xml", "maven"],
  ["gradle", "gradle"],
  ["gradle.properties", "gradle"],
  ["settings.gradle", "gradle"],
  ["settings.gradle.kts", "kotlin"],
  ["build.gradle", "gradle"],
  ["build.gradle.kts", "kotlin"],
  
  // Ruby
  ["Gemfile", "ruby"],
  ["Gemfile.lock", "ruby"],
  
  // Elixir
  ["mix.exs", "elixir"],
  
  // Erlang
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
  
  // Haskell
  ["cabal.project", "haskell"],
  ["cabal.file", "haskell"],
  ["stack.yaml", "haskell"],
  ["stack.yml", "haskell"],
  ["package.yaml", "haskell"],
  ["hpack", "haskell"],
  ["hpack.yaml", "haskell"],
  ["hpack.yml", "haskell"],
  
  // Clojure
  ["project.clj", "clojure"],
  ["deps.edn", "clojure"],
  ["shadow-cljs", "clojure"],
  ["build.boot", "clojure"],
  
  // Scala
  ["build.sbt", "scala"],
  ["project", "scala"],
  ["project.properties", "scala"],
  
  // Nix
  ["default.nix", "nix"],
  ["shell.nix", "nix"],
  ["flake.nix", "nix"],
  ["flake.lock", "nix"],
  
  // PHP
  ["composer.json", "php"],
  ["composer.lock", "php"],
  
  // Documentation
  ["readme.md", "readme"],
  ["readme", "readme"],
  ["readme.txt", "readme"],
  ["readme.rst", "readme"],
  ["license", "license"],
  ["license.md", "license"],
  ["license.txt", "license"],
  ["licence", "license"],
  ["licence.md", "license"],
  ["licence.txt", "license"],
  ["unlicense", "unlicense"],
  ["unlicense.md", "unlicense"],
  ["unlicense.txt", "unlicense"],
  ["changelog.md", "changelog"],
  ["changelog", "changelog"],
  ["changes", "changelog"],
  ["history", "changelog"],
  ["contributing.md", "text"],
  ["contributing", "text"],
  ["todo.md", "todo"],
  ["todo", "todo"],
  ["roadmap.md", "roadmap"],
  ["roadmap", "roadmap"],
  ["toc.md", "toc"],
  ["toc", "toc"],
  ["authors", "authors"],
  ["authors.md", "authors"],
  
  // CI/CD
  [".gitlab-ci.yml", "gitlab"],
  [".gitlab-ci.yaml", "gitlab"],
  [".travis.yml", "travis"],
  [".travis.yaml", "travis"],
  ["travis.yml", "travis"],
  ["travis.yaml", "travis"],
  [".circleci", "circleci"],
  ["circleci", "circleci"],
  ["appveyor.yml", "appveyor"],
  ["appveyor.yaml", "appveyor"],
  [".github", "folder-github"],
  
  // IDE configs
  [".vscode", "folder-vscode"],
  [".idea", "folder-intellij"],
  [".editorconfig", "settings"],
  ["editorconfig", "settings"],
  
  // Other configs
  [".env", "tune"],
  [".env.local", "tune"],
  [".env.development", "tune"],
  [".env.production", "tune"],
  [".env.test", "tune"],
  [".env.example", "tune"],
  ["env", "tune"],
  ["env.local", "tune"],
  ["env.development", "tune"],
  ["env.production", "tune"],
  ["env.test", "tune"],
  ["env.example", "tune"],
  
  // Cloud
  ["firebase.json", "firebase"],
  ["firebaserc", "firebase"],
  [".firebaserc", "firebase"],
  ["firestore.rules", "firebase"],
  ["firestore.indexes.json", "firebase"],
  ["storage.rules", "firebase"],
  ["database.rules.json", "firebase"],
  ["remoteconfig.template.json", "firebase"],
  
  ["azure-pipelines.yml", "azure-pipelines"],
  ["azure-pipelines.yaml", "azure-pipelines"],
  
  ["cloudbuild.yaml", "gcp"],
  ["cloudbuild.yml", "gcp"],
  ["cloudbuild.json", "gcp"],
  ["app.yaml", "gcp"],
  ["app.yml", "gcp"],
  
  ["heroku.yml", "heroku"],
  ["heroku.yaml", "heroku"],
  ["procfile", "heroku"],
  ["procfile.windows", "heroku"],
  
  ["render.yaml", "render"],
  ["render.yml", "render"],
  
  ["railway.json", "railway"],
  ["railway.toml", "railway"],
  
  ["fly.toml", "fly"],
  
  ["deno.json", "deno"],
  ["deno.jsonc", "deno"],
  ["deno.lock", "deno"],
  ["import_map.json", "deno"],
  ["import_map.jsonc", "deno"],
  
  ["netlify.toml", "netlify"],
  ["netlify.yml", "netlify"],
  ["netlify.yaml", "netlify"],
  
  ["vercel.json", "vercel"],
  ["now.json", "vercel"],
  ["now.yml", "vercel"],
  ["now.yaml", "vercel"],
  
  ["serverless.yml", "serverless"],
  ["serverless.yaml", "serverless"],
  ["serverless.js", "serverless"],
  ["serverless.ts", "serverless"],
  ["serverless.json", "serverless"],
  ["serverless.cjs", "serverless"],
  ["serverless.mjs", "serverless"],
  ["serverless.cts", "serverless"],
  ["serverless.mts", "serverless"],
  
  ["terraform.tfvars", "terraform"],
  ["terraform.tfvars.json", "terraform"],
  ["terraform.tfstate", "terraform"],
  ["terraform.tfstate.backup", "terraform"],
  ["terraform.tfstate.json", "terraform"],
  ["terraform.tfstate.json.backup", "terraform"],
  ["terragrunt", "terraform"],
  ["terragrunt.hcl", "terraform"],
  ["terragrunt.hcl.json", "terraform"],
  
  ["k8s.yaml", "kubernetes"],
  ["k8s.yml", "kubernetes"],
  ["k8s.json", "kubernetes"],
  ["kustomization", "kubernetes"],
  ["kustomization.yaml", "kubernetes"],
  ["kustomization.yml", "kubernetes"],
  
  ["chart.yaml", "helm"],
  ["values.yaml", "helm"],
  ["values.yml", "helm"],
  ["values.schema.json", "helm"],
  ["requirements.yaml", "helm"],
  ["requirements.yml", "helm"],
  [".helmignore", "helm"],
  
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
  
  ["berksfile", "chef"],
  ["berksfile.lock", "chef"],
  ["chefignore", "chef"],
  ["kitchen.yml", "chef"],
  ["kitchen.yaml", "chef"],
  
  ["puppetfile", "puppet"],
  ["puppetfile.lock", "puppet"],
  ["hiera.yaml", "puppet"],
  ["hiera.yml", "puppet"],
  
  ["salt.sls", "salt"],
  ["cloud.init", "salt"],
  ["cloud-config", "salt"],
  ["cloud-init", "salt"],
  
  ["vagrantfile", "vagrant"],
  
  ["packer.json", "packer"],
  ["packer.hcl", "packer"],
  ["packer.auto.pkrvars.hcl", "packer"],
  ["packer.auto.pkrvars.json", "packer"],
  
  // Monorepo tools
  ["turbo.json", "turborepo"],
  ["nx.json", "nx"],
  ["workspace.json", "nx"],
  ["project.json", "nx"],
  ["lerna.json", "lerna"],
  ["lerna.yaml", "lerna"],
  ["lerna.yml", "lerna"],
  ["rush.json", "rush"],
  ["rush-stack", "rush"],
  ["rushstack", "rush"],
  
  ["pnpm-workspace.yaml", "pnpm"],
  ["pnpm-workspace.yml", "pnpm"],
  
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
  
  // Misc
  ["makefile", "makefile"],
  ["gnumakefile", "makefile"],
  ["cmakelists.txt", "cmake"],
  ["cmakecache.txt", "cmake"],
  
  ["robots.txt", "robots"],
  ["sitemap.xml", "xml"],
  ["sitemap.txt", "text"],
  ["humans.txt", "text"],
  
  ["favicon.ico", "image"],
  ["favicon.png", "image"],
  ["apple-touch-icon.png", "image"],
  
  ["browserconfig.xml", "xml"],
  ["manifest.json", "json"],
  ["manifest.webmanifest", "json"],
  
  ["security.txt", "text"],
  ["security.md", "text"],
  
  ["procfile", "heroku"],
  ["procfile.windows", "heroku"],
  
  ["rakefile", "ruby"],
  ["rake", "ruby"],
  
  ["gemfile", "ruby"],
  ["gemfile.lock", "ruby"],
  
  ["mix.exs", "elixir"],
  
  ["rebar.config", "erlang"],
  ["rebar.lock", "erlang"],
  
  ["cabal.file", "haskell"],
  ["cabal.project", "haskell"],
  
  ["project.clj", "clojure"],
  
  ["build.sbt", "scala"],
  
  ["default.nix", "nix"],
  ["shell.nix", "nix"],
  ["flake.nix", "nix"],
  ["flake.lock", "nix"],
  
  ["composer.json", "php"],
  ["composer.lock", "php"],
  
  ["go.mod", "go"],
  ["go.sum", "go"],
  ["go.work", "go"],
  ["go.work.sum", "go"],
  
  ["cargo.toml", "rust"],
  ["cargo.lock", "rust"],
  
  ["requirements.txt", "python"],
  ["requirements.pip", "python"],
  ["setup.py", "python"],
  ["setup.cfg", "python"],
  ["pyproject.toml", "python"],
  ["poetry.lock", "python"],
  
  ["pipfile", "python"],
  ["pipfile.lock", "python"],
  
  ["environment.yml", "python"],
  ["environment.yaml", "python"],
  
  ["conda-lock", "python"],
  ["conda-lock.yml", "python"],
  ["conda-lock.yaml", "python"],
  ["conda-lock.json", "python"],
  
  ["pixi.toml", "python"],
  ["pixi.lock", "python"],
  
  ["ruff.toml", "python"],
  ["ruff.ini", "python"],
  
  ["pyrightconfig.json", "python"],
  
  ["mypy.ini", "python"],
  
  ["tox.ini", "python"],
  
  ["pytest.ini", "python"],
  
  [".pylintrc", "python"],
  
  [".coveragerc", "python"],
  
  ["coverage.toml", "python"],
  ["coverage.json", "python"],
  
  ["black.toml", "python"],
  ["black.ini", "python"],
  
  ["isort.ini", "python"],
  
  ["bandit.yaml", "python"],
  ["bandit.ini", "python"],
  
  [".flake8", "python"],
  
  ["pylint.ini", "python"],
  
  [".autoflake", "python"],
  
  [".autopep8", "python"],
  
  [".yapf", "python"],
  
  [".pycodestyle", "python"],
  
  ["rust-toolchain", "rust"],
  ["rust-toolchain.toml", "rust"],
  
  ["rustfmt.toml", "rust"],
  
  ["clippy.toml", "rust"],
  
  ["gopls.mod", "go"],
  
  ["pom.xml", "maven"],
  
  ["gradle", "gradle"],
  ["gradle.properties", "gradle"],
  ["settings.gradle", "gradle"],
  ["settings.gradle.kts", "kotlin"],
  ["build.gradle", "gradle"],
  ["build.gradle.kts", "kotlin"],
  
  ["gemfile", "ruby"],
  ["gemfile.lock", "ruby"],
  
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
  
  ["cabal.project", "haskell"],
  ["cabal.file", "haskell"],
  ["stack.yaml", "haskell"],
  ["stack.yml", "haskell"],
  ["package.yaml", "haskell"],
  ["hpack", "haskell"],
  ["hpack.yaml", "haskell"],
  ["hpack.yml", "haskell"],
  
  ["project.clj", "clojure"],
  ["deps.edn", "clojure"],
  ["shadow-cljs", "clojure"],
  ["build.boot", "clojure"],
  
  ["build.sbt", "scala"],
  ["project", "scala"],
  ["project.properties", "scala"],
  
  ["default.nix", "nix"],
  ["shell.nix", "nix"],
  ["flake.nix", "nix"],
  ["flake.lock", "nix"],
  
  ["composer.json", "php"],
  ["composer.lock", "php"],
  
  ["readme.md", "readme"],
  ["readme", "readme"],
  ["readme.txt", "readme"],
  ["readme.rst", "readme"],
  
  ["license", "license"],
  ["license.md", "license"],
  ["license.txt", "license"],
  ["licence", "license"],
  ["licence.md", "license"],
  ["licence.txt", "license"],
  ["unlicense", "unlicense"],
  ["unlicense.md", "unlicense"],
  ["unlicense.txt", "unlicense"],
  
  ["changelog.md", "changelog"],
  ["changelog", "changelog"],
  ["changes", "changelog"],
  ["history", "changelog"],
  
  ["contributing.md", "text"],
  ["contributing", "text"],
  
  ["todo.md", "todo"],
  ["todo", "todo"],
  
  ["roadmap.md", "roadmap"],
  ["roadmap", "roadmap"],
  
  ["toc.md", "toc"],
  ["toc", "toc"],
  
  ["authors", "authors"],
  ["authors.md", "authors"],
  
  [".gitlab-ci.yml", "gitlab"],
  [".gitlab-ci.yaml", "gitlab"],
  
  [".travis.yml", "travis"],
  [".travis.yaml", "travis"],
  
  [".circleci", "circleci"],
  ["circleci", "circleci"],
  
  ["appveyor.yml", "appveyor"],
  ["appveyor.yaml", "appveyor"],
  
  [".github", "folder-github"],
  
  [".vscode", "folder-vscode"],
  
  [".idea", "folder-intellij"],
  
  [".editorconfig", "settings"],
  ["editorconfig", "settings"],
  
  [".env", "tune"],
  [".env.local", "tune"],
  [".env.development", "tune"],
  [".env.production", "tune"],
  [".env.test", "tune"],
  [".env.example", "tune"],
  ["env", "tune"],
  ["env.local", "tune"],
  ["env.development", "tune"],
  ["env.production", "tune"],
  ["env.test", "tune"],
  ["env.example", "tune"],
  
  ["firebase.json", "firebase"],
  ["firebaserc", "firebase"],
  [".firebaserc", "firebase"],
  ["firestore.rules", "firebase"],
  ["firestore.indexes.json", "firebase"],
  ["storage.rules", "firebase"],
  ["database.rules.json", "firebase"],
  ["remoteconfig.template.json", "firebase"],
  
  ["azure-pipelines.yml", "azure-pipelines"],
  ["azure-pipelines.yaml", "azure-pipelines"],
  
  ["cloudbuild.yaml", "gcp"],
  ["cloudbuild.yml", "gcp"],
  ["cloudbuild.json", "gcp"],
  ["app.yaml", "gcp"],
  ["app.yml", "gcp"],
  
  ["heroku.yml", "heroku"],
  ["heroku.yaml", "heroku"],
  ["procfile", "heroku"],
  ["procfile.windows", "heroku"],
  
  ["render.yaml", "render"],
  ["render.yml", "render"],
  
  ["railway.json", "railway"],
  ["railway.toml", "railway"],
  
  ["fly.toml", "fly"],
  
  ["deno.json", "deno"],
  ["deno.jsonc", "deno"],
  ["deno.lock", "deno"],
  ["import_map.json", "deno"],
  ["import_map.jsonc", "deno"],
  
  ["netlify.toml", "netlify"],
  ["netlify.yml", "netlify"],
  ["netlify.yaml", "netlify"],
  
  ["vercel.json", "vercel"],
  ["now.json", "vercel"],
  ["now.yml", "vercel"],
  ["now.yaml", "vercel"],
  
  ["serverless.yml", "serverless"],
  ["serverless.yaml", "serverless"],
  ["serverless.js", "serverless"],
  ["serverless.ts", "serverless"],
  ["serverless.json", "serverless"],
  ["serverless.cjs", "serverless"],
  ["serverless.mjs", "serverless"],
  ["serverless.cts", "serverless"],
  ["serverless.mts", "serverless"],
  
  ["terraform.tfvars", "terraform"],
  ["terraform.tfvars.json", "terraform"],
  ["terraform.tfstate", "terraform"],
  ["terraform.tfstate.backup", "terraform"],
  ["terraform.tfstate.json", "terraform"],
  ["terraform.tfstate.json.backup", "terraform"],
  ["terragrunt", "terraform"],
  ["terragrunt.hcl", "terraform"],
  ["terragrunt.hcl.json", "terraform"],
  
  ["k8s.yaml", "kubernetes"],
  ["k8s.yml", "kubernetes"],
  ["k8s.json", "kubernetes"],
  ["kustomization", "kubernetes"],
  ["kustomization.yaml", "kubernetes"],
  ["kustomization.yml", "kubernetes"],
  
  ["chart.yaml", "helm"],
  ["values.yaml", "helm"],
  ["values.yml", "helm"],
  ["values.schema.json", "helm"],
  ["requirements.yaml", "helm"],
  ["requirements.yml", "helm"],
  [".helmignore", "helm"],
  
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
  
  ["berksfile", "chef"],
  ["berksfile.lock", "chef"],
  ["chefignore", "chef"],
  ["kitchen.yml", "chef"],
  ["kitchen.yaml", "chef"],
  
  ["puppetfile", "puppet"],
  ["puppetfile.lock", "puppet"],
  ["hiera.yaml", "puppet"],
  ["hiera.yml", "puppet"],
  
  ["salt.sls", "salt"],
  ["cloud.init", "salt"],
  ["cloud-config", "salt"],
  ["cloud-init", "salt"],
  
  ["vagrantfile", "vagrant"],
  
  ["packer.json", "packer"],
  ["packer.hcl", "packer"],
  ["packer.auto.pkrvars.hcl", "packer"],
  ["packer.auto.pkrvars.json", "packer"],
  
  ["turbo.json", "turborepo"],
  
  ["nx.json", "nx"],
  ["workspace.json", "nx"],
  ["project.json", "nx"],
  
  ["lerna.json", "lerna"],
  ["lerna.yaml", "lerna"],
  ["lerna.yml", "lerna"],
  
  ["rush.json", "rush"],
  ["rush-stack", "rush"],
  ["rushstack", "rush"],
  
  ["pnpm-workspace.yaml", "pnpm"],
  ["pnpm-workspace.yml", "pnpm"],
  
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
  
  ["makefile", "makefile"],
  ["gnumakefile", "makefile"],
  ["cmakelists.txt", "cmake"],
  ["cmakecache.txt", "cmake"],
  
  ["robots.txt", "robots"],
  ["sitemap.xml", "xml"],
  ["sitemap.txt", "text"],
  ["humans.txt", "text"],
  
  ["favicon.ico", "image"],
  ["favicon.png", "image"],
  ["apple-touch-icon.png", "image"],
  
  ["browserconfig.xml", "xml"],
  ["manifest.json", "json"],
  ["manifest.webmanifest", "json"],
  
  ["security.txt", "text"],
  ["security.md", "text"],
  
  ["procfile", "heroku"],
  ["procfile.windows", "heroku"],
  
  ["rakefile", "ruby"],
  ["rake", "ruby"],
  
  ["gemfile", "ruby"],
  ["gemfile.lock", "ruby"],
  
  ["mix.exs", "elixir"],
  
  ["rebar.config", "erlang"],
  ["rebar.lock", "erlang"],
  
  ["cabal.file", "haskell"],
  ["cabal.project", "haskell"],
  
  ["project.clj", "clojure"],
  
  ["build.sbt", "scala"],
  
  ["default.nix", "nix"],
  ["shell.nix", "nix"],
  ["flake.nix", "nix"],
  ["flake.lock", "nix"],
  
  ["composer.json", "php"],
  ["composer.lock", "php"],
  
  ["go.mod", "go"],
  ["go.sum", "go"],
  ["go.work", "go"],
  ["go.work.sum", "go"],
  
  ["cargo.toml", "rust"],
  ["cargo.lock", "rust"],
  
  ["requirements.txt", "python"],
  ["requirements.pip", "python"],
  ["setup.py", "python"],
  ["setup.cfg", "python"],
  ["pyproject.toml", "python"],
  ["poetry.lock", "python"],
  
  ["pipfile", "python"],
  ["pipfile.lock", "python"],
  
  ["environment.yml", "python"],
  ["environment.yaml", "python"],
  
  ["conda-lock", "python"],
  ["conda-lock.yml", "python"],
  ["conda-lock.yaml", "python"],
  ["conda-lock.json", "python"],
  
  ["pixi.toml", "python"],
  ["pixi.lock", "python"],
  
  ["ruff.toml", "python"],
  ["ruff.ini", "python"],
  
  ["pyrightconfig.json", "python"],
  
  ["mypy.ini", "python"],
  
  ["tox.ini", "python"],
  
  ["pytest.ini", "python"],
  
  [".pylintrc", "python"],
  
  [".coveragerc", "python"],
  
  ["coverage.toml", "python"],
  ["coverage.json", "python"],
  
  ["black.toml", "python"],
  ["black.ini", "python"],
  
  ["isort.ini", "python"],
  
  ["bandit.yaml", "python"],
  ["bandit.ini", "python"],
  
  [".flake8", "python"],
  
  ["pylint.ini", "python"],
  
  [".autoflake", "python"],
  
  [".autopep8", "python"],
  
  [".yapf", "python"],
  
  [".pycodestyle", "python"],
  
  ["rust-toolchain", "rust"],
  ["rust-toolchain.toml", "rust"],
  
  ["rustfmt.toml", "rust"],
  
  ["clippy.toml", "rust"],
  
  ["gopls.mod", "go"],
  
  ["pom.xml", "maven"],
  
  ["gradle", "gradle"],
  ["gradle.properties", "gradle"],
  ["settings.gradle", "gradle"],
  ["settings.gradle.kts", "kotlin"],
  ["build.gradle", "gradle"],
  ["build.gradle.kts", "kotlin"],
  
  ["gemfile", "ruby"],
  ["gemfile.lock", "ruby"],
  
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
  
  ["cabal.project", "haskell"],
  ["cabal.file", "haskell"],
  ["stack.yaml", "haskell"],
  ["stack.yml", "haskell"],
  ["package.yaml", "haskell"],
  ["hpack", "haskell"],
  ["hpack.yaml", "haskell"],
  ["hpack.yml", "haskell"],
  
  ["project.clj", "clojure"],
  ["deps.edn", "clojure"],
  ["shadow-cljs", "clojure"],
  ["build.boot", "clojure"],
  
  ["build.sbt", "scala"],
  ["project", "scala"],
  ["project.properties", "scala"],
  
  ["default.nix", "nix"],
  ["shell.nix", "nix"],
  ["flake.nix", "nix"],
  ["flake.lock", "nix"],
  
  ["composer.json", "php"],
  ["composer.lock", "php"],
]);
