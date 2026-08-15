export const emptyArray: ReadonlyArray<any> = [];
export const emptySet: ReadonlySet<any> = new Set();

export function isArrayEqual<T>(foo: ReadonlyArray<T>, bar: ReadonlyArray<T>): boolean {
  if (foo.length !== bar.length) {
    return false;
  }
  for (let index = 0; index < foo.length; index++) {
    if (foo[index] !== bar[index]) {
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
