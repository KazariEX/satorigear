export const emptyArray: ReadonlyArray<any> = [];
export const emptySet: ReadonlySet<any> = new Set();

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
