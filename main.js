import * as THREE from 'three';
import GPGPU from './GPGPU_LBM.js';

import Stats from 'three/addons/libs/stats.module.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { Clock } from 'three';


const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera( 75, innerWidth / innerHeight, 0.1, 1000 );



const color = 0xFFFFFF;
const intensity = 0.5;
const light = new THREE.DirectionalLight(color, intensity);
light.position.set(-1, 2, 4);
scene.add(light);
scene.add( new THREE.AxesHelper(2) );


const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize( innerWidth, innerHeight );
document.body.appendChild( renderer.domElement );
renderer.sortObjects = true;


const gl = renderer.getContext();
// for debug‑shaders info:
const debugExt = gl.getExtension( 'WEBGL_debug_shaders' );
if ( ! debugExt ) console.warn( 'debug_shaders not supported' );



const controls = new OrbitControls(camera, renderer.domElement );


const geometry = new THREE.BoxGeometry( 0.25, 0.25, 0.25 );
const material = new THREE.MeshPhongMaterial( { color: 0x00ff00 } );
const cube = new THREE.Mesh( geometry, material );
//scene.add( cube );
//scene.background = new THREE.Color(0xf0f0f0);
scene.rotateX(-Math.PI/2); 

const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath( '/draco/gltf/' );
dracoLoader.setDecoderConfig({ type: 'wasm' });
dracoLoader.preload();
loader.setDRACOLoader( dracoLoader );


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function dumpRT( rt ) {
  const w=rt.width, h=rt.height;
  const buf = new Float32Array(4*w*h);
  renderer.readRenderTargetPixels(rt,0,0,w,h,buf);
  console.log(buf);
}

let Lx = 0.5;
let Ly = 0.5;
let Lz = 0.5;
let NX = 64;

let gpgpu = new GPGPU({
  camera: camera,
  renderer: renderer,
  scene: scene,
  NX: NX,
  Lx: Lx,
  Ly: Ly,
  Lz: Lz
});

camera.position.set( 1.5*Lx, 1.5*Ly, -1.5*Lz );
camera.lookAt( Lx,Ly/2.0,Lz/2.0);

gpgpu.createVizCells();

// Create GUI
const gui = new GUI();

// Create a parameters object to hold values
const params = {
  physicsHz: 30,
  viscosity: gpgpu.utils.nu_phys,
  inletVelocity: gpgpu.utils.u_inlet_physX,
  gravity: gpgpu.utils.gravity_physY,
  showWalls: true,
  colorIntensity: 1.0,
};

// Physics rate control
gui.add(params, 'physicsHz', 5, 120, 1).name('Physics Hz').onChange(value => {
  clearInterval(simulationLoop);
  simulationLoop = setInterval(() => {
    gpgpu.compute();
  }, 1000 / value);
});


// LBM parameters
const lbmFolder = gui.addFolder('LBM Parameters');

lbmFolder.add(params, 'viscosity', 1e-6, 1e-4, 1e-6).name('Viscosity').onChange(value => {
  gpgpu.utils.nu_phys = value;
  // Recalculate dependent parameters
  gpgpu.utils.nu_lbm = calculateLBMViscosity(value);
  gpgpu.utils.tau = 3.0 * gpgpu.utils.nu_lbm + 0.5;
  gpgpu.utils.omega = 1.0 / gpgpu.utils.tau;
  
  // Update uniforms
  gpgpu.fVar.material.uniforms.uOmega.value = gpgpu.utils.omega;
  gpgpu.fVar.material.uniforms.uOmtauinv.value = 1.0 - gpgpu.utils.omega;
  gpgpu.fVar.material.uniforms.uOmtauinv_2.value = 1.0 - gpgpu.utils.omega/2.0;
});

lbmFolder.add(params, 'inletVelocity', 0.001, 0.05, 0.001).name('Inlet Velocity').onChange(value => {
  gpgpu.utils.u_inlet_physX = value;
  gpgpu.fVar.material.uniforms.uU_inlet_X.value = value;
});

