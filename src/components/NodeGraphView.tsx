import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Film,
  GitBranch,
  LayoutGrid,
  Maximize2,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useStudioStore } from '../state/useStudioStore';
import {
  ActorClickAction,
  AnimationType,
  CameraMode,
  LogicNode,
  LogicNodeCategory,
  LogicNodeType,
  SkyboxPreset,
  VFXType,
  WeatherType,
} from '../types/scene.schema';

const NODE_WIDTH = 268;
const HEADER_HEIGHT = 38;
const PORT_START_Y = 56;
const PORT_STEP_Y = 24;

interface NodeTemplateItem {
  type: LogicNodeType;
  category: LogicNodeCategory;
  title: string;
  inputs: LogicNode['inputs'];
  outputs: LogicNode['outputs'];
  defaultParams: Record<string, any>;
}

const NODE_PALETTE_TEMPLATES: NodeTemplateItem[] = [
  // Emerald: Triggers
  {
    type: 'trigger',
    category: 'event-trigger',
    title: 'On Scene Start',
    inputs: [],
    outputs: [
      { id: 'out-flow', label: 'Exec Flow', dataType: 'flow' },
      { id: 'out-signal', label: 'Init Signal', dataType: 'signal' },
    ],
    defaultParams: { eventType: 'scene-start', autoPlay: true },
  },
  {
    type: 'trigger',
    category: 'event-trigger',
    title: 'On Actor Click/Tap',
    inputs: [],
    outputs: [
      { id: 'out-flow', label: 'Tap Flow', dataType: 'flow' },
      { id: 'out-actor', label: 'Clicked Actor', dataType: 'actor' },
    ],
    defaultParams: { eventType: 'actor-click', inputKey: 'Pointer / Tap' },
  },
  {
    type: 'trigger',
    category: 'event-trigger',
    title: 'On Collision',
    inputs: [],
    outputs: [
      { id: 'out-flow', label: 'Hit Flow', dataType: 'flow' },
      { id: 'out-actor', label: 'Other Actor', dataType: 'actor' },
    ],
    defaultParams: { eventType: 'collision', targetRole: 'collectible' },
  },
  {
    type: 'trigger',
    category: 'event-trigger',
    title: 'On Key Press (WASD)',
    inputs: [],
    outputs: [{ id: 'out-flow', label: 'Move Flow', dataType: 'flow' }],
    defaultParams: { eventType: 'key-press', keyCombo: 'WASD / Arrows' },
  },
  {
    type: 'trigger',
    category: 'event-trigger',
    title: 'On Timeline At (s)',
    inputs: [],
    outputs: [{ id: 'out-flow', label: 'Cue Flow', dataType: 'flow' }],
    defaultParams: { eventType: 'timeline-cue', cueTimeSeconds: 2.5 },
  },

  // Amber: Conditions
  {
    type: 'condition',
    category: 'logic-gate',
    title: 'If Score >= X',
    inputs: [
      { id: 'in-flow', label: 'Check Flow', dataType: 'flow' },
      { id: 'in-val', label: 'Score Value', dataType: 'number' },
    ],
    outputs: [
      { id: 'out-true', label: 'Goal Met (True)', dataType: 'flow' },
      { id: 'out-false', label: 'False', dataType: 'flow' },
    ],
    defaultParams: { conditionType: 'score-threshold', targetScore: 100, timeLimitSeconds: 30 },
  },
  {
    type: 'condition',
    category: 'logic-gate',
    title: 'Distance Check < Xm',
    inputs: [
      { id: 'in-flow', label: 'Exec In', dataType: 'flow' },
      { id: 'in-actor', label: 'Actor Ref', dataType: 'actor' },
    ],
    outputs: [
      { id: 'out-true', label: 'Within Range', dataType: 'flow' },
      { id: 'out-false', label: 'Out of Range', dataType: 'flow' },
    ],
    defaultParams: { conditionType: 'distance-check', distanceMeters: 2.0 },
  },
  {
    type: 'condition',
    category: 'logic-gate',
    title: 'Cooldown Gate',
    inputs: [{ id: 'in-flow', label: 'Exec In', dataType: 'flow' }],
    outputs: [{ id: 'out-flow', label: 'Ready Flow', dataType: 'flow' }],
    defaultParams: { conditionType: 'cooldown', cooldownMs: 500 },
  },

  // Indigo/Cyan: Actions
  {
    type: 'action',
    category: 'actor-action',
    title: 'Play Animation',
    inputs: [
      { id: 'in-flow', label: 'Exec In', dataType: 'flow' },
      { id: 'in-actor', label: 'Target Actor', dataType: 'actor' },
    ],
    outputs: [
      { id: 'out-flow', label: 'Next Action', dataType: 'flow' },
      { id: 'out-score', label: 'Score Delta', dataType: 'number' },
    ],
    defaultParams: {
      animation: 'bounce',
      activeClip: 'Walking',
      speed: 1.2,
      scoreDelta: 25,
      onClickAction: 'collect',
    },
  },
  {
    type: 'action',
    category: 'camera-vfx',
    title: 'Switch Camera & VFX',
    inputs: [{ id: 'in-flow', label: 'Exec In', dataType: 'flow' }],
    outputs: [{ id: 'out-flow', label: 'Next Flow', dataType: 'flow' }],
    defaultParams: { cameraMode: 'orbit-360', fov: 45, vfxType: 'sparkles' },
  },
  {
    type: 'action',
    category: 'actor-action',
    title: 'Add Score & Impulse',
    inputs: [{ id: 'in-flow', label: 'Exec In', dataType: 'flow' }],
    outputs: [{ id: 'out-score', label: 'New Score', dataType: 'number' }],
    defaultParams: { scoreDelta: 50, impulseY: 4.5, onClickAction: 'bounce' },
  },

  // Purple: Media Pipeline
  {
    type: 'media-pipeline',
    category: 'camera-vfx',
    title: 'World Stage & Skybox',
    inputs: [{ id: 'in-flow', label: 'Init Flow', dataType: 'flow' }],
    outputs: [{ id: 'out-flow', label: 'Stage Out', dataType: 'flow' }],
    defaultParams: {
      skybox: 'daylight-sky',
      weatherType: 'clear',
      terrainType: 'grassy-hills',
    },
  },
  {
    type: 'media-pipeline',
    category: 'audio-caption',
    title: 'Video / MRAID Output',
    inputs: [{ id: 'in-flow', label: 'On Goal Met', dataType: 'flow' }],
    outputs: [],
    defaultParams: {
      headline: 'UNLOCK PRO STAGE',
      ctaText: 'Play Now',
      exportFormat: 'TikTok MRAID 3.0 / WebM 60fps',
    },
  },

  // Rose: Robot Hardware (Phygital Bridge)
  {
    type: 'robot-hardware',
    category: 'robot-servo-io',
    title: 'Servo Motor Angle (Ch 1-4)',
    inputs: [
      { id: 'in-flow', label: 'Sync Signal', dataType: 'flow' },
      { id: 'in-angle', label: 'Angle (deg)', dataType: 'number' },
    ],
    outputs: [{ id: 'out-telemetry', label: 'HW Telemetry', dataType: 'signal' }],
    defaultParams: {
      servoChannel: 'Ch 1 (Head Pan)',
      servoAngle: 90,
      oledExpression: 'cyber-happy',
      voiceTtsText: 'Servo synchronized!',
    },
  },
  {
    type: 'robot-hardware',
    category: 'robot-servo-io',
    title: 'OLED Eye Expression & TTS',
    inputs: [{ id: 'in-flow', label: 'Trigger In', dataType: 'flow' }],
    outputs: [{ id: 'out-signal', label: 'Audio Done', dataType: 'signal' }],
    defaultParams: {
      servoChannel: 'Ch 2 (Arm Tilt)',
      servoAngle: 60,
      oledExpression: 'laser-focus',
      voiceTtsText: 'Mission complete!',
    },
  },
];

