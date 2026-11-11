class_name MenuBackdrop
extends Control
## The painted scene behind the menus: sunset sky, sun, drifting clouds, a soda sea and grassy
## islands with a few Squirmlings bobbing on them. Drawn with canvas calls only, no image files.

const SKY_TOP := Color("3f6fd0")
const SKY_MID := Color("ff9e7a")
const SKY_LOW := Color("ffd58a")
const SEA_FAR := Color("2f9db0")
const SEA_NEAR := Color("6fe6c4")
const GRASS := Color("8fdc4a")
const GRASS_DARK := Color("5fb53a")
const SOIL := Color("c9763f")
const SOIL_DARK := Color("8f4f2c")
const CLOUD := Color("fff3e6")
const INK := Color("3b2a1a")

## Fewer worms and a calmer scene for screens with a lot of text on top.
var quiet := false
var _time := 0.0


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	resized.connect(queue_redraw)


func _process(dt: float) -> void:
	_time += dt
	queue_redraw()


func _draw() -> void:
	var w := size.x
	var h := size.y
	if w < 2.0 or h < 2.0:
		return
	var horizon := h * 0.62
	_sky(w, horizon)
	_sun(Vector2(w * 0.72, horizon - h * 0.10), h * 0.11)
	_clouds(w, horizon)
	_sea(w, h, horizon)
	var unit := h / 720.0
	# Far islands first, then the near ones.
	_island(Vector2(w * 0.16, horizon + 6.0 * unit), 150.0 * unit, 46.0 * unit, 1.0)
	_island(Vector2(w * 0.90, horizon + 14.0 * unit), 190.0 * unit, 60.0 * unit, 2.3)
	if not quiet:
		_worm(Vector2(w * 0.16, horizon - 36.0 * unit), 1.0 * unit, Color("e85d4a"), 0.0, 0)
		_worm(Vector2(w * 0.885, horizon - 40.0 * unit), 1.15 * unit, Color("4aa3df"), 1.4, 1)
	_island(Vector2(w * 0.06, h * 0.93), 330.0 * unit, 120.0 * unit, 4.1)
	_island(Vector2(w * 0.97, h * 0.97), 360.0 * unit, 130.0 * unit, 5.7)
	_worm(Vector2(w * 0.07, h * 0.93 - 102.0 * unit), 2.1 * unit, Color("f2b544"), 2.2, 2)
	if not quiet:
		_worm(Vector2(w * 0.95, h * 0.97 - 112.0 * unit), 2.3 * unit, Color("5cc49b"), 3.6, 3)


func _sky(w: float, horizon: float) -> void:
	var strips := 40
	for i in range(strips):
		var t0 := float(i) / float(strips)
		var c: Color
		if t0 < 0.6:
			c = SKY_TOP.lerp(SKY_MID, t0 / 0.6)
		else:
			c = SKY_MID.lerp(SKY_LOW, (t0 - 0.6) / 0.4)
		draw_rect(Rect2(0.0, horizon * t0, w, horizon / float(strips) + 1.0), c, true)


func _sun(at: Vector2, r: float) -> void:
	for i in range(6):
		var k := 1.0 + float(6 - i) * 0.35
		draw_circle(at, r * k, Color(1.0, 0.93, 0.7, 0.06))
	draw_circle(at, r, Color("fff1b8"))
	draw_circle(at, r * 0.82, Color("fffbe6"))


func _clouds(w: float, horizon: float) -> void:
	for i in range(6):
		var speed := 6.0 + float(i) * 2.5
		var span := w + 400.0
		var x := fposmod(float(i) * 371.0 + _time * speed, span) - 200.0
		var y := horizon * (0.12 + 0.11 * float(i % 4)) + sin(float(i) * 2.1) * 12.0
		var s := (0.7 + 0.25 * float(i % 3)) * size.y / 720.0
		for j in range(5):
			var off := Vector2(float(j - 2) * 34.0, -absf(float(j - 2)) * -6.0 - (10.0 if j % 2 == 1 else 0.0)) * s
			draw_circle(Vector2(x, y) + off, (26.0 + float((j * 7 + i * 3) % 12)) * s, CLOUD)


