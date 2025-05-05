
import * as THREE from 'three';
import lbmUnifiedShader from'./lbmUnifiedShader.glsl?raw';
import visVertexShader   from './visVertex.glsl?raw';
import visFragmentShader from './visFragment.glsl?raw';
import { GPUComputationRendererMRT } from './GPUComputationRendererMRT';
import GPGPUUtils_LBM from './GPGPUUtils_LBM';

export default class GPGPU_LBM {
	constructor({ camera, renderer, scene, NX, 
				Lx=0.1, Ly=0.1, Lz=0.1, 
				u_inlet_physX=0.01, u_inlet_physY=0.0 , u_inlet_physZ=0.0,
				gravity_physX=0.0, gravity_physY=0.0, gravity_physZ=0.0}) {

		this.camera = camera; // Camera
		this.renderer = renderer; // Renderer
		this.scene = scene; // Global scene


		this.NX = NX;
		this.Lx = Lx;
		this.Ly = Ly;
		this.Lz = Lz;
		this.u_inlet_physX = u_inlet_physX;
		this.u_inlet_physY = u_inlet_physY;
		this.u_inlet_physZ = u_inlet_physZ;
		this.gravity_physX = gravity_physX;
		this.gravity_physY = gravity_physY;
		this.gravity_physZ = gravity_physZ;
		this.init();
	}
	
	
	init() {
		this.utils = new GPGPUUtils_LBM(this.NX, 
			this.Lx, this.Ly, this.Lz, 
			this.u_inlet_physX, this.u_inlet_physY , this.u_inlet_physZ,
			this.gravity_physX, this.gravity_physY, this.gravity_physZ); // Setup GPGPUUtils

		this.NY = this.utils.NY;
		this.NZ = this.utils.NZ;

		this.grid = this.utils.NX*this.utils.NY*this.utils.NZ;
		this.dt_phys = this.utils.dt_phys;
		this.initGPGPU();
	}

	initGPGPU() {
        this.gpgpuCompute = new GPUComputationRendererMRT(this.utils.NX, this.utils.NY*this.utils.NZ, this.renderer); // this.sizes.width/height?


		const texf0A = this.utils.getTexf0A();
		const texf0B = this.utils.getTexf0B();
		const texf0C = this.utils.getTexf0C();
		const texf0D = this.utils.getTexf0D();
		const texf0E = this.utils.getTexf0E();

		
		console.table( texf0E.image.data );
		
		//const zeroTex = this.gpgpuCompute.createTexture();
		this.fVar = this.gpgpuCompute.addVariable(
			'uF',           // sampler prefix inside GLSL
			lbmUnifiedShader,
			[ texf0A, texf0B, texf0C, texf0D, texf0E],          // initial data from prev. frame
			[ "uF_0", "uF_1", "uF_2", "uF_3", "uF_4", "uMacro"] // pass output textures as list of names and label them (cleaner)
		);

		

		this.uniforms = {
			uTime: {value: 0},

			// LBM constants
			uOmega: { value: this.utils.omega },
			uOmtauinv: {value: this.utils.omtauinv },
			uOmtauinv_2: {value: this.utils.omtauinv_2 },

			uEu:    { value: this.utils.eu   },
			uEv:    { value: this.utils.ev   },
			uInv:   { value: this.utils.inv  },

			uDirX: { value: this.utils.dirx},
			uDirY: { value: this.utils.diry},
			uDirZ: { value: this.utils.dirz},

			uW:     { value: this.utils.w    },

			uU_inlet_X: {value: this.utils.u_inlet_X},
			uU_inlet_Y: {value: this.utils.u_inlet_Y},
			uU_inlet_Z: {value: this.utils.u_inlet_Z},
			uGx: {value: this.utils.gX},
			uGy: {value: this.utils.gY},
			uGz: {value: this.utils.gZ},
			uRho0: {value: this.utils.rho0}


        };



		// copy your uniforms into the compute material
		Object.entries( this.uniforms ).forEach( ([name, uni]) => {
			this.fVar.material.uniforms[ name ] = uni;
		});

		this.gpgpuCompute.setVariableDependencies(this.fVar, [this.fVar]);

		const err = this.gpgpuCompute.init();

		const rt = this.gpgpuCompute.getCurrentRenderTarget(this.fVar);
		console.log('after init')
		this.readRenderTargetPixelsMRT(rt,4);

		if ( err ) console.error( 'compute‐renderer init failed:', err );
    }

	compute(time) {
        this.gpgpuCompute.compute();

        this.uniforms.uTime.value = time;
    }


