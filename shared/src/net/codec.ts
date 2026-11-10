// The only place wire frames are encoded and decoded. JSON in v1.
// Swap the body of these two functions for a binary codec later; callers
// must not call JSON.parse/JSON.stringify on wire data themselves.

export class CodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodecError";
  }
}

export type WireFrame = string | Uint8Array | ArrayBuffer;

const decoder = new TextDecoder("utf-8", { fatal: true });

export function encode(msg: object): string {
  return JSON.stringify(msg);
}

/** Decode a frame into an untrusted value. Validate it before use. */
export function decode(frame: WireFrame): unknown {
  let text: string;
  try {
    text =
      typeof frame === "string"
        ? frame
        : decoder.decode(frame instanceof ArrayBuffer ? new Uint8Array(frame) : frame);
  } catch {
    throw new CodecError("frame is not valid utf-8");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CodecError("frame is not valid JSON");
  }
}