func _sea(w: float, h: float, horizon: float) -> void:
	var strips := 24
	for i in range(strips):
		var t0 := float(i) / float(strips)
		var y := horizon + (h - horizon) * t0
		draw_rect(Rect2(0.0, y, w, (h - horizon) / float(strips) + 1.0), SEA_FAR.lerp(SEA_NEAR, t0), true)
	# Soft highlights that slide sideways, wider and slower near the bottom.
	for i in range(9):
		var t1 := float(i + 1) / 10.0
		var y2 := horizon + (h - horizon) * t1 * t1
		var length := 60.0 + 220.0 * t1
		var x2 := fposmod(float(i) * 263.0 + _time * (10.0 + 30.0 * t1), w + length) - length
		draw_rect(Rect2(x2, y2, length, 3.0 + 4.0 * t1), Color(1, 1, 1, 0.22), true)
		draw_rect(Rect2(fposmod(x2 + w * 0.55, w + length) - length, y2 + 9.0, length * 0.6, 2.0 + 3.0 * t1), Color(1, 1, 1, 0.16), true)


## A rounded grassy hill with a soil underside. `at` is the middle of its waterline.
func _island(at: Vector2, half_w: float, height: float, seed_phase: float) -> void:
	var top := PackedVector2Array()
	var steps := 28
	for i in range(steps + 1):
		var t0 := float(i) / float(steps)
		var x := lerpf(-half_w, half_w, t0)
		var dome := sin(t0 * PI)
		var bumps := 0.12 * sin(t0 * 9.0 + seed_phase) + 0.07 * sin(t0 * 17.0 + seed_phase * 2.0)
		top.append(at + Vector2(x, -height * maxf(0.0, pow(dome, 0.6) * (1.0 + bumps))))
	# Soil body: the dome outline closed by a shallow bowl under the waterline.
	var body := PackedVector2Array(top)
	for i in range(steps + 1):
		var t1 := 1.0 - float(i) / float(steps)
		var x1 := lerpf(-half_w, half_w, t1)
		body.append(at + Vector2(x1 * 0.96, height * 0.30 * sin(t1 * PI) + 2.0))
	draw_colored_polygon(body, SOIL)
	# Grass cap: the same outline pushed down a little, drawn as a thick band of quads.
	var band := height * 0.34
	for i in range(steps):
		var a := top[i]
		var b := top[i + 1]
		var quad := PackedVector2Array([a, b, b + Vector2(0, band), a + Vector2(0, band)])
		draw_colored_polygon(quad, GRASS)
	for i in range(steps):
		var a2 := top[i] + Vector2(0, band)
		var b2 := top[i + 1] + Vector2(0, band)
		draw_line(a2, b2, GRASS_DARK, maxf(2.0, height * 0.05))
	draw_polyline(top, INK, maxf(2.0, height * 0.035), true)
	# Foam where the island meets the soda.
	draw_line(at + Vector2(-half_w * 1.02, 2.0), at + Vector2(half_w * 1.02, 2.0), Color(1, 1, 1, 0.75), maxf(3.0, height * 0.06))