	createVizCells() {
		// get the texture containing all the computed macroscopic properaties
		const macroTex = this.gpgpuCompute.getCurrentRenderTarget( this.fVar ).textures[5];

		// 2) build an InstancedMesh of NX×NY×NZ cubes
		let hx = this.Lx/this.NX;
		let hy = this.Ly/this.NY;
		let hz = this.Lz/this.NZ;
		const cubeGeo = new THREE.BoxGeometry(hx,hy,hz);
		const cubeMat = new THREE.ShaderMaterial({
		uniforms: { uMacro: { value: macroTex } },
		glslVersion: THREE.GLSL3, // WebGL‑2 build			
		vertexShader: /* #version 300 es … */ visVertexShader,			
		fragmentShader: /* #version 300 es … */ visFragmentShader,
		transparent: true,
		depthWrite: false,
		blending: THREE.NormalBlending
		});
		const count = this.utils.NX * this.utils.NY * this.utils.NZ;
		const inst = new THREE.InstancedMesh( cubeGeo, cubeMat, count );
		this.inst = inst;
		

		// 3) Generate per‐instance UVs & matrices
		const macroUVs = new Float32Array(count*2);
		let idx = 0;
		const dummy = new THREE.Object3D();

		// for every grid cell
		for ( let z = 0; z < this.utils.NZ; z++ ) {
			for ( let y = 0; y < this.utils.NY; y++ ) {
				for ( let x = 0; x < this.utils.NX; x++ ) {
				// position your cube in world coords and update the local transform

				dummy.position.set( this.Lx*(x+0.5)/this.utils.NX, this.Ly*(y+0.5)/this.utils.NY, this.Lz*(z+0.5)/this.utils.NZ );
				dummy.updateMatrix();

				// set the ith instance's local transform to the one we just set up
				inst.setMatrixAt( idx, dummy.matrix );

				// store UV for this instance
				macroUVs[2*idx]   = (x)/this.NX;
				macroUVs[2*idx+1] = (y + z*this.NY)/(this.NY*this.NZ);
				idx ++;
				}
			}
		}
		inst.geometry.setAttribute(
			'macroUV',
			new THREE.InstancedBufferAttribute(macroUVs, 2)
		  );
		inst.renderOrder =1;
		this.scene.add( inst );
	
	}

	compute() {
		this.gpgpuCompute.compute();
	}

	dumpRT( rt ) {
		const w=rt.width, h=rt.height;
		const buf = new Float32Array(4*w*h);
		this.renderer.readRenderTargetPixels(rt,0,0,w,h,buf);
		console.log(buf);
	  }

	readRenderTargetPixelsMRT(rt,num){
		const w=rt.width, h=rt.height;
		const props  = this.renderer.properties.get( rt );
		const gl     = this.renderer.getContext();
		const fbo    = props.__webglFramebuffer;
		// 2) bind it for reading
		gl.bindFramebuffer( gl.READ_FRAMEBUFFER, fbo );
		// 3) select the attachment you want (e.g. 5)
		let attachment = gl.COLOR_ATTACHMENT0;
		if (num == 0){
			attachment = gl.COLOR_ATTACHMENT0;
		} else if (num==1){
			attachment = gl.COLOR_ATTACHMENT1;
		} else if (num==4){
			attachment = gl.COLOR_ATTACHMENT4;
		} else if (num==5){
			attachment = gl.COLOR_ATTACHMENT5;
		}

		gl.readBuffer( attachment);
		// 4) pull back a single pixel or block
		const buf = new Float32Array( 4 * w * h );
		gl.readPixels( 0, 0, w, h, gl.RGBA, gl.FLOAT, buf );
		console.log( buf );
		// 5) restore  
		gl.readBuffer( attachment);
		gl.bindFramebuffer( gl.READ_FRAMEBUFFER, null );
	}

	resetSim(){
		// 1. Clean up old visualization objects
		if (this.inst) {
			// Remove old instance mesh from scene
			this.scene.remove(this.inst);
			// Dispose geometry, materials and textures to prevent memory leaks
			this.inst.geometry.dispose();
			this.inst.material.dispose();
			if (this.inst.material.uniforms.uMacro?.value) {
			  // Not necessary to dispose RT textures as they're handled by gpgpuCompute
			}
			this.inst = null;
		  }

		this.gpgpuCompute.dispose();
		this.NY = this.utils.NY;
		this.NZ = this.utils.NZ;
		this.grid = this.utils.NX*this.utils.NY*this.utils.NZ;
		this.dt_phys = this.utils.dt_phys;
		this.initGPGPU();

		this.createVizCells();
	}
	
}