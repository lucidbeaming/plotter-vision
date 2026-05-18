/*
 * Given a triangle and a line segment in screen coordintes,
 * determine if the line segment is occluded by the triangle.
 *
 * Negative Z distance is behind the camera,
 * Increasing Z is further away
 *
 * Returns:
 */
const tri_no_occlusion = 0; // no occlusion and processing should continue
const tri_in_front = 1; // no occlusion and processing should stop
const tri_hidden = 2; // occlusion and the segment is totally hidden
const tri_clipped = 3; // occlusion and either p0 or p1 has been updated
const tri_split = 4; //  occlusion and p0/p1 have been updated and p2/p3 have been created
const EPS = 0.0000001;

// pre-allocated scratch objects — never allocated in the hot loop
const p_max = {x:0, y:0, z:0};
const p_min = {x:0, y:0, z:0};
const _tp0  = {x:0, y:0, z:0};
const _tp1  = {x:0, y:0, z:0};
const _intercept_s = [{x:0,y:0,z:0}, {x:0,y:0,z:0}, {x:0,y:0,z:0}];
const _intercept_t = [{x:0,y:0,z:0}, {x:0,y:0,z:0}, {x:0,y:0,z:0}];
function copyVec(v) { return {x:v.x, y:v.y, z:v.z}; }

function occlude(t,s,work_queue)
{
	// if this triangle is not visible, then we don't process it
	// since the screen coordinates might be invalid,
	// so this function should not have been called
	if (t.invisible)
		return tri_no_occlusion;

	// if the segment is too short in screen space we are done
	let seg_len = dist2(s.p1, s.p0);
	if (seg_len < 1)
		return tri_hidden;

	v3max(p_max, s.p0, s.p1);
	v3min(p_min, s.p0, s.p1);

	// if the segment max z is closer than the minimum
	// z of the triangle, then this triangle can not occlude
	if (p_max.z <= t.min.z)
		return tri_in_front;

	// perform a screen coordinates bounding box check for the
	// triangle min/max.
	// if the segment lies outside of this box and doesn't
	// cross it, then there is no chance of occlusion
	if (p_max.x < t.min.x || t.max.x < p_min.x)
		return tri_no_occlusion;
	if (p_max.y < t.min.y || t.max.y < p_min.y)
		return tri_no_occlusion;

	// there is a chance this segment crosses the triangle,
	// so compute the barycentric coordinates in triangle space
	t.bary_coord(s.p0, _tp0);
	t.bary_coord(s.p1, _tp1);

	// if both are inside and not both on the same edge
	// (which would indicate that this segment came from this
	// triangle), then it is totally occluded
	if (inside(_tp0) && inside(_tp1))
	{
		// if the segment z is closer than the triangle z
		// then the segment is in front of the triangle
		// equality check in case the segment shares a vertex
		// with the triangle.  If it is coming towards the
		// camera in the other point, the no occlusion.
		if (s.p0.z < _tp0.z+EPS && s.p1.z < _tp1.z+EPS)
			return tri_no_occlusion;

		// this segment either punctures the triangle
		// or something is bad about it.  ignore the other cases
		return tri_hidden;
	}

	// one or neither of the points are totally occluded
	// so find where the extended triangle edge lines intersect
	// the extended segment line.
	let intercepts = 0;

	for(let i = 0 ; i < 3 ; i++)
	{
		const ratio = intercept_lines(
			s.p0, s.p1,
			t.screen[i], t.screen[(i+1) % 3],
			_intercept_s[intercepts],
			_intercept_t[intercepts],
		);
		if (ratio < 0)
			continue;

		// if the segment intercept is closer than the triangle
		// intercept, then this does not count as an intersection
		if (_intercept_s[intercepts].z <= _intercept_t[intercepts].z)
			continue;

		intercepts++;
	}

	let original_intercepts = intercepts;

	// if none of the intersections are within the lines,
	// then there is no possibility of occlusion
	if (intercepts == 0)
		return tri_no_occlusion;

	// for tangent lines it is possible that the intercepts
	// might be the same.  check and remove the duplicates if so
	if (intercepts == 3)
	{
		if (close_enough(_intercept_s[0], _intercept_s[2]))
		{
			intercepts--;
		} else
		if (close_enough(_intercept_s[1], _intercept_s[2]))
		{
			intercepts--;
		} else
		if (close_enough(_intercept_s[0], _intercept_s[1]))
		{
			// shift slot 2 down into slot 1
			_intercept_s[1].x = _intercept_s[2].x;
			_intercept_s[1].y = _intercept_s[2].y;
			_intercept_s[1].z = _intercept_s[2].z;
			_intercept_t[1].x = _intercept_t[2].x;
			_intercept_t[1].y = _intercept_t[2].y;
			_intercept_t[1].z = _intercept_t[2].z;
			intercepts--;
		} else {
			// this should never happen, unless there are very small triangles
			// in which case we discard this triangle
			return tri_hidden;
		}
	}

	if (intercepts == 2)
	{
		if (close_enough(_intercept_s[0], _intercept_s[1]))
			intercepts--;
	}

	// one intercept should mean that only one point is inside
	if (intercepts == 1)
	{
		if (inside(_tp0))
		{
			// clipped from is0 to p1
			s.p0 = copyVec(_intercept_s[0]);
			return tri_clipped;
		}
		if (inside(_tp1))
		{
			// clipped from p0 to is0
			s.p1 = copyVec(_intercept_s[0]);
			return tri_clipped;
		}

		// this might be a tangent, so nothing is clipped
		return tri_no_occlusion;
	}

	// two intercept: figure out which intercept point is closer
	// to which point and create a new segment
	let d00 = dist2(_intercept_s[0], s.p0);
	let d01 = dist2(_intercept_s[1], s.p0);
	let d10 = dist2(_intercept_s[0], s.p1);
	let d11 = dist2(_intercept_s[1], s.p1);

	if (d00 < EPS && d11 < EPS)
		return tri_hidden;
	if (d01 < EPS && d10 < EPS)
		return tri_hidden;

	if (d00 < EPS)
	{
		s.p0 = copyVec(_intercept_s[1]);
		return tri_clipped;
	} else
	if (d01 < EPS)
	{
		s.p0 = copyVec(_intercept_s[0]);
		return tri_clipped;
	} else
	if (d10 < EPS)
	{
		s.p1 = copyVec(_intercept_s[1]);
		return tri_clipped;
	} else
	if (d11 < EPS)
	{
		s.p1 = copyVec(_intercept_s[0]);
		return tri_clipped;
	}

	// neither end point matches, so we'll create a new
	// segment that excludes the space between is0 and is1
	let midpoint = d00 > d01 ? 1 : 0;

	work_queue.push({
		p0: s.p0,
		p1: copyVec(_intercept_s[midpoint]),
	});

	s.p0 = copyVec(_intercept_s[midpoint ? 0 : 1]);

	return tri_split;
}


