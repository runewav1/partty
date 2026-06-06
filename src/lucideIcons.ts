/**
 * Lucide icon fallback system for file tree icons.
 * Provides Lucide React-style SVG icons when Material icons are not available.
 */

import * as lucide from "lucide";

/**
 * Mapping of icon names to Lucide icon components.
 * Maps Material-style icon names to their Lucide equivalents.
 * Only uses actual Lucide icon names that exist in the library.
 */
const LUCIDE_ICON_MAP: Record<string, keyof typeof lucide> = {
  // File types
  "document": "File",
  "file": "File",
  "image": "Image",
  "video": "Video",
  "audio": "Music",
  "archive": "Archive",
  "zip": "Archive",
  "pdf": "FileText",
  "word": "FileText",
  "excel": "Table",
  "powerpoint": "Presentation",
  "database": "Database",
  
  // Programming languages (generic code icons)
  "javascript": "Code2",
  "typescript": "Code2",
  "react": "Code2",
  "vue": "Code2",
  "angular": "Code2",
  "svelte": "Code2",
  "python": "Code2",
  "rust": "Code2",
  "go": "Code2",
  "java": "Code2",
  "c": "Code2",
  "cpp": "Code2",
  "csharp": "Code2",
  "ruby": "Gem",
  "php": "Code2",
  "swift": "Code2",
  "kotlin": "Code2",
  "scala": "Code2",
  "haskell": "Code2",
  "clojure": "Code2",
  "erlang": "Code2",
  "elixir": "Code2",
  "lua": "Code2",
  "perl": "Code2",
  "r": "Code2",
  "matlab": "Code2",
  "julia": "Code2",
  
  // Config files
  "json": "Braces",
  "yaml": "Braces",
  "toml": "Braces",
  "xml": "CodeXml",
  "settings": "Settings",
  "filter": "Funnel",
  "env": "Key",
  "lock": "Lock",
  "git": "GitBranch",
  "docker": "Container",
  
  // Documentation
  "markdown": "FileText",
  "text": "FileText",
  "readme": "FileText",
  "license": "FileText",
  "changelog": "FileText",
  
  // Folders (basic)
  "folder": "Folder",
  "folder-base": "Folder",
  "folder-open": "FolderOpen",
  "folder-base-open": "FolderOpen",
  
  // More specific icons
  "html": "FileCode",
  "css": "FileJson",
  "scss": "FileJson",
  "sass": "FileJson",
  "less": "FileJson",
  "styl": "FileJson",
  "stylus": "FileJson",
  "svg": "Image",
  
  // Git related
  "gitignore": "XCircle",
  "gitattributes": "GitPullRequest",
  "gitmodules": "GitMerge",
  "gitkeep": "GitCommit",
  "gitconfig": "Settings",
  "gitlab": "GitBranch",
  "travis": "GitBranch",
  "circleci": "Circle",
  "appveyor": "Cloud",
  
  // IDE configs
  "vscode": "Code2",
  "idea": "Code2",
  "editorconfig": "Settings",
  
  // Cloud platforms
  "firebase": "Flame",
  "azure": "Cloud",
  "gcp": "Cloud",
  "heroku": "Cloud",
  "render": "Cloud",
  "railway": "Train",
  "fly": "Plane",
  "deno": "Dna",
  "netlify": "Upload",
  "vercel": "ArrowUp",
  "now": "Clock",
  "serverless": "Server",
  "terraform": "Box",
  "kubernetes": "Box",
  "helm": "Anchor",
  "ansible": "Terminal",
  "chef": "ChefHat",
  "salt": "Shuffle",
  "vagrant": "Box",
  "packer": "Package",
  
  // Package managers
  "npm": "Package",
  "yarn": "Package",
  "pnpm": "Package",
  "bun": "Zap",
  "composer": "Package",
  "pip": "Package",
  "poetry": "Feather",
  "cargo": "Package",
  "gradle": "Hammer",
  "maven": "Box",
  "mix": "Shuffle",
  "rebar": "Hammer",
  "cabal": "Box",
  "stack": "Layers",
  "hpack": "Box",
  "lerna": "GitBranch",
  "rush": "Zap",
  "nx": "Box",
  "turbo": "Zap",
  
  // Build tools
  "vite": "Zap",
  "webpack": "Box",
  "rollup": "Package",
  "babel": "Code2",
  "jest": "CheckCircle2",
  "vitest": "CheckCircle2",
  "cypress": "CheckCircle2",
  "playwright": "CheckCircle2",
  "puppeteer": "Bot",
  "eslint": "CheckSquare",
  "prettier": "CheckSquare",
  "stylelint": "CheckSquare",
  "tailwind": "Wind",
  "postcss": "Layers",
  "tsconfig": "FileJson",
  "jsconfig": "FileJson",
  "tsdoc": "FileText",
  "typedoc": "FileText",
  "ruff": "CheckSquare",
  "pyright": "CheckSquare",
  "mypy": "CheckSquare",
  "tox": "FlaskConical",
  "pytest": "CheckCircle2",
  "pylint": "CheckSquare",
  "black": "CheckSquare",
  "isort": "ArrowUpDown",
  "bandit": "Shield",
  "flake8": "CheckSquare",
  "autoflake": "Wind",
  "autopep8": "Wind",
  "yapf": "Wind",
  "pycodestyle": "CheckSquare",
  "rustfmt": "CheckSquare",
  "clippy": "CheckSquare",
  "rust-toolchain": "Hammer",
  "gopls": "Bot",
  "nodemon": "RefreshCw",
  "nvm": "Terminal",
  
  // Testing
  "test": "CheckCircle2",
  "spec": "CheckCircle2",
  "e2e": "CheckCircle2",
  "integration": "CheckCircle2",
  
  // Misc
  "makefile": "Terminal",
  "cmakelists": "Hammer",
  "robots": "Bot",
  "sitemap": "Map",
  "humans": "Users",
  "favicon": "Image",
  "browserconfig": "Globe",
  "manifest": "FileJson",
  "security": "Shield",
  "procfile": "Terminal",
  "rakefile": "Terminal",
  "gemfile": "Gem",
  "gemfile-lock": "Lock",
  
  // Generic fallbacks for custom folder names
  "folder-src": "Folder",
  "folder-dist": "Folder",
  "folder-test": "Folder",
  "folder-docs": "Folder",
  "folder-config": "Folder",
  "folder-node": "Folder",
  "folder-git": "Folder",
  "folder-github": "GitBranch",
  "folder-vscode": "Code2",
  "folder-intellij": "Code2",
  "folder-python": "Folder",
  "folder-rust": "Folder",
  "folder-go": "Folder",
  "folder-java": "Folder",
  "folder-kotlin": "Folder",
  "folder-scala": "Folder",
  "folder-ruby": "Folder",
  "folder-php": "Folder",
  "folder-html": "Folder",
  "folder-css": "Folder",
  "folder-js": "Folder",
  "folder-ts": "Folder",
  "folder-react": "Folder",
  "folder-vue": "Folder",
  "folder-angular": "Folder",
  "folder-svelte": "Folder",
  "folder-public": "Folder",
  "folder-assets": "Folder",
  "folder-components": "Folder",
  "folder-redux": "Folder",
  "folder-router": "Folder",
  "folder-api": "Folder",
  "folder-server": "Folder",
  "folder-database": "Folder",
  "folder-cache": "Folder",
  "folder-temp": "Folder",
  "folder-log": "Folder",
  "folder-font": "Folder",
  "folder-images": "Folder",
  "folder-video": "Folder",
  "folder-audio": "Folder",
  "folder-i18n": "Folder",
  "folder-theme": "Folder",
  "folder-plugin": "Folder",
  "folder-module": "Folder",
  "folder-package": "Folder",
  "folder-model": "Folder",
  "folder-controller": "Folder",
  "folder-service": "Folder",
  "folder-repo": "Folder",
  "folder-hooks": "Folder",
  "folder-middleware": "Folder",
  "folder-typescript": "Folder",
  "folder-types": "Folder",
  "folder-interfaces": "Folder",
  "folder-constants": "Folder",
  "folder-utils": "Folder",
  "folder-helpers": "Folder",
  "folder-tools": "Folder",
  "folder-scripts": "Folder",
  "folder-styles": "Folder",
  "folder-templates": "Folder",
  "folder-views": "Folder",
  "folder-pages": "Folder",
  "folder-layouts": "Folder",
  "folder-partials": "Folder",
  "folder-example": "Folder",
  "folder-sample": "Folder",
  "folder-demo": "Folder",
  "folder-storybook": "Folder",
  "folder-stencil": "Folder",
  "folder-supabase": "Folder",
  "folder-vercel": "Folder",
  "folder-netlify": "Folder",
  "folder-aws": "Folder",
  "folder-firebase": "Folder",
  "folder-docker": "Folder",
  "folder-kubernetes": "Folder",
  "folder-terraform": "Folder",
  "folder-ansible": "Folder",
  "folder-chef": "Folder",
  "folder-salt": "Folder",
  "folder-vagrant": "Folder",
  "folder-packer": "Folder",
  "folder-android": "Folder",
  "folder-ios": "Folder",
  "folder-electron": "Folder",
  "folder-src-tauri": "Folder",
  "folder-csharp": "Folder",
  "folder-fsharp": "Folder",
  "folder-vbnet": "Folder",
  "folder-javascript": "Folder",
  "folder-coffeescript": "Folder",
  "folder-livescript": "Folder",
  "folder-purescript": "Folder",
  "folder-elm": "Folder",
  "folder-reason": "Folder",
  "folder-ocaml": "Folder",
  "folder-haskell": "Folder",
  "folder-clojure": "Folder",
  "folder-cpp": "Folder",
  "folder-c": "Folder",
  "folder-objective-c": "Folder",
  "folder-dart": "Folder",
  "folder-julia": "Folder",
  "folder-r": "Folder",
  "folder-matlab": "Folder",
  "folder-perl": "Folder",
  "folder-lua": "Folder",
  "folder-shell": "Folder",
  "folder-powershell": "Folder",
  "folder-batch": "Folder",
  "folder-make": "Folder",
  "folder-cmake": "Folder",
  "folder-meson": "Folder",
  "folder-bazel": "Folder",
  "folder-buck": "Folder",
  "folder-pants": "Folder",
  "folder-please": "Folder",
  "folder-waf": "Folder",
  "folder-scons": "Folder",
  "folder-premake": "Folder",
  "folder-xmake": "Folder",
  "folder-maven": "Folder",
  "folder-ant": "Folder",
  "folder-ivy": "Folder",
  "folder-leiningen": "Folder",
  "folder-boot": "Folder",
  "folder-erlang-mk": "Folder",
  "folder-stack": "Folder",
  "folder-cargo": "Folder",
  "folder-go-mod": "Folder",
  "folder-vendor": "Folder",
  "folder-third-party": "Folder",
  "folder-external": "Folder",
  "folder-lib": "Folder",
  "folder-include": "Folder",
  "folder-share": "Folder",
  "folder-shared": "Folder",
  "folder-etc": "Folder",
  "folder-var": "Folder",
  "folder-opt": "Folder",
  "folder-home": "Folder",
  "folder-root": "Folder",
  "folder-user": "Folder",
  "folder-system": "Folder",
  "folder-windows": "Folder",
  "folder-program-files": "Folder",
  "folder-program-files-x86": "Folder",
  "folder-programdata": "Folder",
  "folder-appdata": "Folder",
  "folder-localappdata": "Folder",
  "folder-tmp": "Folder",
  "folder-desktop": "Folder",
  "folder-documents": "Folder",
  "folder-downloads": "Folder",
  "folder-music": "Folder",
  "folder-pictures": "Folder",
  "folder-videos": "Folder",
  "folder-onedrive": "Folder",
  "folder-dropbox": "Folder",
  "folder-google-drive": "Folder",
  "folder-icloud": "Folder",
};

