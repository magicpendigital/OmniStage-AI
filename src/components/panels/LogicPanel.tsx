import React, { useMemo, useState } from 'react';
import { ArrowRight, Crosshair, Play, Plus, Trash2, Zap } from 'lucide-react';
import { useStudioStore } from '../../state/useStudioStore';
import {
  ActorClickAction,
  GameRule,
  LogicNode,
  MarketingOverlayConfig,
  Physics2DRole,
} from '../../types/scene.schema';

type NodeSeed = Omit<LogicNode, 'id' | 'position'>;

const WHEN_OPTIONS: { id: string; label: string; build: (actorId: string, actorName: string) => NodeSeed }[] = [
  {
    id: 'scene-start',
    label: 'Scene starts',
    build: () => ({
      type: 'trigger',
      category: 'event-trigger',
      title: 'On Scene Start',
      inputs: [],
      outputs: [{ id: 'out-flow', label: 'Exec Flow', dataType: 'flow' }],
      params: { eventType: 'scene-start', autoPlay: true },
    }),
  },
  {
    id: 'actor-click',
    label: 'Actor is clicked / tapped',
    build: (actorId, actorName) => ({
      type: 'trigger',
      category: 'event-trigger',
      title: `On Click · ${actorName}`,
      inputs: [],
      outputs: [
        { id: 'out-flow', label: 'Tap Flow', dataType: 'flow' },
        { id: 'out-actor', label: 'Clicked Actor', dataType: 'actor' },
      ],
      params: { eventType: 'actor-click', actorId, actorName, inputKey: 'Pointer / Tap' },
    }),
  },
  {
    id: 'collision',
    label: 'Player collides with a collectible',
    build: () => ({
      type: 'trigger',
      category: 'event-trigger',
      title: 'On Collision',
      inputs: [],
      outputs: [
        { id: 'out-flow', label: 'Hit Flow', dataType: 'flow' },
        { id: 'out-actor', label: 'Other Actor', dataType: 'actor' },
      ],
      params: { eventType: 'collision', targetRole: 'collectible' },
    }),
  },
  {
    id: 'key-press',
    label: 'A movement key is pressed',
    build: () => ({
      type: 'trigger',
      category: 'event-trigger',
      title: 'On Key Press (WASD)',
      inputs: [],
      outputs: [{ id: 'out-flow', label: 'Move Flow', dataType: 'flow' }],
      params: { eventType: 'key-press', keyCombo: 'WASD / Arrows' },
    }),
  },
  {
    id: 'timeline-cue',
    label: 'Timeline reaches the playhead time',
    build: () => ({
      type: 'trigger',
      category: 'event-trigger',
      title: 'On Timeline At (s)',
      inputs: [],
      outputs: [{ id: 'out-flow', label: 'Cue Flow', dataType: 'flow' }],
      params: { eventType: 'timeline-cue', cueTimeSeconds: 2.5 },
    }),
  },
];

const DO_OPTIONS: { id: string; label: string; build: (actorId: string, actorName: string) => NodeSeed }[] = [
  {
    id: 'add-score',
    label: 'Add score (+25)',
    build: () => ({
      type: 'action',
      category: 'actor-action',
      title: 'Add Score',
      inputs: [{ id: 'in-flow', label: 'Exec In', dataType: 'flow' }],
      outputs: [{ id: 'out-score', label: 'New Score', dataType: 'number' }],
      params: { scoreDelta: 25 },
    }),
  },
  {
    id: 'play-animation',
    label: 'Play bounce animation on the actor',
    build: (actorId, actorName) => ({
      type: 'action',
      category: 'actor-action',
      title: `Play Animation · ${actorName}`,
      inputs: [
        { id: 'in-flow', label: 'Exec In', dataType: 'flow' },
        { id: 'in-actor', label: 'Target Actor', dataType: 'actor' },
      ],
      outputs: [{ id: 'out-flow', label: 'Next Action', dataType: 'flow' }],
      params: { actorId, actorName, animation: 'bounce', speed: 1.2 },
    }),
  },
  {
    id: 'switch-camera',
    label: 'Switch camera to orbit-360',
    build: () => ({
      type: 'action',
      category: 'camera-vfx',
      title: 'Switch Camera',
      inputs: [{ id: 'in-flow', label: 'Exec In', dataType: 'flow' }],
      outputs: [{ id: 'out-flow', label: 'Next Flow', dataType: 'flow' }],
      params: { cameraMode: 'orbit-360', fov: 45 },
    }),
  },
];

