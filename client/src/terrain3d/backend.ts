import { meshBlock, type ChunkMesh } from "./mesher";
import type { MeshRequest, MeshResponse } from "./meshWorker";

/** Meshes padded blocks; the worker backend is async, the sync one is for tests and fallback. */
export interface MeshBackend {
  mesh(block: Uint8Array): Promise<ChunkMesh>;
  dispose(): void;
}

export class SyncMeshBackend implements MeshBackend {
  mesh(block: Uint8Array): Promise<ChunkMesh> {
    return Promise.resolve(meshBlock(block));
  }
  dispose(): void {}
}

/** One Web Worker; requests are matched by id. */
export class WorkerMeshBackend implements MeshBackend {
  private readonly worker = new Worker(new URL("./meshWorker.ts", import.meta.url), {
    type: "module",
  });
  private readonly pending = new Map<number, (m: ChunkMesh) => void>();
  private nextId = 1;

  constructor() {
    this.worker.onmessage = (e: MessageEvent<MeshResponse>) => {
      const done = this.pending.get(e.data.id);
      this.pending.delete(e.data.id);
      done?.(e.data.mesh);
    };
  }

  mesh(block: Uint8Array): Promise<ChunkMesh> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      const msg: MeshRequest = { id, block };
      this.worker.postMessage(msg, [block.buffer]);
    });
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}
