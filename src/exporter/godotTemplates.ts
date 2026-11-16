/**
 * Godot 4 export — fixed GDScript files written into every exported project (never run by OmniStage).
 *
 * These scripts are the same for every project: they contain no user data. A scene's own values (score target,
 * timer, instructions, logic rules...) are written by `godotExport.ts` into the .tscn as exported properties and node
 * metadata, with every string escaped. Keep the behaviour in line with `src/runtime/gameSlice.ts`,
 * `src/runtime/logicGraph.ts` and `src/runtime/stage2d.ts` (speeds, scores, win rules).
 * Indentation is tabs (GDScript). Do not add template placeholders here.
 */

export const GODOT_GAME_SCRIPT = `extends Node
## OmniStage AI export: scene rules (score, timer, win / lose, clicks, contacts, scene links, mapped logic graph).
## This script is identical in every export. The scene's own values live in its .tscn file: the exported
## properties below (set on the scene root) and metadata on actor nodes (omni_id, omni_role, omni_click,
## omni_score, omni_clip, omni_unbox_taps).

@export_enum("game", "media") var mode: String = "game"
@export var is_2d: bool = false
@export_enum("collect-all", "score-threshold", "survive-timer", "unbox-reveal") var win_condition: String = "score-threshold"
@export var target_score: int = 100
@export var time_limit: float = 15.0
@export var duration: float = 8.0
@export_multiline var instructions: String = ""
@export_file("*.tscn") var next_scene: String = ""
@export var end_headline: String = ""
@export var cta_text: String = ""
@export var cta_url: String = ""
@export var camera_follow: NodePath
## Logic graph rules translated by OmniStage: [{event, actor, other, target_role, key, time, steps: [...]}].
@export var logic_rules: Array = []

const RESPAWN_RANGE := 2.1

var score: int = 0
var time_left: float = 0.0
var scene_time: float = 0.0
var won: bool = false
var ended: bool = false

var _nodes: Dictionary = {}
var _taps: Dictionary = {}
var _cooldowns: Dictionary = {}
var _follow: Node3D = null
var _camera: Camera3D = null
var _camera_offset: Vector3 = Vector3.ZERO
var _hud: VBoxContainer = null
var _score_label: Label = null
var _time_label: Label = null
var _end_panel: PanelContainer = null
var _end_title: Label = null
var _next_button: Button = null
var _cta_button: Button = null


func _ready() -> void:
	time_left = time_limit
	_index(self)
	_build_hud()
	_play_clips()
	if not is_2d and not camera_follow.is_empty():
		_follow = get_node_or_null(camera_follow) as Node3D
		_camera = get_viewport().get_camera_3d()
		if _follow != null and _camera != null:
			_camera_offset = _camera.global_position - _follow.global_position
	_start.call_deferred()


func _start() -> void:
	_emit("scene-start", "", "", "")
	_timeline(-1.0, 0.0)


## True while the player may move (game scenes that have not ended).
func controls_enabled() -> bool:
	return mode == "game" and not ended


func is_over() -> bool:
	return ended


func _process(delta: float) -> void:
	if _follow != null and _camera != null:
		_camera.global_position = _follow.global_position + _camera_offset
	if ended:
		return
	var previous: float = scene_time
	scene_time += delta
	_timeline(previous, scene_time)
	if mode == "game":
		time_left = maxf(0.0, time_left - delta)
		_update_hud()
		if time_left <= 0.0:
			_finish(win_condition == "survive-timer")
	elif scene_time >= duration and next_scene != "":
		go_next()


func _unhandled_input(event: InputEvent) -> void:
	var key_event := event as InputEventKey
	if key_event != null and key_event.pressed and not key_event.echo:
		_emit("key-press", "", "", _dom_key(key_event))
	var click := event as InputEventMouseButton
	if is_2d and click != null and click.pressed and click.button_index == MOUSE_BUTTON_LEFT and not ended:
		var point: Vector2 = get_viewport().get_canvas_transform().affine_inverse() * click.position
		var hit: String = _hit_2d(point)
		if hit != "":
			_emit("actor-click", hit, "", "")


## 2D click test (top-most node first), same box test as the OmniStage 2D stage.
func _hit_2d(point: Vector2) -> String:
	var ids: Array = _nodes.keys()
	for i in range(ids.size() - 1, -1, -1):
		var id: String = ids[i]
		var node := _nodes[id] as Node2D
		if node == null or not node.visible or not node.has_meta("omni_half"):
			continue
		var half: Vector2 = node.get_meta("omni_half")
		var local: Vector2 = point - node.position
		if absf(local.x) <= half.x and absf(local.y) <= half.y:
			return id
	return ""


## Key names as the OmniStage runtime sees them (browser KeyboardEvent.key, lower case).
func _dom_key(event: InputEventKey) -> String:
	var code: Key = event.keycode
	if code == KEY_NONE:
		code = event.physical_keycode
	match code:
		KEY_UP:
			return "arrowup"
		KEY_DOWN:
			return "arrowdown"
		KEY_LEFT:
			return "arrowleft"
		KEY_RIGHT:
			return "arrowright"
		KEY_SPACE:
			return " "
		KEY_ENTER, KEY_KP_ENTER:
			return "enter"
		KEY_ESCAPE:
			return "escape"
	return OS.get_keycode_string(code).to_lower()


func _index(node: Node) -> void:
	for child in node.get_children():
		_index(child)
	if not node.has_meta("omni_id"):
		return
	var id: String = str(node.get_meta("omni_id"))
	_nodes[id] = node
	if node is CollisionObject3D:
		(node as CollisionObject3D).input_event.connect(_on_input_event_3d.bind(id))
	if node is Area3D:
		(node as Area3D).body_entered.connect(_on_body_entered.bind(id))
	elif node is Area2D:
		(node as Area2D).body_entered.connect(_on_body_entered.bind(id))


func _role(id: String) -> String:
	var node: Node = _nodes.get(id)
	if node == null:
		return ""
	return str(node.get_meta("omni_role", ""))


func _is_shown(node: Node) -> bool:
	return node != null and bool(node.get("visible"))


# ---------------------------------------------------------------------------
# Built-in game rules (same numbers as the OmniStage runtime)
# ---------------------------------------------------------------------------

func _on_body_entered(body: Node, id: String) -> void:
	if not body.is_in_group("omni_player") or not body.has_meta("omni_id"):
		return
	var target: Node = _nodes.get(id)
	if not _is_shown(target):
		return
	var handled: bool = _emit("collision", str(body.get_meta("omni_id")), id, "")
	if handled or mode != "game" or ended:
		return
	var role: String = _role(id)
	if role == "collectible":
		add_score(int(target.get_meta("omni_score", 25)))
		_consume(target)
	elif role == "hazard":
		add_score(-10)
		_knock_back(body, target)


func _on_input_event_3d(_camera_node: Node, event: InputEvent, _at: Vector3, _normal: Vector3, _shape: int, id: String) -> void:
	var click := event as InputEventMouseButton
	if click == null or not click.pressed or click.button_index != MOUSE_BUTTON_LEFT:
		return
	var target: Node = _nodes.get(id)
	if not _is_shown(target) or ended:
		return
	var handled: bool = _emit("actor-click", id, "", "")
	var action: String = str(target.get_meta("omni_click", "none"))
	if handled and action != "unbox-tap":
		return
	if mode != "game" and action == "none":
		return
	if action == "unbox-tap":
		_unbox(target, id)
		return
	if mode == "game":
		if action == "collect" or action == "collect-score":
			_consume(target)
		elif action == "destroy":
			_hide(target)
		elif action == "bounce" or action == "jump-boost":
			_hop(target)
	add_score(int(target.get_meta("omni_score", 20)))
	if mode == "game" and (action == "trigger-cta" or action == "cta-redirect"):
		_finish(true)


func _consume(target: Node) -> void:
	if is_2d:
		_hide(target)
	else:
		var spot := Vector3(randf_range(-RESPAWN_RANGE, RESPAWN_RANGE), 0.0, randf_range(-RESPAWN_RANGE, RESPAWN_RANGE))
		target.set_deferred("position", spot)


func _hide(target: Node) -> void:
	target.set_deferred("visible", false)
	if target is CollisionObject3D:
		target.set_deferred("input_ray_pickable", false)
	if target is Area3D or target is Area2D:
		target.set_deferred("monitoring", false)
		target.set_deferred("monitorable", false)


func _hop(target: Node) -> void:
	var node := target as Node3D
	if node == null:
		return
	var base_y: float = node.position.y
	var tween := create_tween()
	tween.tween_property(node, "position:y", base_y + 0.8, 0.18).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tween.tween_property(node, "position:y", base_y, 0.22).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)


func _knock_back(body: Node, hazard: Node) -> void:
	var player := body as Node3D
	var source := hazard as Node3D
	if player == null or source == null:
		return
	var away := Vector3(player.position.x - source.position.x, 0.0, player.position.z - source.position.z)
	if away.length() < 0.001:
		away = Vector3(0.8, 0.0, 0.8)
	player.set_deferred("position", player.position + away.normalized() * 1.1)


func _unbox(target: Node, id: String) -> void:
	var taps: int = int(_taps.get(id, 0)) + 1
	var required: int = int(target.get_meta("omni_unbox_taps", 3))
	_taps[id] = taps
	if taps < required:
		score += 25
		_hop(target)
		_update_hud()
		return
	score = maxi(score + 50, target_score)
	_update_hud()
	_finish(true)


func add_score(points: int) -> void:
	score = maxi(0, score + points)
	_update_hud()
	if mode == "game" and not ended and score >= target_score:
		_finish(true)


func _finish(win: bool) -> void:
	if ended:
		return
	ended = true
	won = win
	if _end_panel == null:
		return
	var title: String = "You win!" if win else "Time's up!"
	if win and end_headline != "":
		title = end_headline
	_end_title.text = title
	_next_button.visible = win and next_scene != ""
	_cta_button.visible = win and cta_text != ""
	_end_panel.visible = true


func restart() -> void:
	get_tree().reload_current_scene()


func go_next() -> void:
	if next_scene == "":
		return
	ended = true
	get_tree().change_scene_to_file(next_scene)


func open_cta() -> void:
	if cta_url.begins_with("https://") or cta_url.begins_with("http://"):
		OS.shell_open(cta_url)


# ---------------------------------------------------------------------------
# Logic graph rules (translated from the OmniStage node graph)
# ---------------------------------------------------------------------------

func _emit(event: String, actor: String, other: String, key: String) -> bool:
	var matched := false
	for rule in logic_rules:
		var r: Dictionary = rule
		if not _matches(r, event, actor, other, key):
			continue
		matched = true
		var subject: String = actor
		if event == "collision":
			subject = _collision_target(r, actor, other)
		_run_steps(r.get("steps", []), subject, actor, other)
	return matched


func _collision_target(rule: Dictionary, actor: String, other: String) -> String:
	var rule_actor: String = str(rule.get("actor", ""))
	var role: String = str(rule.get("target_role", ""))
	var target: String = actor if rule_actor == other else other
	if rule_actor == "" and role != "" and _role(target) != role and _role(actor) == role:
		return actor
	return target


func _matches(rule: Dictionary, event: String, actor: String, other: String, key: String) -> bool:
	if str(rule.get("event", "")) != event:
		return false
	var rule_actor: String = str(rule.get("actor", ""))
	if event == "actor-click" and rule_actor != "" and rule_actor != actor:
		return false
	if event == "collision":
		if rule_actor != "" and rule_actor != actor and rule_actor != other:
			return false
		var target: String = _collision_target(rule, actor, other)
		var rule_other: String = str(rule.get("other", ""))
		if rule_other != "" and rule_other != target:
			return false
		var role: String = str(rule.get("target_role", ""))
		if role != "" and _role(target) != role:
			return false
	if event == "key-press":
		var want: String = str(rule.get("key", ""))
		if want == "wasd / arrows":
			return key in ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"]
		if want != "" and want != key and not (want == "space" and key == " "):
			return false
	return true


func _timeline(from: float, to: float) -> void:
	for rule in logic_rules:
		var r: Dictionary = rule
		if str(r.get("event", "")) != "timeline-cue":
			continue
		var at: float = float(r.get("time", -1.0))
		if at >= 0.0 and at > from and at <= to:
			_run_steps(r.get("steps", []), "", "", "")


func _run_steps(steps: Array, subject: String, actor: String, other: String) -> void:
	var results: Dictionary = {}
	for i in range(steps.size()):
		var step: Dictionary = steps[i]
		if not _needs_met(step.get("needs", []), results):
			continue
		var target_id: String = str(step.get("actor", ""))
		if target_id == "":
			target_id = subject
		var kind: String = str(step.get("type", ""))
		if kind == "score-gate":
			results[i] = score >= int(step.get("value", 0))
		elif kind == "cooldown":
			var cooldown_key: String = str(step.get("key", ""))
			var last: float = float(_cooldowns.get(cooldown_key, -1000000.0))
			var passed: bool = (scene_time - last) * 1000.0 >= float(step.get("ms", 500.0))
			if passed:
				_cooldowns[cooldown_key] = scene_time
			results[i] = passed
		elif kind == "distance":
			var second_id: String = str(step.get("other", ""))
			if second_id == "":
				second_id = actor if target_id == other else other
			var distance: float = _distance(target_id, second_id)
			if distance >= 0.0:
				results[i] = distance < float(step.get("distance", 2.0))
		elif kind == "add-score":
			add_score(int(step.get("value", 0)))
		elif kind == "move":
			_move(target_id, step)
		elif kind == "clip":
			_play_clip(_nodes.get(target_id), str(step.get("clip", "")))
		elif kind == "fov":
			var camera := get_viewport().get_camera_3d()
			if camera != null:
				camera.fov = float(step.get("value", 45.0))


func _needs_met(needs: Array, results: Dictionary) -> bool:
	for need in needs:
		var pair: Array = need
		var index: int = int(pair[0])
		if not results.has(index) or bool(results[index]) != bool(pair[1]):
			return false
	return true


func _distance(a_id: String, b_id: String) -> float:
	var a: Node = _nodes.get(a_id)
	var b: Node = _nodes.get(b_id)
	if a is Node3D and b is Node3D:
		return (a as Node3D).global_position.distance_to((b as Node3D).global_position)
	if a is Node2D and b is Node2D:
		return (a as Node2D).position.distance_to((b as Node2D).position)
	return -1.0


func _move(id: String, step: Dictionary) -> void:
	var node: Node = _nodes.get(id)
	if node is Node3D:
		var body3 := node as Node3D
		var p3: Vector3 = body3.position
		if step.has("position"):
			p3 = step["position"]
		if step.has("x"):
			p3.x = float(step["x"])
		if step.has("y"):
			p3.y = float(step["y"])
		if step.has("z"):
			p3.z = float(step["z"])
		p3.y += float(step.get("impulse_y", 0.0))
		body3.position = p3
	elif node is Node2D:
		var body2 := node as Node2D
		var p2: Vector2 = body2.position
		if step.has("position"):
			p2 = step["position"]
		if step.has("x"):
			p2.x = float(step["x"])
		if step.has("y"):
			p2.y = float(step["y"])
		p2.y -= float(step.get("impulse_y", 0.0))
		body2.position = p2


func _play_clips() -> void:
	for id in _nodes:
		var node: Node = _nodes[id]
		if node.has_meta("omni_clip"):
			_play_clip(node, str(node.get_meta("omni_clip")))


## Plays a glTF animation clip (matched case-insensitively, also "Armature|Clip") on the actor's AnimationPlayer.
func _play_clip(node: Node, clip: String) -> void:
	if node == null or clip == "":
		return
	var wanted: String = clip.to_lower()
	for found in node.find_children("*", "AnimationPlayer", true, false):
		var player := found as AnimationPlayer
		for anim_name in player.get_animation_list():
			var lower: String = String(anim_name).to_lower()
			if lower == wanted or lower.ends_with("|" + wanted):
				var animation := player.get_animation(anim_name)
				if animation != null:
					animation.loop_mode = Animation.LOOP_LINEAR
				player.play(anim_name)
				return


# ---------------------------------------------------------------------------
# HUD and end card (built in code so the .tscn stays simple)
# ---------------------------------------------------------------------------

func _build_hud() -> void:
	var layer := CanvasLayer.new()
	layer.layer = 10
	add_child(layer)
	_hud = VBoxContainer.new()
	_hud.position = Vector2(16, 12)
	_hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(_hud)
	_score_label = _label(26)
	_hud.add_child(_score_label)
	_time_label = _label(18)
	_hud.add_child(_time_label)
	if instructions != "":
		var help := _label(16)
		help.text = instructions
		help.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		help.custom_minimum_size = Vector2(360, 0)
		_hud.add_child(help)
	_hud.visible = mode == "game"
	_end_panel = PanelContainer.new()
	_end_panel.visible = false
	_end_panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	_end_panel.grow_vertical = Control.GROW_DIRECTION_BOTH
	_end_panel.set_anchors_preset(Control.PRESET_CENTER)
	layer.add_child(_end_panel)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 12)
	_end_panel.add_child(column)
	_end_title = _label(34)
	_end_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(_end_title)
	_cta_button = _button(cta_text, open_cta)
	column.add_child(_cta_button)
	_next_button = _button("Next level", go_next)
	column.add_child(_next_button)
	column.add_child(_button("Play again", restart))
	_update_hud()


func _label(font_size: int) -> Label:
	var label := Label.new()
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	label.add_theme_constant_override("outline_size", 6)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return label


func _button(text: String, action: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.custom_minimum_size = Vector2(220, 48)
	button.pressed.connect(action)
	return button


func _update_hud() -> void:
	if _score_label == null:
		return
	_score_label.text = "Score: %d / %d" % [score, target_score]
	_time_label.text = "Time: %d s" % int(ceil(time_left))
`;

