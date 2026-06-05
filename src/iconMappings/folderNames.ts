/**
 * Folder name mappings to icon mapping.
 */

export const FOLDER_NAMES: Map<string, string> = new Map([
  // Git/Version Control
  [".git", "folder-git"],
  [".github", "folder-github"],
  [".gitlab", "folder-gitlab"],
  [".svn", "folder-svn"],
  [".hg", "folder-mercurial"],
  [".bzr", "folder-bazaar"],
  [".cvs", "folder-cvs"],
  
  // IDE/Editor folders
  [".vscode", "folder-vscode"],
  [".idea", "folder-intellij"],
  [".vs", "folder-visualstudio"],
  [".vscode-insiders", "folder-vscode"],
  [".cursor", "folder-vscode"],
  [".jetbrains", "folder-intellij"],
  
  // Node.js
  ["node_modules", "folder-node"],
  ["node_modules/.bin", "folder-node"],
  ["node_modules/.cache", "folder-node"],
  
  // Source folders
  ["src", "folder-src"],
  ["source", "folder-src"],
  ["sources", "folder-src"],
  ["lib", "folder-src"],
  ["libs", "folder-src"],
  ["include", "folder-src"],
  ["inc", "folder-src"],
  
  // Build/Dist folders
  ["dist", "folder-dist"],
  ["build", "folder-dist"],
  ["out", "folder-dist"],
  ["output", "folder-dist"],
  ["bin", "folder-dist"],
  ["target", "folder-dist"],
  ["release", "folder-dist"],
  ["releases", "folder-dist"],
  ["artifacts", "folder-dist"],
  ["artifact", "folder-dist"],
  
  // Test folders
  ["test", "folder-test"],
  ["tests", "folder-test"],
  ["__tests__", "folder-test"],
  ["spec", "folder-test"],
  ["specs", "folder-test"],
  ["__spec__", "folder-test"],
  ["__specs__", "folder-test"],
  ["e2e", "folder-test"],
  ["integration", "folder-test"],
  ["unit", "folder-test"],
  ["__tests__", "folder-test"],
  
  // Public/Static folders
  ["public", "folder-public"],
  ["static", "folder-public"],
  ["assets", "folder-assets"],
  ["resource", "folder-assets"],
  ["resources", "folder-assets"],
  ["res", "folder-assets"],
  ["img", "folder-images"],
  ["images", "folder-images"],
  ["image", "folder-images"],
  ["icons", "folder-images"],
  ["icon", "folder-images"],
  
  // Documentation
  ["docs", "folder-docs"],
  ["documentation", "folder-docs"],
  ["doc", "folder-docs"],
  ["wiki", "folder-docs"],
  ["guides", "folder-docs"],
  ["guide", "folder-docs"],
  
  // Components
  ["components", "folder-components"],
  ["component", "folder-components"],
  ["comps", "folder-components"],
  ["comp", "folder-components"],
  
  // State management
  ["redux", "folder-redux"],
  ["store", "folder-redux"],
  ["state", "folder-redux"],
  ["stores", "folder-redux"],
  ["vuex", "folder-vuex-store"],
  ["vuex-store", "folder-vuex-store"],
  
  // Routing
  ["router", "folder-router"],
  ["routes", "folder-router"],
  ["route", "folder-router"],
  ["routers", "folder-router"],
  ["pages", "folder-pages"],
  ["page", "folder-pages"],
  
  // API
  ["api", "folder-api"],
  ["apis", "folder-api"],
  ["server", "folder-server"],
  ["servers", "folder-server"],
  ["backend", "folder-server"],
  ["service", "folder-server"],
  ["services", "folder-server"],
  
  // Database
  ["db", "folder-database"],
  ["database", "folder-database"],
  ["databases", "folder-database"],
  ["data", "folder-database"],
  ["datas", "folder-database"],
  ["migrations", "folder-database"],
  ["migration", "folder-database"],
  ["seeds", "folder-database"],
  ["seeders", "folder-database"],
  
  // Config
  ["config", "folder-config"],
  ["configs", "folder-config"],
  ["configuration", "folder-config"],
  ["settings", "folder-config"],
  ["conf", "folder-config"],
  ["cfg", "folder-config"],
  
  // Scripts
  ["scripts", "folder-scripts"],
  ["script", "folder-scripts"],
  ["bin", "folder-scripts"],
  ["tools", "folder-tools"],
  ["tool", "folder-tools"],
  ["utils", "folder-utils"],
  ["util", "folder-utils"],
  ["utility", "folder-utils"],
  ["utilities", "folder-utils"],
  ["helpers", "folder-utils"],
  ["helper", "folder-utils"],
  
  // Styles
  ["styles", "folder-sass"],
  ["style", "folder-sass"],
  ["css", "folder-sass"],
  ["scss", "folder-sass"],
  ["sass", "folder-sass"],
  ["less", "folder-less"],
  ["styl", "folder-stylus"],
  ["stylus", "folder-stylus"],
  
  // Templates
  ["templates", "folder-template"],
  ["template", "folder-template"],
  ["views", "folder-views"],
  ["view", "folder-views"],
  ["layouts", "folder-template"],
  ["layout", "folder-template"],
  ["partials", "folder-template"],
  ["partial", "folder-template"],
  
  // Hooks
  ["hooks", "folder-hooks"],
  ["hook", "folder-hooks"],
  
  // Middleware
  ["middleware", "folder-middleware"],
  ["middlewares", "folder-middleware"],
  
  // Types
  ["types", "folder-typescript"],
  ["@types", "folder-typescript"],
  ["typings", "folder-typescript"],
  ["type", "folder-typescript"],
  
  // Interfaces
  ["interfaces", "folder-typescript"],
  ["interface", "folder-typescript"],
  
  // Constants
  ["constants", "folder-config"],
  ["constant", "folder-config"],
  ["consts", "folder-config"],
  ["const", "folder-config"],
  
  // Models
  ["models", "folder-model"],
  ["model", "folder-model"],
  
  // Controllers
  ["controllers", "folder-controller"],
  ["controller", "folder-controller"],
  
  // Services
  ["services", "folder-service"],
  ["service", "folder-service"],
  
  // Repositories
  ["repositories", "folder-repo"],
  ["repository", "folder-repo"],
  ["repos", "folder-repo"],
  ["repo", "folder-repo"],
  
  // Modules
  ["modules", "folder-module"],
  ["module", "folder-module"],
  
  // Packages
  ["packages", "folder-package"],
  ["package", "folder-package"],
  ["pkg", "folder-package"],
  
  // Plugins
  ["plugins", "folder-plugin"],
  ["plugin", "folder-plugin"],
  
  // Themes
  ["themes", "folder-theme"],
  ["theme", "folder-theme"],
  
  // Locales
  ["locales", "folder-i18n"],
  ["locale", "folder-i18n"],
  ["i18n", "folder-i18n"],
  ["lang", "folder-i18n"],
  ["langs", "folder-i18n"],
  ["languages", "folder-i18n"],
  ["language", "folder-i18n"],
  
  // Fonts
  ["fonts", "folder-font"],
  ["font", "folder-font"],
  
  // Icons
  ["icons", "folder-images"],
  ["icon", "folder-images"],
  
  // Images
  ["images", "folder-images"],
  ["image", "folder-images"],
  ["img", "folder-images"],
  ["imgs", "folder-images"],
  
  // Audio
  ["audio", "folder-audio"],
  ["audios", "folder-audio"],
  ["sound", "folder-audio"],
  ["sounds", "folder-audio"],
  ["music", "folder-audio"],
  
  // Video
  ["video", "folder-video"],
  ["videos", "folder-video"],
  ["media", "folder-video"],
  
  // Cache
  ["cache", "folder-cache"],
  ["caches", "folder-cache"],
  [".cache", "folder-cache"],
  
  // Temp
  ["temp", "folder-temp"],
  ["tmp", "folder-temp"],
  ["temporary", "folder-temp"],
  [".tmp", "folder-temp"],
  [".temp", "folder-temp"],
  
  // Logs
  ["logs", "folder-log"],
  ["log", "folder-log"],
  
  // Examples
  ["examples", "folder-example"],
  ["example", "folder-example"],
  ["sample", "folder-example"],
  ["samples", "folder-example"],
  ["demo", "folder-example"],
  ["demos", "folder-example"],
  
  // Storybook
  [".storybook", "folder-storybook"],
  ["storybook", "folder-storybook"],
  ["stories", "folder-storybook"],
  ["story", "folder-storybook"],
  
  // Stencil
  [".stencil", "folder-stencil"],
  
  // Supabase
  ["supabase", "folder-supabase"],
  
  // Vercel
  [".vercel", "folder-vercel"],
  
  // Netlify
  [".netlify", "folder-netlify"],
  
  // AWS
  [".aws", "folder-aws"],
  
  // Firebase
  [".firebase", "folder-firebase"],
  
  // Docker
  [".docker", "folder-docker"],
  
  // Kubernetes
  [".kube", "folder-kubernetes"],
  ["k8s", "folder-kubernetes"],
  
  // Terraform
  [".terraform", "folder-terraform"],
  ["terraform", "folder-terraform"],
  
  // Ansible
  ["ansible", "folder-ansible"],
  
  // Chef
  [".chef", "folder-chef"],
  
  // Puppet
  [".puppet", "folder-puppet"],
  
  // Salt
  [".salt", "folder-salt"],
  
  // Vagrant
  [".vagrant", "folder-vagrant"],
  
  // Packer
  [".packer", "folder-packer"],
  
  // Android
  ["android", "folder-android"],
  [".android", "folder-android"],
  
  // iOS
  ["ios", "folder-ios"],
  
  // Flutter
  ["android", "folder-android"],
  ["ios", "folder-ios"],
  ["lib", "folder-src"],
  
  // React Native
  ["android", "folder-android"],
  ["ios", "folder-ios"],
  
  // Electron
  ["electron", "folder-electron"],
  
  // Tauri
  ["src-tauri", "folder-src-tauri"],
  
  // Rust
  ["target", "folder-dist"],
  
  // Go
  ["cmd", "folder-go"],
  ["pkg", "folder-go"],
  
  // Python
  ["venv", "folder-python"],
  [".venv", "folder-python"],
  ["env", "folder-python"],
  [".env", "folder-python"],
  ["virtualenv", "folder-python"],
  ["__pycache__", "folder-python"],
  
  // Java
  ["src/main/java", "folder-java"],
  ["src/test/java", "folder-java"],
  ["src/main/resources", "folder-java"],
  
  // Scala
  ["src/main/scala", "folder-scala"],
  ["src/test/scala", "folder-scala"],
  
  // Kotlin
  ["src/main/kotlin", "folder-kotlin"],
  ["src/test/kotlin", "folder-kotlin"],
  
  // Ruby
  ["app", "folder-ruby"],
  ["config", "folder-ruby"],
  ["db", "folder-ruby"],
  ["lib", "folder-ruby"],
  ["public", "folder-ruby"],
  ["spec", "folder-ruby"],
  ["test", "folder-ruby"],
  ["vendor", "folder-ruby"],
  
  // PHP
  ["app", "folder-php"],
  ["config", "folder-php"],
  ["public", "folder-php"],
  ["resources", "folder-php"],
  ["routes", "folder-php"],
  ["storage", "folder-php"],
  ["tests", "folder-php"],
  
  // Laravel
  ["app", "folder-laravel"],
  ["bootstrap", "folder-laravel"],
  ["config", "folder-laravel"],
  ["database", "folder-laravel"],
  ["public", "folder-laravel"],
  ["resources", "folder-laravel"],
  ["routes", "folder-laravel"],
  ["storage", "folder-laravel"],
  ["tests", "folder-laravel"],
  
  // WordPress
  ["wp-content", "folder-wordpress"],
  ["wp-includes", "folder-wordpress"],
  ["wp-admin", "folder-wordpress"],
  
  // Drupal
  ["modules", "folder-drupal"],
  ["themes", "folder-drupal"],
  ["profiles", "folder-drupal"],
  
  // Magento
  ["app", "folder-magento"],
  ["pub", "folder-magento"],
  ["vendor", "folder-magento"],
  
  // Unity
  ["assets", "folder-unity"],
  ["plugins", "folder-unity"],
  ["projectsettings", "folder-unity"],
  
  // Unreal
  ["content", "folder-unreal"],
  ["config", "folder-unreal"],
  ["source", "folder-unreal"],
  
  // Godot
  ["res://", "folder-godot"],
  [".import", "folder-godot"],
  
  // Blender
  ["blendfiles", "folder-blender"],
  
  // VS Code
  [".vscode", "folder-vscode"],
  [".vscode-test", "folder-vscode"],
  
  // WebStorm/IntelliJ
  [".idea", "folder-intellij"],
  
  // Xcode
  ["xcuserdata", "folder-xcode"],
  ["xcshareddata", "folder-xcode"],
  
  // Android Studio
  [".gradle", "folder-gradle"],
  [".idea", "folder-intellij"],
  
  // Next.js
  ["pages", "folder-next"],
  ["app", "folder-next"],
  
  // Nuxt
  ["pages", "folder-nuxt"],
  ["layouts", "folder-nuxt"],
  ["middleware", "folder-nuxt"],
  ["plugins", "folder-nuxt"],
  ["store", "folder-nuxt"],
  
  // Remix
  ["app", "folder-remix"],
  ["routes", "folder-remix"],
  
  // Gatsby
  ["src/pages", "folder-gatsby"],
  ["src/templates", "folder-gatsby"],
  
  // SvelteKit
  ["src/routes", "folder-svelte"],
  ["src/lib", "folder-svelte"],
  
  // Astro
  ["src/pages", "folder-astro"],
  ["src/layouts", "folder-astro"],
  
  // Solid
  ["src/routes", "folder-solid"],
  ["src/components", "folder-solid"],
  
  // Qwik
  ["src/routes", "folder-qwik"],
  ["src/components", "folder-qwik"],
  
  // Angular
  ["src/app", "folder-angular"],
  
  // Vue
  ["src/components", "folder-vue"],
  ["src/views", "folder-vue"],
  ["src/router", "folder-vue"],
  ["src/store", "folder-vuex-store"],
  
  // React
  ["src/components", "folder-react"],
  ["src/hooks", "folder-react"],
  
  // Svelte
  ["src/lib", "folder-svelte"],
  ["src/routes", "folder-svelte"],
  
  // Preact
  ["src/components", "folder-preact"],
  
  // Ember
  ["app", "folder-ember"],
  ["tests", "folder-ember"],
  
  // Aurelia
  
  // Backbone
  ["collections", "folder-backbone"],
  ["models", "folder-backbone"],
  ["routers", "folder-backbone"],
  ["views", "folder-backbone"],
  
  // Polymer
  ["elements", "folder-polymer"],
  
  // Meteor
  ["client", "folder-meteor"],
  ["server", "folder-meteor"],
  ["imports", "folder-meteor"],
  ["packages", "folder-meteor"],
  
  // Mithril
  ["components", "folder-mithril"],
  
  // Mithril.js
  ["components", "folder-mithril"],
  
  // NestJS
  
  // LoopBack
  ["common", "folder-loopback"],
  ["models", "folder-loopback"],
  ["server", "folder-loopback"],
  
  // Feathers
  
  // Adonis
  ["app", "folder-adonis"],
  ["config", "folder-adonis"],
  ["database", "folder-adonis"],
  ["public", "folder-adonis"],
  ["start", "folder-adonis"],
  
  // Sails
  ["api", "folder-sails"],
  ["assets", "folder-sails"],
  ["config", "folder-sails"],
  ["tasks", "folder-sails"],
  ["views", "folder-sails"],
  
  // Hapi
  ["lib", "folder-hapi"],
  ["plugins", "folder-hapi"],
  ["test", "folder-hapi"],
  
  // Koa
  ["lib", "folder-koa"],
  ["test", "folder-koa"],
  
  // Express
  ["public", "folder-express"],
  ["routes", "folder-express"],
  ["views", "folder-express"],
  
  // Fastify
  ["plugins", "folder-fastify"],
  ["routes", "folder-fastify"],
  
  // Strapi
  ["api", "folder-strapi"],
  ["config", "folder-strapi"],
  ["public", "folder-strapi"],
  
  // Keystone
  ["keystone", "folder-keystone"],
  
  // Prisma
  ["prisma", "folder-prisma"],
  
  // TypeORM
  ["src/entity", "folder-typeorm"],
  ["src/migration", "folder-typeorm"],
  
  // Sequelize
  ["models", "folder-sequelize"],
  ["migrations", "folder-sequelize"],
  ["seeders", "folder-sequelize"],
  
  // Mongoose
  ["models", "folder-mongoose"],
  
  // MikroORM
  ["src/entities", "folder-mikroorm"],
  
  // Objection
  ["models", "folder-objection"],
  
  // Bookshelf
  ["models", "folder-bookshelf"],
  
  // Knex
  ["migrations", "folder-knex"],
  ["seeds", "folder-knex"],
  
  // MongoDB
  ["data", "folder-mongodb"],
  
  // Redis
  ["data", "folder-redis"],
  
  // PostgreSQL
  ["data", "folder-postgresql"],
  
  // MySQL
  ["data", "folder-mysql"],
  
  // SQLite
  ["data", "folder-sqlite"],
  
  // MariaDB
  ["data", "folder-mariadb"],
  
  // Cassandra
  ["data", "folder-cassandra"],
  
  // DynamoDB
  ["data", "folder-dynamodb"],
  
  // Firebase
  ["functions", "folder-firebase"],
  
  // Firestore
  ["firestore", "folder-firebase"],
  
  // GraphQL
  ["graphql", "folder-graphql"],
  
  // gRPC
  ["protos", "folder-grpc"],
  
  // WebSocket
  ["websocket", "folder-websocket"],
  
  // Socket.io
  ["socket", "folder-socket"],
  
  // WebRTC
  ["webrtc", "folder-webrtc"],
  
  // WebAssembly
  ["wasm", "folder-webassembly"],
  
  // Web Workers
  ["workers", "folder-worker"],
  
  // Service Workers
  ["service-worker", "folder-serviceworker"],
  
  // PWA
  ["pwa", "folder-pwa"],
  
  // Electron
  ["electron", "folder-electron"],
  
  // Tauri
  ["src-tauri", "folder-src-tauri"],
  
  // Capacitor
  ["capacitor", "folder-capacitor"],
  
  // Cordova
  ["cordova", "folder-cordova"],
  
  // Ionic
  ["ionic", "folder-ionic"],
  
  // React Native
  ["ios", "folder-ios"],
  ["android", "folder-android"],
  
  // Flutter
  ["android", "folder-android"],
  ["ios", "folder-ios"],
  ["lib", "folder-src"],
  ["web", "folder-web"],
  ["windows", "folder-windows"],
  ["linux", "folder-linux"],
  ["macos", "folder-macos"],
  
  // Xamarin
  ["android", "folder-android"],
  ["ios", "folder-ios"],
  
  // .NET
  ["bin", "folder-net"],
  ["obj", "folder-net"],
  
  // C#
  
  // F#
  
  // VB.NET
  
  // TypeScript
  
  // JavaScript
  
  // CoffeeScript
  
  // LiveScript
  
  // PureScript
  
  // Elm
  
  // Reason
  
  // OCaml
  
  // Haskell
  
  // Clojure
  ["test", "folder-clojure"],
  
  // Scala
  ["test", "folder-scala"],
  
  // Kotlin
  ["test", "folder-kotlin"],
  
  // Java
  ["test", "folder-java"],
  
  // Groovy
  ["test", "folder-groovy"],
  
  // C/C++
  ["include", "folder-cpp"],
  ["lib", "folder-cpp"],
  
  // Rust
  ["tests", "folder-rust"],
  ["examples", "folder-rust"],
  ["benches", "folder-rust"],
  
  // Go
  ["cmd", "folder-go"],
  ["pkg", "folder-go"],
  ["internal", "folder-go"],
  
  // Swift
  ["Sources", "folder-swift"],
  ["Tests", "folder-swift"],
  
  // Objective-C
  
  // Dart
  ["lib", "folder-dart"],
  ["test", "folder-dart"],
  
  // Julia
  ["test", "folder-julia"],
  
  // R
  ["R", "folder-r"],
  ["tests", "folder-r"],
  
  // MATLAB
  
  // Perl
  ["lib", "folder-perl"],
  ["t", "folder-perl"],
  
  // PHP
  ["tests", "folder-php"],
  
  // Ruby
  ["lib", "folder-ruby"],
  ["test", "folder-ruby"],
  ["spec", "folder-ruby"],
  
  // Python
  ["tests", "folder-python"],
  ["test", "folder-python"],
  
  // Lua
  
  // Shell
  ["scripts", "folder-shell"],
  ["bin", "folder-shell"],
  
  // PowerShell
  ["tests", "folder-powershell"],
  
  // Batch
  ["scripts", "folder-batch"],
  
  // Make
  
  // CMake
  
  // Meson
  
  // Bazel
  
  // Buck
  
  // Pants
  
  // Please
  
  // Waf
  
  // SCons
  
  // Premake
  
  // XMake
  
  // Gradle
  
  // Maven
  
  // Ant
  
  // Ivy
  
  // Leiningen
  
  // Boot
  
  // Mix
  
  // Rebar
  
  // Erlang.mk
  
  // Cabal
  
  // Stack
  
  // Hpack
  
  // Cargo
  
  // Go Modules
  
  // Vendor
  ["vendor", "folder-vendor"],
  
  // Third-party
  ["third-party", "folder-third-party"],
  ["3rdparty", "folder-third-party"],
  
  // External
  ["external", "folder-external"],
  
  // Lib
  ["lib", "folder-lib"],
  ["libs", "folder-lib"],
  
  // Include
  ["include", "folder-include"],
  ["includes", "folder-include"],
  
  // Share
  ["share", "folder-shared"],
  ["shared", "folder-shared"],
  
  // Etc
  ["etc", "folder-etc"],
  
  // Var
  ["var", "folder-var"],
  
  // Opt
  ["opt", "folder-opt"],
  
  // Home
  ["home", "folder-home"],
  
  // Root
  ["root", "folder-root"],
  
  // User
  ["user", "folder-user"],
  
  // System
  ["system", "folder-system"],
  
  // Windows
  ["windows", "folder-windows"],
  
  // Program Files
  ["program files", "folder-program-files"],
  
  // Program Files (x86)
  ["program files (x86)", "folder-program-files-x86"],
  
  // ProgramData
  ["programdata", "folder-programdata"],
  
  // AppData
  ["appdata", "folder-appdata"],
  
  // LocalAppData
  ["localappdata", "folder-localappdata"],
  
  // Temp
  ["temp", "folder-temp"],
  
  // Tmp
  ["tmp", "folder-tmp"],
  
  // Desktop
  ["desktop", "folder-desktop"],
  
  // Documents
  ["documents", "folder-documents"],
  
  // Downloads
  ["downloads", "folder-downloads"],
  
  // Music
  ["music", "folder-music"],
  
  // Pictures
  ["pictures", "folder-pictures"],
  
  // Videos
  ["videos", "folder-videos"],
  
  // OneDrive
  ["onedrive", "folder-onedrive"],
  
  // Dropbox
  ["dropbox", "folder-dropbox"],
  
  // Google Drive
  ["google drive", "folder-google-drive"],
  
  // iCloud
  ["icloud", "folder-icloud"],
]);