function getNodeTheme(type: LogicNodeType) {
  switch (type) {
    case 'trigger':
      return {
        headerBg: 'bg-emerald-950/90 border-b border-emerald-500/40',
        badgeBg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        accentColor: '#10B981',
        icon: <Zap className="w-3.5 h-3.5 text-emerald-400" />,
        label: 'TRIGGER',
      };
    case 'condition':
      return {
        headerBg: 'bg-amber-950/90 border-b border-amber-500/40',
        badgeBg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        accentColor: '#F59E0B',
        icon: <GitBranch className="w-3.5 h-3.5 text-amber-400" />,
        label: 'CONDITION',
      };
    case 'action':
      return {
        headerBg: 'bg-cyan-950/90 border-b border-cyan-500/40',
        badgeBg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
        accentColor: '#06B6D4',
        icon: <Sparkles className="w-3.5 h-3.5 text-cyan-400" />,
        label: 'ACTION',
      };
    case 'media-pipeline':
      return {
        headerBg: 'bg-purple-950/90 border-b border-purple-500/40',
        badgeBg: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
        accentColor: '#A855F7',
        icon: <Film className="w-3.5 h-3.5 text-purple-400" />,
        label: 'PIPELINE',
      };
    case 'robot-hardware':
      return {
        headerBg: 'bg-rose-950/90 border-b border-rose-500/40',
        badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
        accentColor: '#F43F5E',
        icon: <Cpu className="w-3.5 h-3.5 text-rose-400" />,
        label: 'ROBOT I/O',
      };
  }
}

