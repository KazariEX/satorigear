export const emptyArray: ReadonlyArray<any> = [];
export const emptySet: ReadonlySet<any> = new Set();

export function isArrayEqual<T>(foo: readonly T[], bar: readonly T[]): boolean {
  if (foo.length !== bar.length) {
    return false;
  }
  for (let i = 0; i < foo.length; i++) {
    if (foo[i] !== bar[i]) {
      return false;
    }
  }
  return true;
}

export function isSetEqual<T>(foo: ReadonlySet<T>, bar: ReadonlySet<T>): boolean {
  if (foo.size !== bar.size) {
    return false;
  }
  for (const val of foo) {
    if (!bar.has(val)) {
      return false;
    }
  }
  return true;
}
