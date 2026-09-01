/**
 * Restores `localStorage` under jsdom.
 *
 * Node 22+ ships its own `localStorage` global, unavailable unless the process
 * is started with `--localstorage-file`. It lands on the jsdom window as an
 * `undefined` own property and shadows the implementation jsdom would have
 * provided, so anything reading it throws. This puts a working one back.
 *
 * Kept to the `Storage` interface rather than a bare object so tests can spy on
 * the instance the way they would in a browser.
 */
class MemoryStorage implements Storage {
  #entries = new Map<string, string>()

  get length(): number {
    return this.#entries.size
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.#entries.set(key, value)
  }

  removeItem(key: string): void {
    this.#entries.delete(key)
  }

  clear(): void {
    this.#entries.clear()
  }
}

/*
 * Read through an index signature, because the DOM types insist
 * `window.localStorage` is always a `Storage` — which is exactly the claim that
 * is false here, and what makes the missing value so easy to miss.
 */
const win = window as unknown as Record<string, Storage | undefined>

for (const name of ['localStorage', 'sessionStorage']) {
  if (win[name] == null) {
    Object.defineProperty(window, name, { value: new MemoryStorage(), configurable: true })
  }
}
