import * as THREE from 'three';

/** Placeholder diorama: backdrop layers, a play-plane grid and a 2048x1024 bounds box. */
export function buildScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3e6d3);

  scene.add(new THREE.HemisphereLight(0xfff4e0, 0xc9a98a, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(500, 800, 1000);
  scene.add(sun);

  // Parallax-ready backdrop layers (placeholder paper cutouts, behind the play plane).
  const layerColors = [0xe8d3b5, 0xdcc3a0, 0xd1b48e];
  layerColors.forEach((color, i) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 1800),
      new THREE.MeshBasicMaterial({ color }),
    );
    mesh.position.set(1024, -512, -100 - i * 100);
    mesh.name = `backdrop-${i}`;
    scene.add(mesh);
  });

  // Map bounds (world: x 0..2048 right, y 0..-1024 down; matches the terrain mask flipped on y).
  const bounds = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(2048, 1024)),
    new THREE.LineBasicMaterial({ color: 0x3b2a1a }),
  );
  bounds.position.set(1024, -512, 1);
  scene.add(bounds);

  const grid = new THREE.GridHelper(2048, 32, 0x8a6b4a, 0xc9ac88);
  grid.rotation.x = Math.PI / 2;
  grid.position.set(1024, -512, 0.5);
  scene.add(grid);

  // Test cube so the 3D-on-2D-plane look can be judged.
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(60, 60, 60),
    new THREE.MeshStandardMaterial({ color: 0xe0805a, roughness: 0.8 }),
  );
  cube.position.set(1024, -512, 30);
  cube.name = 'test-cube';
  scene.add(cube);

  return scene;
}