function getPortColor(dataType: string): string {
  switch (dataType) {
    case 'flow':
      return '#10B981'; // Emerald
    case 'actor':
      return '#06B6D4'; // Cyan
    case 'number':
      return '#F59E0B'; // Amber
    case 'signal':
      return '#F43F5E'; // Rose
    default:
      return '#94A3B8';
  }
}

export const NodeGraphView: React.FC = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const isPlaying = useStudioStore((s) => s.isPlaying);
  const focusedLogicNodeId = useStudioStore((s) => s.focusedLogicNodeId);

  const addLogicNode = useStudioStore((s) => s.addLogicNode);
  const updateLogicNode = useStudioStore((s) => s.updateLogicNode);
  const removeLogicNode = useStudioStore((s) => s.removeLogicNode);
  const connectLogicEdge = useStudioStore((s) => s.connectLogicEdge);
  const removeLogicEdge = useStudioStore((s) => s.removeLogicEdge);
  const autoLayoutLogicGraph = useStudioStore((s) => s.autoLayoutLogicGraph);
  const simulateNodeExecution = useStudioStore((s) => s.simulateNodeExecution);
  const setFocusedLogicNodeId = useStudioStore((s) => s.setFocusedLogicNodeId);
  const triggerAgentAutoFix = useStudioStore((s) => s.triggerAgentAutoFix);

  const nodes = useMemo(() => sceneSpec.logicGraph?.nodes || [], [sceneSpec.logicGraph]);
  const edges = useMemo(() => sceneSpec.logicGraph?.edges || [], [sceneSpec.logicGraph]);

  // Pan & Zoom state
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 24, y: 24 });
  const [zoom, setZoom] = useState<number>(0.88);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPaletteOpen, setIsPaletteOpen] = useState<boolean>(false);

  // Node dragging state
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [nodeDragOffset, setNodeDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Interactive wire drawing state
  const [connectingFrom, setConnectingFrom] = useState<{
    nodeId: string;
    portId: string;
    startX: number;
    startY: number;
    dataType: string;
  } | null>(null);
  const [mouseGraphPos, setMouseGraphPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Center on focused node when triggered from ExecutionConsole
  useEffect(() => {
    if (!focusedLogicNodeId || !containerRef.current) return;
    const targetNode = nodes.find((n) => n.id === focusedLogicNodeId);
    if (!targetNode) return;
    const rect = containerRef.current.getBoundingClientRect();
    const nextZoom = Math.max(0.85, zoom);
    setPan({
      x: rect.width / 2 - (targetNode.position.x + NODE_WIDTH / 2) * nextZoom,
      y: rect.height / 2 - (targetNode.position.y + 110) * nextZoom,
    });
  }, [focusedLogicNodeId, nodes]);

  const screenToGraph = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  };

  const getPortCoordinates = (node: LogicNode, portId: string, isOutput: boolean) => {
    const list = isOutput ? node.outputs : node.inputs;
    const idx = Math.max(
      0,
      list.findIndex((p) => p.id === portId)
    );
    return {
      x: isOutput ? node.position.x + NODE_WIDTH : node.position.x,
      y: node.position.y + PORT_START_Y + idx * PORT_STEP_Y,
    };
  };

  const handleWheel = (e: React.WheelEvent) => {
    if ((e.target as HTMLElement).closest('select, input')) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    const nextZoom = Math.min(1.6, Math.max(0.42, Number((zoom * factor).toFixed(2))));
    setZoom(nextZoom);
  };

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('[data-node-card]') ||
      target.closest('[data-port-handle]') ||
      target.closest('[data-graph-toolbar]')
    ) {
      return;
    }
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    setFocusedLogicNodeId(null);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const graphCoords = screenToGraph(e.clientX, e.clientY);
    setMouseGraphPos(graphCoords);

    if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
      return;
    }

    if (draggingNodeId) {
      const nextX = Math.round((graphCoords.x - nodeDragOffset.x) / 10) * 10;
      const nextY = Math.round((graphCoords.y - nodeDragOffset.y) / 10) * 10;
      updateLogicNode(draggingNodeId, {
        position: { x: nextX, y: nextY },
      });
    }
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    setDraggingNodeId(null);
    setConnectingFrom(null);
  };

  const handleStartNodeDrag = (e: React.PointerEvent, node: LogicNode) => {
    if ((e.target as HTMLElement).closest('button, input, select')) return;
    e.stopPropagation();
    const graphCoords = screenToGraph(e.clientX, e.clientY);
    setDraggingNodeId(node.id);
    setFocusedLogicNodeId(node.id);
    setNodeDragOffset({
      x: graphCoords.x - node.position.x,
      y: graphCoords.y - node.position.y,
    });
  };

  const handleStartWire = (
    e: React.PointerEvent,
    node: LogicNode,
    portId: string,
    dataType: string
  ) => {
    e.stopPropagation();
    const coords = getPortCoordinates(node, portId, true);
    setConnectingFrom({
      nodeId: node.id,
      portId,
      startX: coords.x,
      startY: coords.y,
      dataType,
    });
  };

  const handleCompleteWire = (e: React.PointerEvent, targetNode: LogicNode, targetPortId: string) => {
    e.stopPropagation();
    if (!connectingFrom) return;
    if (connectingFrom.nodeId !== targetNode.id) {
      connectLogicEdge({
        sourceNodeId: connectingFrom.nodeId,
        sourcePortId: connectingFrom.portId,
        targetNodeId: targetNode.id,
        targetPortId,
        active: true,
      });
    }
    setConnectingFrom(null);
  };

  const handleSpawnTemplateNode = (tpl: NodeTemplateItem) => {
    const offsetIdx = nodes.length % 6;
    const primaryActor = sceneSpec.actors[0];
    addLogicNode({
      type: tpl.type,
      category: tpl.category,
      title: tpl.title,
      position: {
        x: Math.round((-pan.x + 220 + offsetIdx * 45) / zoom),
        y: Math.round((-pan.y + 130 + offsetIdx * 35) / zoom),
      },
      inputs: JSON.parse(JSON.stringify(tpl.inputs)),
      outputs: JSON.parse(JSON.stringify(tpl.outputs)),
      params: {
        ...tpl.defaultParams,
        actorId: primaryActor?.id || '',
        actorName: primaryActor?.name || 'Stage Actor',
      },
      status: 'idle',
      runCount: 0,
    });
    setIsPaletteOpen(false);
  };

  const buildBezierPath = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = Math.max(70, Math.abs(x2 - x1) * 0.48);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      className="relative w-full h-full bg-[#070B14] overflow-hidden select-none cursor-grab active:cursor-grabbing"
      style={{
        backgroundImage:
          'radial-gradient(circle, rgba(56, 189, 248, 0.14) 1px, transparent 1px)',
        backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
        backgroundPosition: `${pan.x}px ${pan.y}px`,
      }}
    >
      {/* Top Floating Node Graph Toolbar */}
      <div
        data-graph-toolbar="true"
        className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between gap-2 pointer-events-none flex-wrap"
      >
        <div className="flex items-center gap-2 pointer-events-auto">
          <div className="px-3 py-1.5 rounded-lg bg-[#090D16F2] border border-slate-800 flex items-center gap-2 text-xs">
            <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-display font-semibold text-slate-100">
              Visual Logic Graph (n8n / ComfyUI)
            </span>
            <span className="text-slate-600">·</span>
            <span className="font-mono text-[11px] text-cyan-400">
              {nodes.length} Nodes · {edges.length} Wires
            </span>
          </div>

          {/* + Add Node Palette Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsPaletteOpen(!isPaletteOpen)}
              className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-xs flex items-center gap-1.5 shadow-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Add Node</span>
            </button>

            {isPaletteOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-72 max-h-96 overflow-y-auto rounded-xl bg-[#090D16] border border-slate-700 shadow-2xl p-2 z-50 space-y-1.5">
                <div className="px-2 py-1 text-[10px] font-mono uppercase text-slate-400 border-b border-slate-800">
                  Spawn Logic / Pipeline / Robot Node
                </div>
                {NODE_PALETTE_TEMPLATES.map((tpl, idx) => {
                  const theme = getNodeTheme(tpl.type);
                  return (
                    <button
                      key={`${tpl.title}-${idx}`}
                      onClick={() => handleSpawnTemplateNode(tpl)}
                      className="w-full text-left px-2.5 py-2 rounded-lg hover:bg-slate-800/90 flex items-center justify-between gap-2 transition-colors group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {theme.icon}
                        <span className="text-xs font-medium text-slate-200 group-hover:text-white truncate">
                          {tpl.title}
                        </span>
                      </div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border shrink-0 ${theme.badgeBg}`}
                      >
                        {theme.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <button
            onClick={autoLayoutLogicGraph}
            title="Auto-Align Nodes by Column"
            className="px-2.5 py-1.5 rounded-lg bg-[#090D16F2] hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-200 flex items-center gap-1.5 transition-colors"
          >
            <LayoutGrid className="w-3.5 h-3.5 text-cyan-400" />
            <span>Auto-Layout</span>
          </button>
        </div>

        {/* Right Zoom Controls */}
        <div className="flex items-center gap-1 bg-[#090D16F2] border border-slate-800 rounded-lg p-1 pointer-events-auto">
          <button
            onClick={() => setZoom((z) => Math.max(0.45, Number((z - 0.1).toFixed(2))))}
            className="p-1 rounded hover:bg-slate-800 text-slate-300"
            title="Zoom Out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="px-2 text-[11px] font-mono text-slate-300 tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(1.5, Number((z + 0.1).toFixed(2))))}
            className="p-1 rounded hover:bg-slate-800 text-slate-300"
            title="Zoom In"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              setPan({ x: 24, y: 24 });
              setZoom(0.88);
            }}
            className="p-1 rounded hover:bg-slate-800 text-slate-300"
            title="Reset View"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Transformed Infinite Graph Plane */}
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
        }}
      >
        {/* SVG Cubic Bezier Wires Layer */}
        <svg
          className="overflow-visible pointer-events-none"
          width={2400}
          height={1600}
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <defs>
            <filter id="wire-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {edges.map((edge) => {
            const sourceNode = nodes.find((n) => n.id === edge.sourceNodeId);
            const targetNode = nodes.find((n) => n.id === edge.targetNodeId);
            if (!sourceNode || !targetNode) return null;

            const start = getPortCoordinates(sourceNode, edge.sourcePortId, true);
            const end = getPortCoordinates(targetNode, edge.targetPortId, false);
            const pathData = buildBezierPath(start.x, start.y, end.x, end.y);
            const outPort = sourceNode.outputs.find((p) => p.id === edge.sourcePortId);
            const strokeColor = getPortColor(outPort?.dataType || 'flow');
            const midX = (start.x + end.x) / 2;
            const midY = (start.y + end.y) / 2;
            const isFlowing = isPlaying && edge.active !== false;

            return (
              <g key={edge.id} className="group pointer-events-auto">
                {/* Base Wire */}
                <path
                  d={pathData}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={2.5}
                  strokeOpacity={0.45}
                />
                {/* Animated Signal Pulse Wire */}
                {isFlowing && (
                  <path
                    d={pathData}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={3}
                    strokeDasharray="8 8"
                    filter="url(#wire-glow)"
                  >
                    <animate
                      attributeName="stroke-dashoffset"
                      from="32"
                      to="0"
                      dur="0.9s"
                      repeatCount="indefinite"
                    />
                  </path>
                )}
                {/* Clickable Midpoint Delete Pill */}
                <g
                  onClick={(e) => {
                    e.stopPropagation();
                    removeLogicEdge(edge.id);
                  }}
                  className="cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <circle
                    cx={midX}
                    cy={midY}
                    r={9}
                    fill="#090D16"
                    stroke="#F43F5E"
                    strokeWidth={1.5}
                  />
                  <text
                    x={midX}
                    y={midY + 3.5}
                    textAnchor="middle"
                    fill="#F43F5E"
                    fontSize="11"
                    fontWeight="bold"
                  >
                    ×
                  </text>
                </g>
              </g>
            );
          })}

          {/* Active Dragging Wire Preview */}
          {connectingFrom && (
            <path
              d={buildBezierPath(
                connectingFrom.startX,
                connectingFrom.startY,
                mouseGraphPos.x,
                mouseGraphPos.y
              )}
              fill="none"
              stroke={getPortColor(connectingFrom.dataType)}
              strokeWidth={3}
              strokeDasharray="6 6"
            />
          )}
        </svg>

        {/* HTML5 Interactive Node Cards */}
        {nodes.map((node) => {
          const theme = getNodeTheme(node.type);
          const isFocused = focusedLogicNodeId === node.id;
          const isRunningOrSuccess = node.status === 'running' || node.status === 'success';
          const isError = node.status === 'error';

          const targetActor =
            sceneSpec.actors.find((a) => a.id === node.params.actorId) || sceneSpec.actors[0];
          const maxPorts = Math.max(node.inputs.length, node.outputs.length, 1);

          return (
            <div
              key={node.id}
              data-node-card="true"
              onPointerDown={(e) => handleStartNodeDrag(e, node)}
              style={{
                width: NODE_WIDTH,
                transform: `translate3d(${node.position.x}px, ${node.position.y}px, 0)`,
              }}
              className={`absolute top-0 left-0 rounded-xl bg-[#0D1322]/95 border transition-shadow ${
                isError
                  ? 'border-rose-500 shadow-[0_0_24px_rgba(244,63,94,0.4)]'
                  : isFocused
                    ? 'border-cyan-400 shadow-[0_0_24px_rgba(6,182,212,0.35)] ring-2 ring-cyan-400/40'
                    : isRunningOrSuccess
                      ? 'border-emerald-500/70 shadow-[0_0_18px_rgba(16,185,129,0.18)]'
                      : 'border-slate-800 shadow-xl'
              }`}
            >
              {/* Node Header */}
              <div
                style={{ height: HEADER_HEIGHT }}
                className={`px-3 rounded-t-xl flex items-center justify-between gap-1.5 cursor-move ${theme.headerBg}`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {theme.icon}
                  <span className="font-display font-bold text-xs text-slate-100 truncate">
                    {node.title}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {node.runCount !== undefined && node.runCount > 0 && !isError && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/50 text-[10px] font-mono font-bold text-emerald-300 flex items-center gap-0.5">
                      <CheckCircle2 className="w-2.5 h-2.5" />
                      x{node.runCount}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      simulateNodeExecution(node.id);
                    }}
                    title="Test / Fire Node Now"
                    className="p-1 rounded hover:bg-white/10 text-slate-300 hover:text-emerald-300 transition-colors"
                  >
                    <Play className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeLogicNode(node.id);
                    }}
                    title="Delete Node"
                    className="p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-300 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Ports Section (Inputs Left, Outputs Right) */}
              <div
                className="relative px-3 py-2 border-b border-slate-800/80"
                style={{ minHeight: maxPorts * PORT_STEP_Y + 8 }}
              >
                {/* Left Input Ports */}
                <div className="space-y-1.5">
                  {node.inputs.map((inp, idx) => (
                    <div
                      key={inp.id}
                      style={{ height: 18 }}
                      className="flex items-center gap-1.5 text-[10px] font-mono text-slate-300"
                    >
                      <button
                        data-port-handle="true"
                        onPointerUp={(e) => handleCompleteWire(e, node, inp.id)}
                        title={`Connect to ${inp.label} (${inp.dataType})`}
                        style={{
                          top: PORT_START_Y - HEADER_HEIGHT + idx * PORT_STEP_Y - 6,
                          left: -6,
                          backgroundColor: getPortColor(inp.dataType),
                        }}
                        className="absolute w-3 h-3 rounded-full border-2 border-[#090D16] hover:scale-125 transition-transform cursor-crosshair"
                      />
                      <span>{inp.label}</span>
                    </div>
                  ))}
                </div>

                {/* Right Output Ports */}
                <div className="absolute top-2 right-3 space-y-1.5 text-right">
                  {node.outputs.map((out, idx) => (
                    <div
                      key={out.id}
                      style={{ height: 18 }}
                      className="flex items-center justify-end gap-1.5 text-[10px] font-mono text-slate-300"
                    >
                      <span>{out.label}</span>
                      <button
                        data-port-handle="true"
                        onPointerDown={(e) => handleStartWire(e, node, out.id, out.dataType)}
                        title={`Drag wire from ${out.label} (${out.dataType})`}
                        style={{
                          top: PORT_START_Y - HEADER_HEIGHT + idx * PORT_STEP_Y - 6,
                          right: -18,
                          backgroundColor: getPortColor(out.dataType),
                        }}
                        className="absolute w-3 h-3 rounded-full border-2 border-[#090D16] hover:scale-125 transition-transform cursor-crosshair"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Inline Bidirectional Parameter Controls */}
              <div className="p-2.5 space-y-2 text-[11px]">
                {/* Actor Action Controls */}
                {node.category === 'actor-action' && (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400 font-mono text-[10px]">Actor</span>
                      <select
                        value={node.params.actorId || targetActor?.id || ''}
                        onChange={(e) =>
                          updateLogicNode(node.id, {
                            params: { actorId: e.target.value },
                          })
                        }
                        className="flex-1 bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
                      >
                        {sceneSpec.actors.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                        <option value="missing-actor-id">[Simulate Missing Actor]</option>
                      </select>
                    </div>

                    {targetActor?.availableClips && targetActor.availableClips.length > 0 && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-400 font-mono text-[10px]">GLB Clip</span>
                        <select
                          value={
                            node.params.activeClip ||
                            targetActor.activeClip ||
                            targetActor.availableClips[0]
                          }
                          onChange={(e) =>
                            updateLogicNode(node.id, {
                              params: { activeClip: e.target.value },
                            })
                          }
                          className="flex-1 bg-emerald-950/50 border border-emerald-500/40 rounded px-1.5 py-1 text-[11px] text-emerald-300 font-mono"
                        >
                          {targetActor.availableClips.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <span className="text-slate-400 font-mono text-[10px] block mb-0.5">
                          Motion
                        </span>
                        <select
                          value={node.params.animation || targetActor?.activeAnimation || 'idle'}
                          onChange={(e) =>
                            updateLogicNode(node.id, {
                              params: { animation: e.target.value as AnimationType },
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-slate-200 font-mono"
                        >
                          {(['idle', 'bounce', 'spin', 'walk', 'attack', 'float'] as AnimationType[]).map(
                            (anim) => (
                              <option key={anim} value={anim}>
                                {anim}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                      <div>
                        <span className="text-slate-400 font-mono text-[10px] block mb-0.5">
                          Score (+PTS)
                        </span>
                        <input
                          type="number"
                          step={5}
                          value={node.params.scoreDelta ?? 25}
                          onChange={(e) =>
                            updateLogicNode(node.id, {
                              params: { scoreDelta: Number(e.target.value) },
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-amber-300 font-mono tabular-nums"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400 font-mono text-[10px]">Tap Action</span>
                      <select
                        value={node.params.onClickAction || targetActor?.onClickAction || 'collect'}
                        onChange={(e) =>
                          updateLogicNode(node.id, {
                            params: { onClickAction: e.target.value as ActorClickAction },
                          })
                        }
                        className="flex-1 bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-slate-200 font-mono"
                      >
                        <option value="collect">collect (+PTS)</option>
                        <option value="unbox-tap">unbox-tap (3x Reveal)</option>
                        <option value="bounce">bounce</option>
                        <option value="destroy">destroy</option>
                        <option value="trigger-cta">trigger-cta</option>
                      </select>
                    </div>
                  </>
                )}

                {/* Event Trigger Controls */}
                {node.category === 'event-trigger' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <span className="text-slate-400 font-mono text-[10px] block mb-0.5">
                        Event
                      </span>
                      <select
                        value={node.params.eventType || 'scene-start'}
                        onChange={(e) =>
                          updateLogicNode(node.id, {
                            params: { eventType: e.target.value },
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-emerald-300 font-mono"
                      >
                        <option value="scene-start">scene-start</option>
                        <option value="actor-click">actor-click</option>
                        <option value="collision">collision</option>
                        <option value="key-press">key-press</option>
                        <option value="timeline-cue">timeline-cue</option>
                      </select>
                    </div>
                    <div>
                      <span className="text-slate-400 font-mono text-[10px] block mb-0.5">
                        Binding
                      </span>
                      <input
                        type="text"
                        value={node.params.inputKey || node.params.engineType || 'Active Stage'}
                        onChange={(e) =>
                          updateLogicNode(node.id, {
                            params: { inputKey: e.target.value },
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* Logic Gate / Condition Controls */}
                {node.category === 'logic-gate' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <span className="text-slate-400 font-mono text-[10px] block mb-0.5">
                        Target Score
                      </span>
                      <input
                        type="number"
                        step={10}
                        value={node.params.targetScore ?? sceneSpec.gameRules.targetScore}
                        onChange={(e) =>
                          updateLogicNode(node.id, {
                            params: { targetScore: Number(e.target.value) },
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-amber-300 font-mono tabular-nums"
                      />
                    </div>
                    <div>
                      <span className="text-slate-400 font-mono text-[10px] block mb-0.5">
                        Timer (s)
                      </span>
                      <input
                        type="number"
                        step={5}
                        value={
                          node.params.timeLimitSeconds ?? sceneSpec.gameRules.timeLimitSeconds
                        }
                        onChange={(e) =>
                          updateLogicNode(node.id, {
                            params: { timeLimitSeconds: Number(e.target.value) },
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 font-mono tabular-nums"
                      />
                    </div>
                  </div>
                )}

                {/* Camera / World Stage Pipeline Controls */}
                {node.category === 'camera-vfx' && node.type === 'action' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <span className="text-slate-400 font-mono text-[10px] block mb-0.5">
                        Camera Rig
                      </span>
                      <select
                        value={node.params.cameraMode || sceneSpec.camera.mode}
                        onChange={(e) =>
                          updateLogicNode(node.id, {
                            params: { cameraMode: e.target.value as CameraMode },
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-cyan-300 font-mono"
                      >
                        <option value="orbit-360">orbit-360</option>
                        <option value="dolly-zoom-in">dolly-zoom-in</option>
                        <option value="crane-reveal">crane-reveal</option>
                        <option value="top-down-isometric">top-down-isometric</option>
                        <option value="first-person-follow">first-person-follow</option>
                        <option value="cinematic-flythrough">cinematic-flythrough</option>
                      </select>
                    </div>
                    <div>
                      <span className="text-slate-400 font-mono text-[10px] block mb-0.5">
                        VFX Emitter
                      </span>
                      <select
                        value={node.params.vfxType || 'sparkles'}
                        onChange={(e) =>
                          updateLogicNode(node.id, {
                            params: { vfxType: e.target.value as VFXType },
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-slate-200 font-mono"
                      >
                        <option value="sparkles">sparkles</option>
                        <option value="confetti">confetti</option>
                        <option value="shockwave">shockwave</option>
                        <option value="laser-beam">laser-beam</option>
                      </select>
                    </div>
                  </div>
                )}

                {node.category === 'camera-vfx' && node.type === 'media-pipeline' && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <span className="text-slate-400 font-mono text-[10px] block mb-0.5">
                        Skybox
                      </span>
                      <select
                        value={node.params.skybox || sceneSpec.world.skybox}
                        onChange={(e) =>
                          updateLogicNode(node.id, {
                            params: { skybox: e.target.value as SkyboxPreset },
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-purple-300 font-mono"
                      >
                        <option value="daylight-sky">daylight-sky</option>
                        <option value="sunset-atmosphere">sunset-atmosphere</option>
                        <option value="night-stars">night-stars</option>
                        <option value="cyber-void">cyber-void</option>
                      </select>
                    </div>
                    <div>
                      <span className="text-slate-400 font-mono text-[10px] block mb-0.5">
                        Weather
                      </span>
                      <select
                        value={node.params.weatherType || sceneSpec.world.weather.type}
                        onChange={(e) =>
                          updateLogicNode(node.id, {
                            params: { weatherType: e.target.value as WeatherType },
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-slate-200 font-mono"
                      >
                        <option value="clear">clear</option>
                        <option value="rain">rain</option>
                        <option value="snow">snow</option>
                        <option value="floating-embers">floating-embers</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Audio / Caption / End-Card Media Pipeline Controls */}
                {node.category === 'audio-caption' && (
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={node.params.headline ?? sceneSpec.marketingOverlay.headline}
                      onChange={(e) =>
                        updateLogicNode(node.id, {
                          params: { headline: e.target.value },
                        })
                      }
                      placeholder="End-Card Headline"
                      className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-100"
                    />
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400 font-mono text-[10px]">CTA:</span>
                      <input
                        type="text"
                        value={node.params.ctaText ?? sceneSpec.marketingOverlay.ctaText}
                        onChange={(e) =>
                          updateLogicNode(node.id, {
                            params: { ctaText: e.target.value },
                          })
                        }
                        className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-purple-300 font-mono"
                      />
                    </div>
                  </div>
                )}

                {/* Robot Hardware / Phygital Bridge Controls */}
                {node.category === 'robot-servo-io' && (
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <span className="text-slate-400 font-mono text-[10px] block mb-0.5">
                          Servo Ch
                        </span>
                        <select
                          value={node.params.servoChannel || 'Ch 1 (Head Pan)'}
                          onChange={(e) =>
                            updateLogicNode(node.id, {
                              params: { servoChannel: e.target.value },
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-rose-300 font-mono"
                        >
                          <option value="Ch 1 (Head Pan)">Ch 1 (Head Pan)</option>
                          <option value="Ch 2 (Arm Tilt)">Ch 2 (Arm Tilt)</option>
                          <option value="Ch 3 (Gripper)">Ch 3 (Gripper)</option>
                          <option value="Ch 4 (Base Yaw)">Ch 4 (Base Yaw)</option>
                        </select>
                      </div>
                      <div>
                        <span className="text-slate-400 font-mono text-[10px] block mb-0.5">
                          Angle (0–180°)
                        </span>
                        <input
                          type="number"
                          step={15}
                          value={node.params.servoAngle ?? 45}
                          onChange={(e) =>
                            updateLogicNode(node.id, {
                              params: { servoAngle: Number(e.target.value) },
                            })
                          }
                          className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-100 font-mono tabular-nums"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-slate-400 font-mono text-[10px]">OLED Eye</span>
                      <select
                        value={node.params.oledExpression || 'cyber-happy'}
                        onChange={(e) =>
                          updateLogicNode(node.id, {
                            params: { oledExpression: e.target.value },
                          })
                        }
                        className="flex-1 bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px] text-rose-200 font-mono"
                      >
                        <option value="cyber-happy">cyber-happy</option>
                        <option value="laser-focus">laser-focus</option>
                        <option value="surprised-blink">surprised-blink</option>
                        <option value="alert-red">alert-red</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Error Tooltip & Inline Auto-Fix Button */}
                {isError && (
                  <div className="p-2 rounded-lg bg-rose-950/80 border border-rose-500/60 space-y-1.5">
                    <div className="flex items-start gap-1.5 text-[10px] text-rose-200 font-mono">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                      <span>{node.errorMessage || 'Execution fault detected on this node.'}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        triggerAgentAutoFix({
                          id: `err-${node.id}`,
                          timestamp: new Date().toLocaleTimeString(),
                          sceneTime: 0,
                          level: 'error',
                          nodeId: node.id,
                          message: node.errorMessage || `Node ${node.title} reported an error.`,
                        });
                      }}
                      className="w-full py-1 px-2 rounded bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold text-[10px] flex items-center justify-center gap-1 transition-colors"
                    >
                      <Wand2 className="w-3 h-3" />
                      <span>Auto-Fix with AI Agent</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
