// Web Worker entry: receives padded sample blocks, returns transferable meshes.
import { meshBlock, type ChunkMesh } from "./mesher";

export interface MeshRequest {
  id: number;
  block: Uint8Array;
}
export interface MeshResponse {
  id: number;
  mesh: ChunkMesh;
}

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<MeshRequest>) => void) | null;
  postMessage(msg: MeshResponse, transfer: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const mesh = meshBlock(e.data.block);
  ctx.postMessage({ id: e.data.id, mesh }, [
    mesh.positions.buffer,
    mesh.normals.buffer,
    mesh.indices.buffer,
  ]);
};