lbmFolder.add(params, 'gravity', -0.01, 0.01, 0.0001).name('Gravity Z').onChange(value => {
  gpgpu.utils.gravity_physZ = value;
  gpgpu.fVar.material.uniforms.uGy.value = value;
});

const vizFolder = gui.addFolder('Visualization');

vizFolder.add(params, 'showWalls', true).name('Show Walls').onChange(value => {
  // Toggle visibility of wall cells
  const material = gpgpu.inst.material;
  material.uniforms.uShowWalls = { value: value ? 1.0 : 0.0 };
});

vizFolder.add(params, 'colorIntensity', 0.1, 3.0, 0.1).name('Color Intensity').onChange(value => {
  // Adjust color multiplier in visualization shader
  const material = gpgpu.inst.material;
  material.uniforms.uColorIntensity = { value: value };
});

// Misc utilities
const utilsFolder = gui.addFolder('Utilities');

utilsFolder.add({ resetSim: () => {
  // Reset simulation
  //gpgpu.utils.resetSimulation();
  gpgpu.resetSim();

  // Apply stored GUI parameters to the new simulation
  
  // Update viscosity & related parameters
  gpgpu.utils.nu_phys = currentParams.viscosity;
  gpgpu.utils.nu_lbm = calculateLBMViscosity(currentParams.viscosity);
  gpgpu.utils.tau = 3.0 * gpgpu.utils.nu_lbm + 0.5;
  gpgpu.utils.omega = 1.0 / gpgpu.utils.tau;
  
  // Update compute shader uniforms with user-selected values
  gpgpu.fVar.material.uniforms.uOmega.value = gpgpu.utils.omega;
  gpgpu.fVar.material.uniforms.uOmtauinv.value = 1.0 - gpgpu.utils.omega;
  gpgpu.fVar.material.uniforms.uOmtauinv_2.value = 1.0 - gpgpu.utils.omega/2.0;
  
  // Update velocity, gravity, etc.
  gpgpu.utils.u_inlet_physX = currentParams.inletVelocity;
  gpgpu.fVar.material.uniforms.uU_inlet_X.value = currentParams.inletVelocity;
  
  gpgpu.utils.gravity_physY = currentParams.gravity;
  gpgpu.fVar.material.uniforms.uGy.value = currentParams.gravity;
  
  // Update visualization settings
  gpgpu.inst.material.uniforms.uShowWalls.value = currentParams.showWalls ? 1.0 : 0.0;
  gpgpu.inst.material.uniforms.uColorIntensity.value = currentParams.colorIntensity; 
  
}}, 'resetSim').name('Reset Simulation');

// Helper function to convert physical to lattice viscosity
function calculateLBMViscosity(phys_viscosity) {
  // Whatever conversion logic you use
  return phys_viscosity / (gpgpu.utils.dx_phys * gpgpu.utils.cs);
}

// Make sure your viz shader has these uniforms
gpgpu.inst.material.uniforms.uShowWalls = { value: true };
gpgpu.inst.material.uniforms.uColorIntensity = { value: 1.0 };

const clock = new Clock();
const simDt = gpgpu.dt_phys/16; // e.g. 1/120

let simulationLoop = setInterval(() => {
  gpgpu.compute();
}, 1000*simDt);

// Graphics rendering loop at screen refresh rate (typically 60+ Hz)
renderer.setAnimationLoop(() => {
  // Only update controls & draw - no physics here
  controls.update();
  
  // Unbind any MRT target and restore single-buffer draw
  renderer.setRenderTarget(null);
  const gl = renderer.getContext();
  gl.drawBuffers([gl.BACK]);
  
  // Render the scene
  renderer.render(scene, camera);
});

// Optional: Pause simulation when window loses focus
window.addEventListener('blur', () => {
  clearInterval(simulationLoop);
});

window.addEventListener('focus', () => {
  simulationLoop = setInterval(() => {
    gpgpu.compute();
  }, 1000*simDt);
});




//renderer.setAnimationLoop( renderLoop );