// Returns true if a barycentric coordinate is inside the triangle
function inside(pb)
{
	let a = pb.x;
	let b = pb.y;
	return -EPS <= a && -EPS <= b && a + b <= 1 + EPS;
}

function dist2(p0,p1)
{
	let dx = p0.x - p1.x;
	let dy = p0.y - p1.y;
	return dx*dx + dy*dy;
}


// Returns ratio along segment of the intercept, or -1 for no intersection.
// Writes the 3D intersection points into out_s and out_t (pre-allocated).
// Solves only the 2D orthographic case for X and Y, then interpolates Z.
function intercept_lines(p0, p1, p2, p3, out_s, out_t)
{
	const s0x = p1.x - p0.x;
	const s0y = p1.y - p0.y;
	const s0z = p1.z - p0.z;
	const s1x = p3.x - p2.x;
	const s1y = p3.y - p2.y;
	const s1z = p3.z - p2.z;

	const d = s0x * s1y - s1x * s0y;

	if (-EPS < d && d < EPS)
		return -1;

	const dy02 = p0.y - p2.y;
	const dx02 = p0.x - p2.x;
	const r0 = (s1x * dy02 - s1y * dx02) / d;
	const r1 = (s0x * dy02 - s0y * dx02) / d;

	if (r0 < 0 || r0 > 1 || r1 < 0 || r1 > 1)
		return -1;

	out_s.x = p0.x + r0 * s0x;
	out_s.y = p0.y + r0 * s0y;
	out_s.z = p0.z + r0 * s0z;
	out_t.x = p2.x + r1 * s1x;
	out_t.y = p2.y + r1 * s1y;
	out_t.z = p2.z + r1 * s1z;

	return r0;
}


// Process a segment against a list of triangles
// returns a list of segments that are visible
// TODO: best if triangles is sorted by z depth
// TODO: figure out a better representation for the screen map
function hidden_wire(s, screen_map, work_queue)
{
	let segments = [];

	let min_key_x = Math.trunc(Math.min(s.p0.x, s.p1.x) / stl_key2d_scale);
	let min_key_y = Math.trunc(Math.min(s.p0.y, s.p1.y) / stl_key2d_scale);
	let max_key_x = Math.trunc(Math.max(s.p0.x, s.p1.x) / stl_key2d_scale);
	let max_key_y = Math.trunc(Math.max(s.p0.y, s.p1.y) / stl_key2d_scale);

	for(let x = min_key_x ; x <= max_key_x ; x++)
	{
		for(let y = min_key_y ; y <= max_key_y ; y++)
		{
			let triangles = screen_map[(x + stl_key2d_offset) * stl_key2d_span + (y + stl_key2d_offset)];
			if (!triangles)
				continue;

	for(let t of triangles)
	{
		if (t.invisible)
			continue;

		let rc = occlude(t, s, work_queue);

		// this segment is no longer visible,
		// but any new segments that it has added to the array
		// will be processed against the triangles again.
		if (rc == tri_hidden)
			return null;

		if (rc == tri_in_front)
		{
			// this line segment is entirely in front of
			// this triangle, which means that no other
			// triangles on the sorted list can occlude
			// the segment, so we're done.
			break;
		}

		if (rc == tri_clipped
		||  rc == tri_no_occlusion)
			continue;

		if (rc == tri_split)
		{
			if (verbose)
				console.log("split", s.p0,s.p1, t);
			continue;
		}

		// huh?
		console.log("occlude() returned? ", rc)
	}
		}
	}

	// if we have made it all the way here, the remaining part
	// of this segment is visible and should be added to the draw list
	return s;
}
