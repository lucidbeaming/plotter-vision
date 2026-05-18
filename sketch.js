/*
 * Parse ascii or binary STL file into a list of triangles
 * Binary Header (84 bytes):
 *   80 byte name
 *   uint32_t number of triangles
 *
 * Binary Triangle (50 bytes)
 *   3 32-bit float normals
 *   9 32-bit float x,y,z tripples
 *   uint16_t attributes (ignored)
 */

let x_offset;
let y_offset;
let z_scale = 1;
dark_mode = false;
redblue_mode = false;

// new controls
let stroke_width = 1;
let line_color = '#000000';
let show_coplanar_edges = false;
let min_area_threshold = 2;

function parseHexColor(hex) {
	const r = parseInt(hex.slice(1,3), 16);
	const g = parseInt(hex.slice(3,5), 16);
	const b = parseInt(hex.slice(5,7), 16);
	return [r, g, b];
}

// blue color suggested by https://mastodon.sdf.org/@elb/105351977660915938
red_color = 0xff0000;
blue_color = 0x14ecfc;

verbose = false;

stl = false;
stl2 = false;
let camera;
let camera2; // for 3D
eye_separation = 2;
redraw = false;
reproject = false;
let camera_psi = 0;
let camera_theta = 0;
let camera_radius = 100;
let camera_roll = 0; // degrees, rotates camera around its view axis

function computeEye()
{
	// normalize theta and psi
	if (camera_theta < -Math.PI)
		camera_theta += 2 * Math.PI;
	else
	if (camera_theta > +Math.PI)
		camera_theta -= 2 * Math.PI;

	if (camera_psi < -Math.PI)
		camera_psi += 2 * Math.PI;
	else
	if (camera_psi > +Math.PI)
		camera_psi -= 2 * Math.PI;

	camera.eye.x = camera_radius * Math.sin(camera_theta) * Math.sin(camera_psi);
	camera.eye.y = camera_radius * Math.sin(camera_theta) * Math.cos(camera_psi);
	camera.eye.z = camera_radius * Math.cos(camera_theta);

	// Reset up vector fully before applying roll (x/y may be non-zero from prior frame)
	camera.up.x = 0;
	camera.up.y = 0;
	camera.up.z = camera_theta < 0 ? -1 : 1;

	camera.eye.add(camera.lookat);

	if (camera_roll !== 0) {
		// Rotate the up vector around the view axis (eye → lookat) using
		// Rodrigues' rotation formula: v' = v·cosθ + (k×v)·sinθ + k·(k·v)·(1−cosθ)
		const angle = camera_roll * Math.PI / 180;
		const dx = camera.lookat.x - camera.eye.x;
		const dy = camera.lookat.y - camera.eye.y;
		const dz = camera.lookat.z - camera.eye.z;
		const dl = Math.sqrt(dx*dx + dy*dy + dz*dz);
		const kx = dx/dl, ky = dy/dl, kz = dz/dl;
		const uz = camera.up.z; // (0, 0, ±1)
		const c = Math.cos(angle), s = Math.sin(angle);
		const kdotv = kz * uz; // k · (0,0,uz)
		const cvx = ky * uz, cvy = -kx * uz; // k × (0,0,uz), z-component is 0
		camera.up.x = cvx*s + kx*kdotv*(1-c);
		camera.up.y = cvy*s + ky*kdotv*(1-c);
		camera.up.z = uz*c  + kz*kdotv*(1-c);
	}

	camera.update_matrix();

	// duplicate for 3D (lookat is shared)
	// should scale the eye separation based on the radius since
	// otherwise it becomes weird at long distances
	// in DARK mode, the eye glasses seem to be backwards?
	// normally left eye is red, right eye is blue, but
	// that messes up with a dark background.
	camera2.eye.x = camera_radius * Math.sin(camera_theta) * Math.sin(camera_psi + eye_separation * Math.PI / 180);
	camera2.eye.y = camera_radius * Math.sin(camera_theta) * Math.cos(camera_psi + eye_separation * Math.PI / 180);
	camera2.eye.z = camera_radius * Math.cos(camera_theta);

	// the lookat and up values are shared between the cameras
	camera2.eye.add(camera.lookat);
	camera2.update_matrix();
}



