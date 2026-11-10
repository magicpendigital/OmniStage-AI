import React, { useEffect, useRef, useState } from 'react';
import { useStudioStore } from '../state/useStudioStore';
import { EngineType } from '../types/scene.schema';
import { DESIGN_HEIGHT, DESIGN_WIDTH, findLogicContacts, RuntimeLogicGraph } from '../runtime/logicGraph';
import { displayedPosition2D, hitTest2D, RuntimeBody2D, stepStage2D, toDesignCoords } from '../runtime/stage2d';

// Phase 7: the interpreter and the 2D frame live in src/runtime (shared with the OmniStage Player).
export { findLogicContacts, RuntimeLogicGraph } from '../runtime/logicGraph';

const sharedRuntimes = new Map<EngineType, RuntimeLogicGraph>();
let mountedStages = 0;
let detachedFrame: number | undefined;
let detachedDisposed = false;
function sharedRuntime(engine: EngineType) {
  if (!sharedRuntimes.has(engine)) sharedRuntimes.set(engine, new RuntimeLogicGraph(engine));
  return sharedRuntimes.get(engine)!;
}

// The graph-only workspace unmounts both stages. Keep graph time/events alive
// there, and retain interpreter state when switching between viewport and split.
function updateDetachedRuntime() {
  if (detachedDisposed || typeof window === 'undefined') return;
  if (mountedStages || !useStudioStore.getState().isPlaying) {
    if (detachedFrame !== undefined) cancelAnimationFrame(detachedFrame);
    detachedFrame = undefined;
    return;
  }
  if (detachedFrame !== undefined) return;
  let lastTime = performance.now();
  const frame = (now: number) => {
    detachedFrame = undefined;
    const state = useStudioStore.getState();
    if (detachedDisposed || mountedStages || !state.isPlaying) return;
    const runtime = sharedRuntime(state.sceneSpec.engineType);
    runtime.advance(Math.min((now - lastTime) / 1000, 0.05));
    lastTime = now;
    runtime.collisions(findLogicContacts(useStudioStore.getState().sceneSpec));
    if (useStudioStore.getState().isPlaying) detachedFrame = requestAnimationFrame(frame);
  };
  detachedFrame = requestAnimationFrame(frame);
}

if (typeof window !== 'undefined') {
  const unsubscribe = useStudioStore.subscribe((state, previous) => {
    if (state.isPlaying !== previous.isPlaying) updateDetachedRuntime();
  });
  const keyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (mountedStages || e.repeat || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable) return;
    sharedRuntime(useStudioStore.getState().sceneSpec.engineType).emit('key-press', { key: e.key.toLowerCase(), code: e.code });
  };
  window.addEventListener('keydown', keyDown);
  import.meta.hot?.dispose(() => {
    detachedDisposed = true;
    unsubscribe();
    window.removeEventListener('keydown', keyDown);
    if (detachedFrame !== undefined) cancelAnimationFrame(detachedFrame);
  });
}

export function useRuntimeLogicGraph(engine: EngineType, bodies?: React.RefObject<Record<string, RuntimeBody2D>>) {
  const [runtime] = useState(() => sharedRuntime(engine));
  useEffect(() => {
    mountedStages++;
    runtime.runtimePosition = bodies ? (id) => {
      const state = useStudioStore.getState();
      const node = state.sceneSpec.nodes2D.find((n) => n.id === id);
      if (!node) return undefined;
      const p = displayedPosition2D(node, state.isPlaying, state.currentTime, state.sceneSpec.mode, bodies.current);
      return [p.x, p.y, 0];
    } : undefined;
    updateDetachedRuntime();
    return () => {
      mountedStages--;
      runtime.runtimePosition = undefined;
      updateDetachedRuntime();
    };
  }, [runtime, bodies]);
  return runtime;
}


export const StageCanvas2D: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const bodiesRef = useRef<Record<string, RuntimeBody2D>>({});
  const logicRuntime = useRuntimeLogicGraph('2d', bodiesRef);
  const imageCacheRef = useRef<Record<string, HTMLImageElement>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOffsetRef = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const setCanvasElement = useStudioStore((s) => s.setCanvasElement);
  const selectNode2D = useStudioStore((s) => s.selectNode2D);
  const updateNode2D = useStudioStore((s) => s.updateNode2D);

  // Register 2D canvas element for 4K PNG snapshots & 60fps WebM video capture
  useEffect(() => {
    if (canvasRef.current) {
      setCanvasElement(canvasRef.current);
    }
    return () => setCanvasElement(null);
  }, [setCanvasElement]);

  // Graph telemetry clones the scene; only scene changes reset physics bodies.
  useEffect(() => {
    bodiesRef.current = {};
  }, [sceneSpec.id, sceneSpec.mode]);

  // Keyboard listeners for 2D Platformer / Top-Down Game Mode
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      pressedKeysRef.current.add(e.key.toLowerCase());
      if (!e.repeat) logicRuntime.emit('key-press', { key: e.key.toLowerCase(), code: e.code });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      pressedKeysRef.current.delete(e.key.toLowerCase());
    };
    const onBlur = () => pressedKeysRef.current.clear();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [logicRuntime]);

  const toCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    return toDesignCoords(e.clientX, e.clientY, canvas.getBoundingClientRect());
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toCanvasCoords(e);
    const state = useStudioStore.getState();
    const hit = hitTest2D(x, y, bodiesRef.current);

    if (hit) {
      selectNode2D(hit.id);
      if (state.isPlaying) {
        logicRuntime.emit('actor-click', { actorId: hit.id });
        return;
      }
      if (!hit.locked) {
        setDraggingId(hit.id);
        dragOffsetRef.current = { dx: x - hit.x, dy: y - hit.y };
      }
    } else {
      selectNode2D(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!draggingId) return;
    const { x, y } = toCanvasCoords(e);
    updateNode2D(draggingId, {
      x: Math.round(x - dragOffsetRef.current.dx),
      y: Math.round(y - dragOffsetRef.current.dy),
    });
  };

  const handleMouseUp = () => {
    setDraggingId(null);
  };

  useEffect(() => {
    let rafId: number;
    let lastTime = performance.now();

    const renderFrame = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx) {
        // Phase 7: the same frame step the OmniStage Player runs.
        stepStage2D(ctx, dt, pressedKeysRef.current, bodiesRef.current, imageCacheRef.current, logicRuntime, {
          selectedId: useStudioStore.getState().selectedNode2DId,
        });
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [logicRuntime]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-slate-950 overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        width={DESIGN_WIDTH}
        height={DESIGN_HEIGHT}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className="w-full h-full object-contain cursor-crosshair shadow-2xl"
      />

      <div className="pointer-events-none absolute bottom-16 left-4 flex items-center gap-2 px-2.5 py-1 rounded bg-slate-900/85 border border-fuchsia-500/40 text-[11px] font-mono text-fuchsia-300">
        <span>2D VECTOR & SPRITE ENGINE (1000×600)</span>
        <span className="text-slate-500">·</span>
        <span>
          {sceneSpec.mode === 'game'
            ? 'WASD / SPACE to Jump & Collect'
            : 'Click & Drag 2D Layers directly on Canvas'}
        </span>
      </div>
    </div>
  );
};

