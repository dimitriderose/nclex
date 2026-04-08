/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BUNDLED_CONTENT_SHA256: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