## A Squirmling: a toy worm of stacked rings with a round head, big eyes and a hat.
## `at` is where it stands; `s` scales it (1.0 is about 60 px tall).
func _worm(at: Vector2, s: float, color: Color, phase: float, hat: int) -> void:
	var bob := sin(_time * 2.2 + phase)
	var sway := sin(_time * 1.3 + phase) * 4.0 * s
	var rings := 5
	var ring_h := 9.0 * s
	var cream := Color("fff0d6")
	# Shadow on the grass.
	_ellipse(at + Vector2(0, 2.0 * s), Vector2(20.0, 5.0) * s, Color(0, 0, 0, 0.18))
	var top := at
	for i in range(rings):
		var k := float(i) / float(rings)
		var centre := at + Vector2(sway * k * k, -ring_h * (float(i) + 0.5) * (1.0 + bob * 0.04))
		var radius := (17.0 - 3.5 * k) * s
		var fill := color if i % 2 == 0 else cream
		_ellipse(centre, Vector2(radius + 1.6 * s, ring_h * 0.72 + 1.6 * s), INK)
		_ellipse(centre, Vector2(radius, ring_h * 0.72), fill)
		top = centre
	var head := top + Vector2(sway * 0.25, -15.0 * s)
	draw_circle(head, 16.6 * s, INK)
	draw_circle(head, 15.0 * s, color.lightened(0.12))
	# Eyes look towards the middle of the screen.
	var look := signf(size.x * 0.5 - at.x) * 2.2 * s
	for side in [-1.0, 1.0]:
		var eye: Vector2 = head + Vector2(side * 6.0 * s + look * 0.4, -2.0 * s)
		draw_circle(eye, 5.6 * s, INK)
		draw_circle(eye, 4.6 * s, Color.WHITE)
		draw_circle(eye + Vector2(look * 0.6, 0.6 * s), 2.3 * s, INK)
	draw_arc(head + Vector2(look * 0.4, 5.0 * s), 5.0 * s, 0.2, PI - 0.2, 10, INK, maxf(1.5, 1.6 * s), true)
	_hat(head + Vector2(0, -12.0 * s), s, hat)


func _hat(at: Vector2, s: float, kind: int) -> void:
	match kind % 4:
		0:  # party cone
			var cone := PackedVector2Array([at + Vector2(-9, 2) * s, at + Vector2(9, 2) * s, at + Vector2(1, -22) * s])
			draw_colored_polygon(cone, Color("f2b544"))
			draw_polyline(PackedVector2Array([cone[0], cone[1], cone[2], cone[0]]), INK, maxf(1.5, 1.6 * s), true)
			draw_circle(at + Vector2(1, -23) * s, 3.4 * s, Color("e85d4a"))
		1:  # flat cap with a brim
			_ellipse(at + Vector2(0, 1) * s, Vector2(15, 4.5) * s, INK)
			_ellipse(at + Vector2(0, -3) * s, Vector2(10.5, 7.5) * s, INK)
			_ellipse(at + Vector2(0, -3) * s, Vector2(9, 6) * s, Color("e85d4a"))
			_ellipse(at + Vector2(0, 1) * s, Vector2(13.5, 3.2) * s, Color("c94a3a"))
		2:  # tall top hat
			_ellipse(at + Vector2(0, 1) * s, Vector2(15, 4) * s, INK)
			draw_rect(Rect2(at + Vector2(-9, -19) * s, Vector2(18, 20) * s), INK, true)
			draw_rect(Rect2(at + Vector2(-7.5, -17.5) * s, Vector2(15, 12) * s), Color("5b4a8a"), true)
			draw_rect(Rect2(at + Vector2(-7.5, -6) * s, Vector2(15, 4) * s), Color("f2b544"), true)
		_:  # leaf sprout
			draw_line(at + Vector2(0, 2) * s, at + Vector2(0, -10) * s, INK, maxf(2.0, 2.4 * s))
			_ellipse(at + Vector2(-6, -12) * s, Vector2(7, 3.6) * s, INK)
			_ellipse(at + Vector2(-6, -12) * s, Vector2(5.6, 2.4) * s, Color("8fdc4a"))
			_ellipse(at + Vector2(6, -14) * s, Vector2(7, 3.6) * s, INK)
			_ellipse(at + Vector2(6, -14) * s, Vector2(5.6, 2.4) * s, Color("8fdc4a"))


func _ellipse(centre: Vector2, radii: Vector2, color: Color) -> void:
	if radii.x <= 0.0 or radii.y <= 0.0:
		return
	draw_set_transform(centre, 0.0, Vector2(1.0, radii.y / radii.x))
	draw_circle(Vector2.ZERO, radii.x, color)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
