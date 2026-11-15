extends TestCase
## The smooth Squirmling skin: built, skinned to five bones, and carried by the rings.


func test_skin_follows_the_rings() -> void:
	var w := Squirmling.create(0, "", Color.RED)
	for f in range(60):
		w.drive(1.0 / 60.0, true, Vector3(0, 0, 7), true)
	var sk := w.get_node("Model/BodySkeleton") as Skeleton3D
	check(sk.get_bone_count() == Squirmling.RING_COUNT, "one bone per ring")
	for i in range(Squirmling.RING_COUNT):
		var ring := w.get_node("Model/Ring%d" % i) as Node3D
		check(sk.get_bone_pose_position(i).distance_to(ring.position) < 0.001, "bone %d at its ring" % i)
	w.free()


func test_knock_out_swaps_skin_for_beads() -> void:
	var w := Squirmling.create(0, "", Color.RED)
	w.drive(1.0 / 60.0, false, Vector3.ZERO, true)
	w.set_alive(false)
	check(not (w.get_node("Model/BodySkeleton") as Node3D).visible, "skin hidden while popped")
	w.set_alive(true)
	check((w.get_node("Model/BodySkeleton") as Node3D).visible, "skin back when revived")
	w.free()


func test_face_sits_on_the_head_surface() -> void:
	var s := SmoothBody.surface(0.3, 0.2)
	check((s[0] as Vector3).z > 0.3, "the front of the head is in front")
	check((s[1] as Vector3).z > 0.3, "and faces forward")
