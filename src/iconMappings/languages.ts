/**
 * Programming language file extensions to icon mapping.
 */

export const LANGUAGE_EXTENSIONS: Map<string, string> = new Map([
  // JavaScript/TypeScript
  ["js", "javascript"],
  ["jsx", "react"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["ts", "typescript"],
  ["tsx", "react_ts"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  
  // Web
  ["html", "html"],
  ["htm", "html"],
  ["css", "css"],
  ["scss", "sass"],
  ["sass", "sass"],
  ["less", "less"],
  ["styl", "stylus"],
  ["vue", "vue"],
  ["svelte", "svelte"],
  ["angular", "angular"],
  
  // Rust
  ["rs", "rust"],
  
  // Go
  ["go", "go"],
  
  // Python
  ["py", "python"],
  ["pyx", "python"],
  ["pyi", "python"],
  
  // Java/Kotlin
  ["java", "java"],
  ["jar", "jar"],
  ["class", "javaclass"],
  ["kt", "kotlin"],
  ["kts", "kotlin"],
  
  // Scala
  ["scala", "scala"],
  ["sc", "scala"],
  
  // Swift
  ["swift", "swift"],
  
  // C/C++/Objective-C
  ["c", "c"],
  ["cpp", "cpp"],
  ["cc", "cpp"],
  ["cxx", "cpp"],
  ["h", "c"],
  ["hpp", "hpp"],
  ["hxx", "hpp"],
  ["m", "objective-c"],
  ["mm", "objective-cpp"],
  
  // C#
  ["cs", "csharp"],
  
  // F#
  ["fs", "fsharp"],
  ["fsi", "fsharp"],
  ["fsx", "fsharp"],
  
  // PHP
  ["php", "php"],
  ["phtml", "php"],
  
  // Ruby
  ["rb", "ruby"],
  ["gemspec", "ruby"],
  ["rake", "ruby"],
  
  // Lua
  ["lua", "lua"],
  
  // Elixir/Erlang
  ["ex", "elixir"],
  ["exs", "elixir"],
  ["erl", "erlang"],
  ["hrl", "erlang"],
  
  // Clojure
  ["clj", "clojure"],
  ["cljs", "clojure"],
  ["cljc", "clojure"],
  
  // Haskell
  ["hs", "haskell"],
  ["lhs", "haskell"],
  
  // OCaml
  ["ml", "ocaml"],
  ["mli", "ocaml"],
  
  // Nim
  ["nim", "nim"],
  
  // Crystal
  ["cr", "crystal"],
  
  // Dart
  ["dart", "dart"],
  
  // Julia
  ["jl", "julia"],
  
  // R
  ["r", "r"],
  ["rmd", "r"],
  
  // MATLAB
  ["matlab", "matlab"],
  
  // Perl
  ["pl", "perl"],
  ["pm", "perl"],
  ["t", "perl"],
  
  // Shell
  ["sh", "bash"],
  ["bash", "bash"],
  ["zsh", "shell"],
  ["fish", "fish"],
  ["ps1", "powershell"],
  ["psm1", "powershell"],
  
  // Batch
  ["bat", "bat"],
  ["cmd", "bat"],
  ["vbs", "visualstudio"],
  
  // Assembly
  ["asm", "assembly"],
  ["s", "assembly"],
  
  // ActionScript
  ["as", "actionscript"],
  ["swf", "actionscript"],
  
  // Ada
  ["ada", "ada"],
  ["adb", "ada"],
  ["ads", "ada"],
  
  // ABAP
  ["abap", "abap"],
  
  // Apex
  ["cls", "salesforce"],
  
  // AppleScript
  ["applescript", "applescript"],
  
  // AutoHotkey
  ["ahk", "autohotkey"],
  
  // AutoIt
  ["au3", "autoit"],
  
  // Ballerina
  ["bal", "ballerina"],
  
  // Blitz
  ["bb", "blitz"],
  
  // Brainfuck
  ["bf", "brainfuck"],
  
  // CMake
  ["cmake", "cmake"],
  
  // COBOL
  ["cob", "cobol"],
  ["cbl", "cobol"],
  ["cpy", "cobol"],
  
  // ColdFusion
  ["cfm", "coldfusion"],
  ["cfc", "coldfusion"],
  
  // CoffeeScript
  ["coffee", "coffeescript"],
  
  // Crystal
  ["cr", "crystal"],
  
  // D
  ["d", "d"],
  ["di", "d"],
  
  // Delphi
  ["pas", "delphi"],
  ["pp", "delphi"],
  
  // E
  ["e", "e"],
  
  // Elm
  ["elm", "elm"],
  
  // Emacs Lisp
  ["el", "elisp"],
  
  // Erlang
  ["erl", "erlang"],
  ["hrl", "erlang"],
  
  // F*
  ["fst", "fstar"],
  
  // Factor
  ["factor", "factor"],
  
  // Fantom
  ["fan", "fantom"],
  
  // Forth
  ["fs", "forth"],
  ["fth", "forth"],
  
  // Fortran
  ["f", "fortran"],
  ["f77", "fortran"],
  ["f90", "fortran"],
  ["f95", "fortran"],
  ["f03", "fortran"],
  
  // FoxPro
  ["prg", "foxpro"],
  
  // FreeMarker
  ["ftl", "freemarker"],
  
  // GDScript
  ["gd", "godot"],
  
  // GLSL
  ["glsl", "shader"],
  ["vert", "shader"],
  ["frag", "shader"],
  ["geom", "shader"],
  
  // Groovy
  ["groovy", "groovy"],
  ["gvy", "groovy"],
  ["gy", "groovy"],
  ["gsh", "groovy"],
  
  // Hack
  ["hh", "hack"],
  ["php", "hack"],
  
  // Harbour
  ["prg", "harbour"],
  
  // HLSL
  ["hlsl", "shader"],
  
  // HolyC
  ["hc", "holyc"],
  
  // IDL
  ["idl", "idl"],
  ["pro", "idl"],
  
  // Idris
  ["idr", "idris"],
  ["lidr", "idris"],
  
  // Io
  ["io", "io"],
  
  // Ioke
  ["ik", "ioke"],
  
  // J
  ["ijs", "j"],
  
  // Janet
  ["janet", "janet"],
  
  // Jolie
  ["ol", "jolie"],
  ["iol", "jolie"],
  
  // JSON5
  ["json5", "json"],
  
  // JSONC
  ["jsonc", "json"],
  
  // JSON Schema
  ["json_schema", "json"],
  
  // Julia
  ["jl", "julia"],
  
  // Kotlin
  ["kt", "kotlin"],
  ["kts", "kotlin"],
  
  // Kusto
  ["kql", "kusto"],
  ["kusto", "kusto"],
  
  // Lasso
  ["lasso", "lasso"],
  ["lasso8", "lasso"],
  ["lasso9", "lasso"],
  
  // LiveScript
  ["ls", "livescript"],
  
  // Logo
  ["lgo", "logo"],
  
  // Logtalk
  ["lgt", "logtalk"],
  
  // Lua
  ["lua", "lua"],
  
  // M
  ["m", "objective-c"],
  
  // MATLAB
  ["matlab", "matlab"],
  
  // MEL
  ["mel", "mel"],
  
  // Mercury
  ["m", "mercury"],
  ["mercury", "mercury"],
  
  // Metaprogramming
  ["meta", "meta"],
  
  // Minecraft
  ["mcfunction", "minecraft"],
  ["mcmeta", "minecraft"],
  
  // ML
  ["ml", "ocaml"],
  ["mli", "ocaml"],
  
  // Modelica
  ["mo", "modelica"],
  
  // Modula-2
  ["mod", "modula-2"],
  ["def", "modula-2"],
  
  // Monkey
  ["monkey", "monkey"],
  
  // MoonScript
  ["moon", "moonscript"],
  
  // N
  ["n", "n"],
  
  // NASM
  ["asm", "assembly"],
  ["nasm", "assembly"],
  
  // NEON
  ["neon", "neon"],
  
  // Nemerle
  ["n", "nemerle"],
  
  // NEScript
  ["nes", "nescript"],
  
  // NewLisp
  ["lsp", "newlisp"],
  
  // Nextflow
  ["nf", "nextflow"],
  
  // Nginx
  ["nginx", "nginx"],
  ["conf", "nginx"],
  
  // Nim
  ["nim", "nim"],
  ["nims", "nim"],
  
  // Nit
  ["nit", "nit"],
  
  // Nix
  ["nix", "nix"],
  
  // NSIS
  ["nsi", "nsis"],
  ["nsh", "nsis"],
  
  // Nu
  ["nu", "nu"],
  
  // NumPy
  ["npy", "python"],
  
  // Objective-C
  ["m", "objective-c"],
  
  // Objective-C++
  ["mm", "objective-cpp"],
  
  // OCaml
  ["ml", "ocaml"],
  ["mli", "ocaml"],
  
  // Octave
  ["m", "matlab"],
  
  // Odin
  ["odin", "odin"],
  
  // Omgrofl
  ["omgrofl", "omgrofl"],
  
  // Opa
  ["opa", "opa"],
  
  // Opal
  ["opal", "opal"],
  
  // OpenSCAD
  ["scad", "openscad"],
  
  // Ox
  ["ox", "ox"],
  ["oxh", "ox"],
  ["oxo", "ox"],
  
  // Oz
  ["oz", "oz"],
  
  // P
  ["p", "p"],
  
  // Pan
  ["pan", "pan"],
  
  // Parrot
  ["pir", "parrot"],
  ["pasm", "parrot"],
  
  // Pascal
  ["pas", "pascal"],
  ["pp", "pascal"],
  
  // Pawn
  ["pawn", "pawn"],
  
  // Perl
  ["pl", "perl"],
  ["pm", "perl"],
  ["t", "perl"],
  
  // Perl 6
  ["p6", "perl"],
  ["pm6", "perl"],
  ["pod6", "perl"],
  
  // PHP
  ["php", "php"],
  ["phtml", "php"],
  
  // Pig
  ["pig", "pig"],
  
  // Pike
  ["pike", "pike"],
  
  // PL/SQL
  ["pls", "database"],
  
  // Pogoscript
  ["pogo", "pogoscript"],
  
  // Pony
  ["pony", "pony"],
  
  // PostScript
  ["ps", "postscript"],
  ["eps", "postscript"],
  
  // PowerBuilder
  ["pbl", "powerbuilder"],
  ["pbt", "powerbuilder"],
  
  // PowerShell
  ["ps1", "powershell"],
  ["psm1", "powershell"],
  ["psd1", "powershell"],
  
  // Processing
  ["pde", "processing"],
  
  // Prolog
  ["pl", "prolog"],
  ["pro", "prolog"],
  
  // Propeller Spin
  ["spin", "propeller"],
  
  // Pug
  ["pug", "pug"],
  ["jade", "pug"],
  
  // Puppet
  ["pp", "puppet"],
  
  // PureBasic
  ["pb", "purebasic"],
  
  // PureScript
  ["purs", "purescript"],
  
  // Python
  ["py", "python"],
  ["pyw", "python"],
  ["pyi", "python"],
  
  // Q#
  ["qs", "qsharp"],
  
  // QML
  ["qml", "qml"],
  
  // R
  ["r", "r"],
  ["rmd", "r"],
  
  // Racket
  ["rkt", "racket"],
  ["rkl", "racket"],
  
  // Raku
  ["raku", "raku"],
  ["rakumod", "raku"],
  ["rakutest", "raku"],
  
  // Reason
  ["re", "reason"],
  ["rei", "reason"],
  
  // Red
  ["red", "red"],
  ["reds", "red"],
  
  // Ren'Py
  ["rpy", "renpy"],
  
  // REBOL
  ["r", "rebol"],
  ["reb", "rebol"],
  
  // Ring
  ["ring", "ring"],
  
  // Riot
  ["tag", "riot"],
  
  // Robot Framework
  ["robot", "robot"],
  
  // RON
  ["ron", "ron"],
  
  // Ruby
  ["rb", "ruby"],
  ["rbw", "ruby"],
  
  // Rust
  ["rs", "rust"],
  
  // Sage
  ["sage", "sage"],
  
  // Salt
  ["sls", "salt"],
  
  // SAS
  ["sas", "sas"],
  
  // Scala
  ["scala", "scala"],
  ["sc", "scala"],
  
  // Scheme
  ["scm", "scheme"],
  ["ss", "scheme"],
  
  // SCons
  ["sconstruct", "scons"],
  ["sconscript", "scons"],
  
  // Sed
  ["sed", "sed"],
  
  // Self
  ["self", "self"],
  
  // ShaderLab
  ["shader", "shader"],
  
  // Shell
  ["sh", "bash"],
  ["bash", "bash"],
  
  // Shen
  ["shen", "shen"],
  
  // Slash
  ["sl", "slash"],
  
  // Smalltalk
  ["st", "smalltalk"],
  ["cs", "smalltalk"],
  
  // Smarty
  ["tpl", "smarty"],
  
  // Solidity
  ["sol", "solidity"],
  
  // SPARQL
  ["rq", "rdf"],
  ["sparql", "rdf"],
  
  // Spline
  ["spline", "spline"],
  
  // SQF
  ["sqf", "sqf"],
  
  // SQL
  ["sql", "database"],
  
  // SRecode Template
  ["srt", "srecode"],
  
  // Stan
  ["stan", "stan"],
  
  // Standard ML
  ["sml", "sml"],
  ["sig", "sml"],
  
  // Stata
  ["do", "stata"],
  ["ado", "stata"],
  
  // Stylus
  ["styl", "stylus"],
  
  // SubRip Text
  ["srt", "subtitles"],
  
  // SugarSS
  ["sugar", "sugarss"],
  
  // SuperCollider
  ["sc", "supercollider"],
  ["scd", "supercollider"],
  
  // SVG
  ["svg", "svg"],
  
  // Swift
  ["swift", "swift"],
  
  // SWIG
  ["i", "swig"],
  
  // SystemVerilog
  ["sv", "verilog"],
  ["svh", "verilog"],
  
  // Tcl
  ["tcl", "tcl"],
  
  // Tera Term macro
  ["ttl", "teraterm"],
  
  // Terraform
  ["tf", "terraform"],
  ["tfvars", "terraform"],
  
  // TeX
  ["tex", "tex"],
  
  // Text
  ["txt", "text"],
  
  // Thrift
  ["thrift", "thrift"],
  
  // TI-BASIC
  ["8xp", "ti-basic"],
  
  // TLA
  ["tla", "tla"],
  
  // TOML
  ["toml", "toml"],
  
  // TrueType
  ["ttf", "font"],
  
  // TypeScript
  ["ts", "typescript"],
  ["tsx", "react_ts"],
  
  // TypeScript-React
  ["tsx", "react_ts"],
  
  // TypeScript-Def
  ["d.ts", "typescript-def"],
  
  // UnrealScript
  ["uc", "unrealscript"],
  
  // Ur/Web
  ["ur", "urweb"],
  ["urs", "urweb"],
  
  // V
  ["v", "vlang"],
  ["vsh", "vlang"],
  ["sv", "vlang"],
  
  // Vala
  ["vala", "vala"],
  ["vapi", "vala"],
  
  // VBA
  ["vb", "visualstudio"],
  ["vba", "visualstudio"],
  
  // VBScript
  ["vbs", "visualstudio"],
  
  // Velocity
  ["vm", "velocity"],
  ["vtl", "velocity"],
  
  // Verilog
  ["v", "verilog"],
  ["vh", "verilog"],
  
  // VHDL
  ["vhd", "vhdl"],
  ["vhdl", "vhdl"],
  
  // Vim script
  ["vim", "vim"],
  ["vimrc", "vim"],
  
  // Visual Basic
  ["vb", "visualstudio"],
  ["vbs", "visualstudio"],
  
  // Visual Basic .NET
  ["vb", "visualstudio"],
  
  // Volt
  ["volt", "volt"],
  
  // Vue
  ["vue", "vue"],
  
  // WebAssembly
  ["wasm", "webassembly"],
  ["wat", "webassembly"],
  
  // WebIDL
  ["webidl", "webidl"],
  
  // Whiley
  ["whiley", "whiley"],
  
  // XAML
  ["xaml", "xaml"],
  
  // XQuery
  ["xq", "xml"],
  ["xql", "xml"],
  ["xqm", "xml"],
  
  // XSLT
  ["xsl", "xml"],
  ["xslt", "xml"],
  
  // XProc
  ["xpl", "xml"],
  
  // XSpec
  ["xspec", "xspec"],
  
  // YARA
  ["yara", "yara"],
  
  // YASnippet
  ["yasnippet", "yasnippet"],
  
  // YML
  ["yml", "yaml"],
  
  // Zephir
  ["zep", "zephir"],
  
  // Zig
  ["zig", "zig"],
  
  // ZIL
  ["zil", "zil"],
  
  // ZK
  ["zk", "zk"],
  
  // Zope
  ["zcml", "zope"],
  
  // ZPT
  ["pt", "zpt"],
  
  // ZQL
  ["zql", "zql"],
]);
