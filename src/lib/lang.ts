import type { Extension } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'

/** 特殊文件名（无扩展名或扩展名不直观）→ 语言 */
const byFileName: Record<string, () => Promise<Extension>> = {
  dockerfile: async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/dockerfile')).dockerFile),
  cmakelists: async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/cmake')).cmake),
  'nginx.conf': async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/nginx')).nginx),
  '.editorconfig': async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/properties')).properties),
  '.gitattributes': async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/properties')).properties),
  '.gitignore': async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/properties')).properties),
  '.gitmodules': async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/properties')).properties),
  '.dockerignore': async () =>
    StreamLanguage.define((await import('@codemirror/legacy-modes/mode/properties')).properties),
}

/** 按扩展名加载对应的代码高亮语言；无法识别的文件保持默认文本配色 */
export async function languageFor(file: string): Promise<Extension> {
  const name = (file.split('/').pop() || '').toLowerCase()
  if (byFileName[name]) return byFileName[name]()

  const ext = (name.split('.').pop() || '').toLowerCase()
  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return (await import('@codemirror/lang-javascript')).javascript({ jsx: ext === 'jsx' })
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return (await import('@codemirror/lang-javascript')).javascript({
        typescript: true,
        jsx: ext === 'tsx',
      })
    case 'json':
    case 'jsonc':
    case 'json5':
      return (await import('@codemirror/lang-json')).json()
    case 'css':
      return (await import('@codemirror/lang-css')).css()
    case 'scss':
    case 'less':
      return (await import('@codemirror/lang-css')).css()
    case 'sass':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/sass')).sass)
    case 'styl':
    case 'stylus':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/stylus')).stylus)
    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
    case 'astro':
      return (await import('@codemirror/lang-html')).html()
    case 'md':
    case 'markdown':
    case 'mdx':
      return (await import('@codemirror/lang-markdown')).markdown()
    case 'py':
    case 'pyw':
      return (await import('@codemirror/lang-python')).python()
    case 'java':
      return (await import('@codemirror/lang-java')).java()
    case 'cs':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).csharp)
    case 'kt':
    case 'kts':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).kotlin)
    case 'scala':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).scala)
    case 'dart':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clike')).dart)
    case 'rs':
      return (await import('@codemirror/lang-rust')).rust()
    case 'c':
    case 'h':
    case 'cc':
    case 'cpp':
    case 'cxx':
    case 'hpp':
    case 'hh':
      return (await import('@codemirror/lang-cpp')).cpp()
    case 'go':
      return (await import('@codemirror/lang-go')).go()
    case 'sql':
      return (await import('@codemirror/lang-sql')).sql()
    case 'xml':
    case 'svg':
    case 'xaml':
    case 'axaml':
    case 'csproj':
    case 'props':
    case 'targets':
    case 'plist':
    case 'config':
      return (await import('@codemirror/lang-xml')).xml()
    case 'yml':
    case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml()
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'ksh':
    case 'shell':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/shell')).shell)
    case 'ps1':
    case 'psm1':
    case 'psd1':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/powershell')).powerShell)
    case 'toml':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/toml')).toml)
    case 'ini':
    case 'cfg':
    case 'conf':
    case 'properties':
    case 'env':
    case 'prefs':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/properties')).properties)
    case 'php':
    case 'phtml':
      return (await import('@codemirror/lang-php')).php()
    case 'lua':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/lua')).lua)
    case 'rb':
    case 'rake':
    case 'gemspec':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/ruby')).ruby)
    case 'pl':
    case 'pm':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/perl')).perl)
    case 'r':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/r')).r)
    case 'jl':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/julia')).julia)
    case 'swift':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/swift')).swift)
    case 'vb':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/vb')).vb)
    case 'groovy':
    case 'gradle':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/groovy')).groovy)
    case 'pas':
    case 'pp':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/pascal')).pascal)
    case 'hs':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/haskell')).haskell)
    case 'clj':
    case 'cljs':
    case 'cljc':
    case 'edn':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/clojure')).clojure)
    case 'coffee':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/coffeescript')).coffeeScript)
    case 'pug':
    case 'jade':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/pug')).pug)
    case 'j2':
    case 'jinja':
    case 'jinja2':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/jinja2')).jinja2)
    case 'proto':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/protobuf')).protobuf)
    case 'diff':
    case 'patch':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/diff')).diff)
    case 'http':
    case 'rest':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/http')).http)
    case 'feature':
      return StreamLanguage.define((await import('@codemirror/legacy-modes/mode/gherkin')).gherkin)
    default:
      return []
  }
}