function loadBytes(file, callback) {
  let oReq = new XMLHttpRequest();
  oReq.open("GET", file, true);
  oReq.responseType = "arraybuffer";
  oReq.onload = function(oEvent) {
    let arrayBuffer = oReq.response;
    if (arrayBuffer && callback) {
      callback(arrayBuffer);
    }
  }
  oReq.send(null);
}


function setup()
{
	const holder = document.getElementById('sketch-holder');
	let canvas = createCanvas(holder.offsetWidth, holder.offsetHeight);
	x_offset = width/2;
	y_offset = height/2;

	canvas.parent('sketch-holder');

	background(0);

	loadBytes("test.stl", function(d){
		stl = new STL(d);
		stl2 = new STL(d);
		reproject = true;
	});

	// initial viewport
	vx = vy = vz = 0;
	camera_theta = 70 * Math.PI / 180;
	camera_psi = -150 * Math.PI / 180;
	camera_radius = 170;

	let eye = createVector(0,camera_radius,0);
	let eye2 = createVector(0,camera_radius,0);
	let lookat = createVector(0,0,00);
	let up = createVector(0,0,1);
	let fov = 60;
	camera = new Camera(eye,lookat,up,fov);
	camera2 = new Camera(eye2,lookat,up,fov);

	computeEye();
}


function v3_line(p0,p1)
{
	if (verbose)
	{
		push()
		color(255,255,255,40);
		stroke(0.1);
		text(p0.z.toFixed(2), p0.x, -p0.y);
		text(p1.z.toFixed(2), p1.x, -p1.y);
		pop();
	}

	line(p0.x, -p0.y, p1.x, -p1.y);
}


function drawAxis(camera, lookat)
{
	// draw an axis marker at the look-at point
	const origin = camera.project(lookat)
	const xaxis = camera.project(new p5.Vector(5,0,0).add(lookat));
	const yaxis = camera.project(new p5.Vector(0,5,0).add(lookat));
	const zaxis = camera.project(new p5.Vector(0,0,5).add(lookat));
	strokeWeight(5);

	if (!xaxis || !yaxis || !zaxis)
	{
		// draw them anyway, since no good ordering is possible
		stroke(255,0,0);
		if (xaxis) v3_line(origin, xaxis);
		stroke(0,255,0);
		if (yaxis) v3_line(origin, yaxis);
		stroke(0,0,255);
		if (zaxis) v3_line(origin, zaxis);
		return;
	}

	// draw the axis lines in back-to-front order
	const xd = xaxis.z;
	const yd = yaxis.z;
	const zd = zaxis.z;
	if (xd > yd && yd > zd)
	{
		stroke(255,0,0); v3_line(origin, xaxis);
		stroke(0,255,0); v3_line(origin, yaxis);
		stroke(0,0,255); v3_line(origin, zaxis);
	} else
	if (xd > zd && zd > yd)
	{
		stroke(255,0,0); v3_line(origin, xaxis);
		stroke(0,0,255); v3_line(origin, zaxis);
		stroke(0,255,0); v3_line(origin, yaxis);
	} else
	if (yd > xd && xd > zd)
	{
		stroke(0,255,0); v3_line(origin, yaxis);
		stroke(255,0,0); v3_line(origin, xaxis);
		stroke(0,0,255); v3_line(origin, zaxis);
	} else
	if (yd > zd && zd > xd)
	{
		stroke(0,255,0); v3_line(origin, yaxis);
		stroke(0,0,255); v3_line(origin, zaxis);
		stroke(255,0,0); v3_line(origin, xaxis);
	} else
	if (zd > xd && xd > yd)
	{
		stroke(0,0,255); v3_line(origin, zaxis);
		stroke(255,0,0); v3_line(origin, xaxis);
		stroke(0,255,0); v3_line(origin, yaxis);
	} else
	if (zd > yd && yd > xd)
	{
		stroke(0,0,255); v3_line(origin, zaxis);
		stroke(0,255,0); v3_line(origin, yaxis);
		stroke(255,0,0); v3_line(origin, xaxis);
	} else {
		// wtf how did we end up here?
	}
}


