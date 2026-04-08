import '@testing-library/jest-dom'

// crypto.randomUUID polyfill for jsdom
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
    })
  })
}

// CSS.escape polyfill
if (!globalThis.CSS?.escape) {
  globalThis.CSS = { escape: (s: string) => s.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&') } as typeof CSS
}
