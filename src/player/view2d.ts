/**
 * Phase 7 — 2D view of the OmniStage Player. Runs the exact studio frame (`stepStage2D`) on a letterboxed
 * 1000x600 canvas, so physics, logic graph, particles, spritesheets and captions match the editor.
 */
import { DESIGN_HEIGHT, DESIGN_WIDTH, RuntimeLogicGraph } from '../runtime/logicGraph';
import { hitTest2D, RuntimeBody2D, stepStage2D, toDesignCoords } from '../runtime/stage2d';
import { runtimeStore } from '../runtime/host';
import type { InputManager } from './input';

export class View2D {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bodies: Record<string, RuntimeBody2D> = {};
  private images: Record<string, HTMLImageElement> = {};
  private sceneId = '';

  /** Phase 7C: live physics positions (E2E tests / debugging); the SceneSpec keeps authored positions. */
  bodyPositions(): Record<string, { x: number; y: number; collected: boolean }> {
    const out: Record<string, { x: number; y: number; collected: boolean }> = {};
    for (const [id, b] of Object.entries(this.bodies)) out[id] = { x: b.x, y: b.y, collected: !!b.collected };
    return out;
  }

  constructor(parent: HTMLElement, private runtime: RuntimeLogicGraph, private input: InputManager, private resolveUrl: (url: string) => string) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = DESIGN_WIDTH;
    this.canvas.height = DESIGN_HEIGHT;
    this.canvas.className = 'omni-stage omni-stage-2d';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.canvas.addEventListener('pointerdown', this.onPointer);
  }

  private onPointer = (e: PointerEvent) => {
    const { x, y } = toDesignCoords(e.clientX, e.clientY, this.canvas.getBoundingClientRect());
    const hit = hitTest2D(x, y, this.bodies);
    if (hit && runtimeStore.getState().isPlaying) this.runtime.emit('actor-click', { actorId: hit.id });
  };

  /** Images (sprites, library assets) can be embedded in the export as data URIs. */
  private patchImageCache() {
    for (const n of runtimeStore.getState().sceneSpec.nodes2D) {
      if (!n.imageUrl || this.images[n.imageUrl]) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = this.resolveUrl(n.imageUrl);
      this.images[n.imageUrl] = img;
    }
  }

  frame(dt: number) {
    const id = runtimeStore.getState().sceneSpec.id;
    if (id !== this.sceneId) {
      this.sceneId = id;
      this.bodies = {};
    }
    this.patchImageCache();
    stepStage2D(this.ctx, dt, this.input.keys, this.bodies, this.images, this.runtime, { showGrid: false, selectedId: null });
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this.onPointer);
    this.canvas.remove();
  }
}
