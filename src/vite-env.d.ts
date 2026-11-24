/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 开发期数据桥地址，默认 http://127.0.0.1:7717 */
  readonly VITE_API?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
