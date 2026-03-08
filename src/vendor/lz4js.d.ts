declare module "lz4js" {
  export function compressBound(n: number): number;
  export function decompressBound(src: Uint8Array): number;
  export function makeBuffer(length: number): Uint8Array;
  export function decompressBlock(
    src: Uint8Array,
    dst: Uint8Array,
    sIndex: number,
    sLength: number,
    dIndex: number,
  ): number;
  export function compressBlock(
    src: Uint8Array,
    dst: Uint8Array,
    sIndex: number,
    sLength: number,
    hashTable: Uint32Array,
  ): number;
  export function decompressFrame(
    src: Uint8Array,
    dst: Uint8Array,
  ): Uint8Array;
  export function compressFrame(
    src: Uint8Array,
    dst: Uint8Array,
  ): Uint8Array;
  export function decompress(
    src: Uint8Array | ArrayBufferLike,
    maxSize?: number,
  ): Uint8Array;
  export function compress(
    src: Uint8Array,
    maxSize?: number,
  ): Uint8Array;
}