/** Game Logic & Events: When → Do rules read from the logic graph, plus the Game HUD and CTA settings. */
export const LogicPanel: React.FC = () => {
  const sceneSpec = useStudioStore((s) => s.sceneSpec);
  const currentTime = useStudioStore((s) => s.currentTime);

  const addLogicNode = useStudioStore((s) => s.addLogicNode);
  const connectLogicEdge = useStudioStore((s) => s.connectLogicEdge);
  const removeLogicNode = useStudioStore((s) => s.removeLogicNode);
  const simulateNodeExecution = useStudioStore((s) => s.simulateNodeExecution);
  const setFocusedLogicNodeId = useStudioStore((s) => s.setFocusedLogicNodeId);
  const setWorkspaceView = useStudioStore((s) => s.setWorkspaceView);
  const workspaceView = useStudioStore((s) => s.workspaceView);
  const updateGameRules = useStudioStore((s) => s.updateGameRules);
  const updateMarketingOverlay = useStudioStore((s) => s.updateMarketingOverlay);
  const updateActorProperty = useStudioStore((s) => s.updateActorProperty);
  const updateNode2D = useStudioStore((s) => s.updateNode2D);
  const setMode = useStudioStore((s) => s.setMode);

  const [whenId, setWhenId] = useState('actor-click');
  const [doId, setDoId] = useState('add-score');

  const is2D = sceneSpec.engineType === '2d';
  const graph = sceneSpec.logicGraph;
  const rules = sceneSpec.gameRules;
  const cta = sceneSpec.marketingOverlay;
  const entities = is2D
    ? (sceneSpec.nodes2D || []).map((n) => ({ id: n.id, name: n.name }))
    : sceneSpec.actors.map((a) => ({ id: a.id, name: a.name }));
  const [targetId, setTargetId] = useState('');
  const target = entities.find((e) => e.id === targetId) || entities[0];

  // Each trigger becomes one rule; its "Do" side is everything reachable along the wires.
  const whenDoRules = useMemo(() => {
    if (!graph) return [];
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    return graph.nodes
      .filter((n) => n.type === 'trigger')
      .map((trigger) => {
        const seen = new Set<string>([trigger.id]);
        const chain: LogicNode[] = [];
        const queue = [trigger.id];
        while (queue.length > 0) {
          const id = queue.shift()!;
          for (const edge of graph.edges) {
            if (edge.sourceNodeId !== id || seen.has(edge.targetNodeId)) continue;
            seen.add(edge.targetNodeId);
            const node = byId.get(edge.targetNodeId);
            if (node) {
              chain.push(node);
              queue.push(node.id);
            }
          }
        }
        return { trigger, chain };
      });
  }, [graph]);

  const focusNode = (nodeId: string) => {
    if (workspaceView === 'viewport') setWorkspaceView('split');
    setFocusedLogicNodeId(nodeId);
  };

  const handleAddRule = () => {
    const when = WHEN_OPTIONS.find((w) => w.id === whenId)!;
    const action = DO_OPTIONS.find((d) => d.id === doId)!;
    const stamp = Date.now().toString(36);
    const baseY = Math.max(0, ...(graph?.nodes || []).map((n) => n.position.y)) + 190;
    const triggerId = `node-when-${stamp}`;
    const actionId = `node-do-${stamp}`;
    const whenSeed = when.build(target?.id || '', target?.name || 'Actor');
    if (when.id === 'timeline-cue') whenSeed.params.cueTimeSeconds = Number(currentTime.toFixed(1));
    const doSeed = action.build(target?.id || '', target?.name || 'Actor');
    addLogicNode({ ...whenSeed, id: triggerId, position: { x: 60, y: baseY } });
    addLogicNode({ ...doSeed, id: actionId, position: { x: 380, y: baseY } });
    connectLogicEdge({
      sourceNodeId: triggerId,
      sourcePortId: whenSeed.outputs[0].id,
      targetNodeId: actionId,
      targetPortId: doSeed.inputs[0].id,
      active: true,
    });
  };

  const numberField = (
    label: string,
    value: number,
    onChange: (n: number) => void,
    opts: { min?: number; max?: number; step?: number } = {}
  ) => (
    <label className="flex items-center justify-between gap-2 text-[11px] text-mute">
      <span>{label}</span>
      <input
        type="number"
        className="field sm w-20 text-right font-mono"
        value={value}
        min={opts.min}
        max={opts.max}
        step={opts.step ?? 1}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </label>
  );

  return (
    <>
      {sceneSpec.mode !== 'game' && (
        <div className="card flex items-center justify-between gap-2 text-[11px] text-mute">
          <span>Rules run in Game Mode. This scene is in Media Mode.</span>
          <button type="button" className="btn warn sm" onClick={() => setMode('game')}>
            Switch
          </button>
        </div>
      )}

      {/* When → Do rules */}
      <div className="grp">
        <Zap size={11} /> When → Do rules
        <span className="ml-auto font-mono normal-case tracking-normal">{whenDoRules.length}</span>
      </div>
      {whenDoRules.length === 0 && <p className="text-[11px] text-dim">No triggers in this scene's logic graph yet.</p>}
      {whenDoRules.map(({ trigger, chain }) => (
        <div key={trigger.id} className="card space-y-1.5" style={{ padding: 8 }}>
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-ok/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ok">When</span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium" title={trigger.title}>{trigger.title}</span>
            <button type="button" className="orow-b keep" title="Fire this trigger now" aria-label={`Run ${trigger.title}`} onClick={() => simulateNodeExecution(trigger.id)}>
              <Play size={12} />
            </button>
            <button type="button" className="orow-b keep" title="Show in node graph" aria-label={`Focus ${trigger.title} in node graph`} onClick={() => focusNode(trigger.id)}>
              <Crosshair size={12} />
            </button>
            <button type="button" className="orow-b keep danger" title="Delete trigger" aria-label={`Delete ${trigger.title}`} onClick={() => removeLogicNode(trigger.id)}>
              <Trash2 size={12} />
            </button>
          </div>
          {chain.length === 0 ? (
            <div className="pl-1 text-[11px] text-warn">Not wired to any action yet.</div>
          ) : (
            chain.map((node) => (
              <button
                key={node.id}
                type="button"
                onClick={() => focusNode(node.id)}
                className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[11px] text-mute hover:bg-hover hover:text-fg"
              >
                <ArrowRight size={11} className="shrink-0 text-dim" />
                <span className={`shrink-0 rounded px-1 text-[9px] font-bold uppercase tracking-wider ${node.type === 'condition' ? 'bg-warn/15 text-warn' : 'bg-accent/15 text-accent'}`}>
                  {node.type === 'condition' ? 'If' : 'Do'}
                </span>
                <span className="truncate">{node.title}</span>
                {node.status === 'error' && <span className="ml-auto shrink-0 text-err">error</span>}
              </button>
            ))
          )}
        </div>
      ))}

      <div className="card space-y-1.5">
        <div className="text-[11px] font-medium text-fg">New rule</div>
        <label className="flex items-center gap-2 text-[11px] text-mute">
          <span className="w-9 shrink-0">When</span>
          <select className="field sm min-w-0 flex-1" value={whenId} onChange={(e) => setWhenId(e.target.value)}>
            {WHEN_OPTIONS.map((w) => (
              <option key={w.id} value={w.id}>{w.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[11px] text-mute">
          <span className="w-9 shrink-0">Do</span>
          <select className="field sm min-w-0 flex-1" value={doId} onChange={(e) => setDoId(e.target.value)}>
            {DO_OPTIONS.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </label>
        {entities.length > 0 && (
          <label className="flex items-center gap-2 text-[11px] text-mute">
            <span className="w-9 shrink-0">Actor</span>
            <select className="field sm min-w-0 flex-1" value={target?.id || ''} onChange={(e) => setTargetId(e.target.value)}>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="btn primary sm w-full" onClick={handleAddRule}>
          <Plus size={12} /> Add rule to logic graph
        </button>
      </div>

      {/* Per-entity tap / physics behaviour */}
      <div className="grp">{is2D ? '2D layer physics roles' : 'Actor tap behaviour'}</div>
      {entities.length === 0 && <p className="text-[11px] text-dim">Nothing on stage yet.</p>}
      {!is2D &&
        sceneSpec.actors.map((actor) => (
          <label key={actor.id} className="flex items-center gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate text-fg">{actor.name}</span>
            <select
              className="field sm w-32"
              value={actor.onClickAction}
              onChange={(e) => updateActorProperty(actor.id, { onClickAction: e.target.value as ActorClickAction })}
            >
              <option value="none">none</option>
              <option value="collect">collect (+pts)</option>
              <option value="unbox-tap">unbox-tap</option>
              <option value="destroy">destroy</option>
              <option value="bounce">bounce</option>
              <option value="trigger-vfx">trigger-vfx</option>
              <option value="trigger-cta">trigger-cta</option>
            </select>
          </label>
        ))}
      {is2D &&
        (sceneSpec.nodes2D || []).map((node) => (
          <label key={node.id} className="flex items-center gap-2 text-[11px]">
            <span className="min-w-0 flex-1 truncate text-fg">{node.name}</span>
            <select
              className="field sm w-32"
              value={node.physics2D}
              onChange={(e) => updateNode2D(node.id, { physics2D: e.target.value as Physics2DRole })}
            >
              <option value="none">none / UI</option>
              <option value="player-platformer">platformer player</option>
              <option value="player-topdown">top-down player</option>
              <option value="static-platform">solid platform</option>
              <option value="collectible">collectible</option>
              <option value="bouncing">bouncing</option>
            </select>
          </label>
        ))}

      {/* Game HUD */}
      <div className="grp">Game HUD &amp; win rules</div>
      <div className="card space-y-1.5">
        <label className="flex items-center justify-between gap-2 text-[11px] text-mute">
          <span>Win condition</span>
          <select
            className="field sm w-36"
            value={rules.winCondition}
            onChange={(e) => updateGameRules({ winCondition: e.target.value as GameRule['winCondition'] })}
          >
            <option value="score-threshold">score threshold</option>
            <option value="collect-all">collect all</option>
            <option value="survive-timer">survive timer</option>
            <option value="unbox-reveal">unbox reveal</option>
          </select>
        </label>
        {numberField('Target score', rules.targetScore, (n) => updateGameRules({ targetScore: Math.max(0, n) }), { min: 0, step: 5 })}
        {numberField('Time limit (s)', rules.timeLimitSeconds, (n) => updateGameRules({ timeLimitSeconds: Math.max(1, n) }), { min: 1 })}
        <textarea
          className="field w-full"
          rows={2}
          aria-label="Player instructions"
          placeholder="Instructions shown to the player"
          value={rules.instructions}
          onChange={(e) => updateGameRules({ instructions: e.target.value })}
        />
      </div>

      {/* Playable CTA */}
      <div className="grp">Playable CTA / end card</div>
      <div className="card space-y-1.5">
        <label className="flex items-center justify-between text-[11px] text-mute">
          <span>Show CTA banner on stage</span>
          <input
            type="checkbox"
            checked={cta.enabled}
            onChange={(e) => updateMarketingOverlay({ enabled: e.target.checked })}
            className="accent-[rgb(var(--accent))]"
          />
        </label>
        <input className="field w-full" aria-label="Headline" placeholder="Headline" value={cta.headline} onChange={(e) => updateMarketingOverlay({ headline: e.target.value })} />
        <input className="field w-full" aria-label="Subheadline" placeholder="Subheadline" value={cta.subheadline} onChange={(e) => updateMarketingOverlay({ subheadline: e.target.value })} />
        <div className="flex gap-1.5">
          <input className="field min-w-0 flex-1" aria-label="CTA button label" placeholder="CTA label" value={cta.ctaText} onChange={(e) => updateMarketingOverlay({ ctaText: e.target.value })} />
          <input type="color" aria-label="Brand color" className="h-7 w-8 cursor-pointer rounded border border-line2 bg-transparent" value={cta.brandColor || '#f59e0b'} onChange={(e) => updateMarketingOverlay({ brandColor: e.target.value })} />
        </div>
        <input className="field w-full font-mono" aria-label="CTA URL" placeholder="https://store.example/app" value={cta.ctaUrl || ''} onChange={(e) => updateMarketingOverlay({ ctaUrl: e.target.value })} />
        <label className="flex items-center justify-between gap-2 text-[11px] text-mute">
          <span>Show end card</span>
          <select
            className="field sm w-32"
            value={cta.triggerCondition}
            onChange={(e) => updateMarketingOverlay({ triggerCondition: e.target.value as MarketingOverlayConfig['triggerCondition'] })}
          >
            <option value="on-win">on win</option>
            <option value="after-3s">after 3s</option>
            <option value="always">always</option>
          </select>
        </label>
      </div>
    </>
  );
};