function cameraView(theta, psi)
{
	camera_theta = theta * Math.PI / 180;
	camera_psi = psi * Math.PI / 180;
	computeEye();
	reproject = true;

	if (typeof syncControl !== 'function') return;
	let pn = psi % 360;
	if (pn > 180) pn -= 360;
	if (pn < -180) pn += 360;
	syncControl('theta', theta);
	syncControl('psi', pn);
}

function keyTyped()
{
	if (key === 'v')
	{
		verbose = !verbose;
		reproject = true;
	}

	if (key === '1')
		cameraView(90, 0);

	if (key === '2')
		cameraView(90, 90);

	if (key === '3')
		cameraView(90, 180);

	if (key === '4')
		cameraView(90, 270);

	if (key === '5')
		cameraView(1, 1);

	if (key === 't')
	{
		redblue_mode = !redblue_mode;
		reproject = true;
	}
}


function mouseWheel(event)
{
	camera_radius = Math.max(20, Math.min(400, camera_radius + event.delta * 0.5));
	if (typeof syncControl === 'function') syncControl('zoom', int(camera_radius));
	computeEye();
	reproject = true;
	return false;
}

function windowResized() {
	const holder = document.getElementById('sketch-holder');
	resizeCanvas(holder.offsetWidth, holder.offsetHeight);
	camera.width = width;
	camera.height = height;
	x_offset = width/2;
	y_offset = height/2;
	reproject = true;
}

function draw()
{
	if (!stl)
		return;

	// if there are segments left to process, continue to force redraw
	if (!stl || !(redraw || reproject))
		return;

	redraw = false;

	if(reproject)
	{
		reproject = false;
		redraw = true;
		stl.project(camera);
		if (redblue_mode)
			stl2.project(camera2);
	}

	if (redblue_mode)
		stl2.do_work(camera2, 200);
	stl.do_work(camera, 200);

	if (dark_mode)
	{
		background(0);
		fill(9);
	} else {
		background(255);
		fill(253);
	}

	noStroke();
	textSize(128);
	textAlign(RIGHT, BOTTOM);
	text("plotter.vision", width, height);

	push();
	translate(x_offset, y_offset);
	scale(z_scale);

	// draw all of our in-processing segments lightly
	strokeWeight(stroke_width);
	if (redblue_mode)
		stroke(200,0,200,100);
	else
		stroke(0,200,0);
	for(let i = stl.seg_head; i < stl.segments.length; i++)
		v3_line(stl.segments[i].p0, stl.segments[i].p1);

	if (show_coplanar_edges)
	{
		stroke(100,0,0,100);
		for(let s of stl.coplanar)
			v3_line(s.p0, s.p1);
	}

	if (stl.seg_head < stl.segments.length || (redblue_mode && stl2.seg_head < stl2.segments.length))
	{
		// if there are in process ones,
		// draw an XYZ axis at the lookat
		// and keep computing
		drawAxis(camera, camera.lookat);
		redraw = true;
	} else {
		// all done, this should be our last pass through
		// the draw loop
		redraw = false;
	}

	// Draw all of our visible segments sharply
	strokeWeight(stroke_width);
	stroke(...parseHexColor(line_color));

	if (redblue_mode)
	{
		stroke(
			((blue_color) >> 16) & 0xFF,
			((blue_color) >>  8) & 0xFF,
			((blue_color) >>  0) & 0xFF,
			200
		);
		for(let s of stl2.visible_segments)
			v3_line(s.p0, s.p1);

		stroke(
			((red_color) >> 16) & 0xFF,
			((red_color) >>  8) & 0xFF,
			((red_color) >>  0) & 0xFF,
			80
		);
	}

	for(let s of stl.visible_segments)
		v3_line(s.p0, s.p1);

	pop();

}