export const GODOT_PLAYER_3D_SCRIPT = `extends CharacterBody3D
## OmniStage AI export: player movement on the arena (WASD / arrow keys, or drag with the mouse / a finger).
## The same script in every export; speed and arena size are set in the scene (OmniStage runtime: 4.2 m/s, +-5.5 m).

@export var speed: float = 4.2
@export var arena_half: float = 5.5

var _dragging: bool = false
var _drag_from: Vector2 = Vector2.ZERO
var _drag_dir: Vector2 = Vector2.ZERO


func _unhandled_input(event: InputEvent) -> void:
	var button := event as InputEventMouseButton
	if button != null and button.button_index == MOUSE_BUTTON_LEFT:
		_dragging = button.pressed
		_drag_from = button.position
		_drag_dir = Vector2.ZERO
	var motion := event as InputEventMouseMotion
	if motion != null and _dragging:
		var offset: Vector2 = motion.position - _drag_from
		_drag_dir = offset / 80.0 if offset.length() > 12.0 else Vector2.ZERO


func _physics_process(_delta: float) -> void:
	var game: Node = owner
	if game != null and game.has_method("controls_enabled") and not bool(game.call("controls_enabled")):
		velocity = Vector3.ZERO
		return
	var move := Vector2(_axis(KEY_D, KEY_RIGHT) - _axis(KEY_A, KEY_LEFT), _axis(KEY_S, KEY_DOWN) - _axis(KEY_W, KEY_UP))
	if move == Vector2.ZERO:
		move = _drag_dir
	if move.length() > 1.0:
		move = move.normalized()
	velocity = Vector3(move.x, 0.0, move.y) * speed
	if move != Vector2.ZERO:
		rotation.y = atan2(move.x, move.y)
	move_and_slide()
	position.x = clampf(position.x, -arena_half, arena_half)
	position.z = clampf(position.z, -arena_half, arena_half)


func _axis(primary: Key, secondary: Key) -> float:
	return 1.0 if Input.is_physical_key_pressed(primary) or Input.is_physical_key_pressed(secondary) else 0.0
`;