/**
 * Create a Lucide icon SVG element for the given icon name.
 * Returns null if no matching Lucide icon is found.
 */
export function createLucideIcon(iconName: string): SVGElement | null {
  const lucideIconName = LUCIDE_ICON_MAP[iconName];
  if (!lucideIconName) return null;
  
  const IconComponent = (lucide as any)[lucideIconName];
  if (!IconComponent) return null;
  
  try {
    // Create SVG element from Lucide icon
    const svgString = IconComponent.toString();
    // Extract SVG content from the component string
    const match = svgString.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
    if (!match) return null;
    
    const svgContent = match[1];
    const svgElement = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgElement.innerHTML = svgContent;
    
    // Copy attributes from the original SVG
    const attrMatch = svgString.match(/<svg([^>]*)>/);
    if (attrMatch) {
      const attrs = attrMatch[1].split(/\s+/).filter(Boolean);
      attrs.forEach((attr: string) => {
        const [name, ...valueParts] = attr.split("=");
        const value = valueParts.join("=").replace(/['"]/g, "");
        if (name && value) {
          svgElement.setAttribute(name, value);
        }
      });
    }
    
    // Set consistent styling
    svgElement.setAttribute("width", "16");
    svgElement.setAttribute("height", "16");
    svgElement.setAttribute("viewBox", "0 0 24 24");
    svgElement.setAttribute("fill", "none");
    svgElement.setAttribute("stroke", "currentColor");
    svgElement.setAttribute("stroke-width", "2");
    svgElement.setAttribute("stroke-linecap", "round");
    svgElement.setAttribute("stroke-linejoin", "round");
    svgElement.classList.add("file-tree-icon-lucide");
    
    return svgElement;
  } catch {
    return null;
  }
}
