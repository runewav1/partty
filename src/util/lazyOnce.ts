export type LazyCell<T> = {
  get(): T | null;
  ensure(factory: () => Promise<T | null>): Promise<T | null>;
};

/** Single-flight lazy init — factory runs at most once. */
export function lazyCell<T>(): LazyCell<T> {
  let value: T | null = null;
  let pending: Promise<T | null> | null = null;
  return {
    get() {
      return value;
    },
    ensure(factory) {
      if (value) return Promise.resolve(value);
      if (!pending) {
        pending = factory().then((v) => {
          value = v;
          return v;
        });
      }
      return pending;
    },
  };
}

export function runLazy<T>(
  ensure: () => Promise<T | null>,
  run: (value: T) => void,
): void {
  void ensure().then((v) => {
    if (v) run(v);
  });
}