export const GODOT_PLAYER_2D_SCRIPT = `extends CharacterBody2D
## OmniStage AI export: 2D player (platformer or top-down) with the OmniStage runtime tuning.
## Keys: A / D or arrows to run, W / Up / Space to jump (platformer) or move (top-down).
## Touch / mouse: hold left or right of the player to run, tap above it to jump.

@export_enum("platformer", "topdown") var control: String = "platformer"
@export var run_speed: float = 320.0
@export var jump_velocity: float = 520.0
@export var gravity: float = 882.0
@export var stage_size: Vector2 = Vector2(1000, 600)
@export var half_size: Vector2 = Vector2(20, 20)

var _spawn: Vector2 = Vector2.ZERO
var _touching: bool = false
var _touch_at: Vector2 = Vector2.ZERO
var _jump_queued: bool = false


func _ready() -> void:
	_spawn = position


func _unhandled_input(event: InputEvent) -> void:
	var button := event as InputEventMouseButton
	if button != null and button.button_index == MOUSE_BUTTON_LEFT:
		_touching = button.pressed
		_touch_at = _stage_point(button.position)
		if button.pressed and _touch_at.y < position.y - half_size.y:
			_jump_queued = true
	var motion := event as InputEventMouseMotion
	if motion != null and _touching:
		_touch_at = _stage_point(motion.position)


func _stage_point(screen: Vector2) -> Vector2:
	return get_canvas_transform().affine_inverse() * screen


func _physics_process(delta: float) -> void:
	var game: Node = owner
	if game != null and game.has_method("controls_enabled") and not bool(game.call("controls_enabled")):
		velocity = Vector2.ZERO
		return
	var left: bool = _key(KEY_A, KEY_LEFT) or (_touching and _touch_at.x < position.x - 12.0)
	var right: bool = _key(KEY_D, KEY_RIGHT) or (_touching and _touch_at.x > position.x + 12.0)
	if left:
		velocity.x = -run_speed
	elif right:
		velocity.x = run_speed
	else:
		velocity.x *= 0.82
	if control == "topdown":
		var up: bool = _key(KEY_W, KEY_UP) or (_touching and _touch_at.y < position.y - 12.0)
		var down: bool = _key(KEY_S, KEY_DOWN) or (_touching and _touch_at.y > position.y + 12.0)
		if up:
			velocity.y = -run_speed
		elif down:
			velocity.y = run_speed
		else:
			velocity.y *= 0.82
	else:
		var jump: bool = _key(KEY_W, KEY_UP) or Input.is_physical_key_pressed(KEY_SPACE) or _jump_queued
		_jump_queued = false
		if jump and is_on_floor():
			velocity.y = -jump_velocity
		velocity.y += gravity * delta
	move_and_slide()
	position.x = clampf(position.x, half_size.x, stage_size.x - half_size.x)
	if control == "topdown":
		position.y = clampf(position.y, half_size.y, stage_size.y - half_size.y)
	elif position.y > stage_size.y + 100.0:
		position = _spawn
		velocity = Vector2.ZERO


func _key(primary: Key, secondary: Key) -> bool:
	return Input.is_physical_key_pressed(primary) or Input.is_physical_key_pressed(secondary)
`;

/** Small project icon (Godot shows it in the project manager). */
export const GODOT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="#0B101B"/><circle cx="64" cy="64" r="34" fill="none" stroke="#22D3EE" stroke-width="10"/><circle cx="64" cy="64" r="12" fill="#FBBF24"/></svg>
`;
