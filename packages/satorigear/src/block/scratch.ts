import type { Buffer } from "node:buffer";

// eslint-disable-next-line node/prefer-global/buffer
const allocate = globalThis.Buffer?.allocUnsafeSlow;

/** Shared low bytes of the current synchronous physical line scan. */
export class ScratchView {
  static bytes: Buffer;
  static words: Uint32Array;

  static supports = allocate !== void 0;

  static prepare(sourceLength: number): number {
    const wordLimit = sourceLength + 31 & ~31;
    if (!this.bytes || this.bytes.length < wordLimit) {
      this.bytes = allocate(wordLimit);
      this.words = new Uint32Array(this.bytes.buffer, this.bytes.byteOffset, wordLimit >>> 2);
    }
    for (let i = 1; i <= 8; i++) {
      this.words[(wordLimit >>> 2) - i] = 0x20202020;
    }
    return wordLimit;
  }
}
