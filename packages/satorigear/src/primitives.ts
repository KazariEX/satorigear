export const emptyArray: ReadonlyArray<any> = [];
export const emptySet: ReadonlySet<any> = new Set();

export function shiftTail(items: unknown[], oldEnd: number, newEnd: number): void {
  const length = items.length;
  if (newEnd > oldEnd) {
    items.length += newEnd - oldEnd;
    items.copyWithin(newEnd, oldEnd, length);
  }
  else if (newEnd < oldEnd) {
    items.copyWithin(newEnd, oldEnd);
    items.length -= oldEnd - newEnd;
  }
}
