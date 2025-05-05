
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';

  

export default class GPGPUUtils_LBM {
	constructor(NX, Lx=0.1, Ly=0.1, Lz=0.1, 
			u_inlet_physX=0.01, u_inlet_physY=0.0 , u_inlet_physZ=0.0,
			gravity_physX=0.0, gravity_physY=0.0, gravity_physZ=0.0) {
	
	// tracer particle params
	//this.size = size;
	//this.number = this.size * this.size;
	//this.mesh = mesh;

	// LBM grid params
	this.NX = NX;
	//this.NY = NY;
	//this.NZ = NZ;

	this.Lx = Lx;
	this.Ly = Ly;
	this.Lz = Lz;	

	this.dx_phys = Lx / NX;
	this.NY = Math.floor(this.Ly / this.dx_phys);
	this.NZ = Math.floor(this.Lz / this.dx_phys);
	
	this.cells = this.NX * this.NY * this.NZ;

	this.u_inlet_physX = u_inlet_physX; // Lid velocity component in X direction (m/s)
	this.u_inlet_physY = u_inlet_physY; // Lid velocity component in Y direction (m/s)
	this.u_inlet_physZ = u_inlet_physZ; // Lid velocity component in Z direction (m/s)

	this.gravity_physX = gravity_physX;
	this.gravity_physY = gravity_physY;
	this.gravity_physZ = gravity_physZ;

	this.nu_phys = 1.5e-5; // Kinematic viscosity (m^2/s)
	this.rho_phys = 1.293; // Density (kg/m^3)
	this.cs = 1.0/3.0;

	

	// LBM constants
	this.q = 19; // make variable?
	this.nu_lbm = 0.1;
	this.tau = 3.0 * this.nu_lbm + 0.5; 
	this.omega = 1.0/this.tau; // viscosity, etc.
	this.omtauinv = 1.0 - this.omega;
	this.omtauinv_2 = 1.0 - this.omega/2.0;
	this.dirx = [0,  1, -1,  0,  0,  0,  0,  1, -1,  1, -1,  0,  0,  1, -1,  1, -1,  0,  0];
	this.diry = [0,  0,  0,  1, -1,  0,  0,  1, -1,  0,  0,  1, -1, -1,  1,  0,  0,  1, -1];
	this.dirz = [0,  0,  0,  0,  0,  1, -1,  0,  0,  1, -1,  1, -1,  0,  0, -1,  1, -1,  1];

	//  x     [0,   1,  -1,  0,  0,    0,         0,       1, -1,     1,         -1,         0,           0,       1,   -1,     1,         -1,         0,           0];
	//  y     [0,   0,   0,  1, -1,    0,         0,       1, -1,     0,          0,         1,          -1,      -1,    1,     0,          0,         1,          -1];
	//  z     [0,   0,   0,  0,  0,    1,         -1,      0,  0,     1,         -1,         1,          -1,       0,    0,    -1,          1,        -1,           1];

	const rawEu = [0, 	1, 	-1,  0,  0,    0,	       0,      1,  -1,    1,         -1,         0,           0,       1,   -1,     1,         -1,         0,           0];
	const rawEv = [0, 	0,	 0,  1, -1,  this.NY,  -this.NY,   1,  -1,  this.NY,  -this.NY,  1+this.NY,  -1-this.NY,  -1, 	 1,  -this.NY,  this.NY,  1-this.NY,  -1+this.NY];
	this.eu = new Float32Array( rawEu.map( v => v / this.NX ) );
	this.ev = new Float32Array( rawEv.map( v => v / (this.NY * this.NZ) ))



	this.inv = [0,  2,  1,  4,  3,  6,  5,  8,  7, 10,  9, 12, 11, 14, 13, 16, 15, 18, 17];
	this.w0=1.0/3.0;
	this.wa=1.0/18.0;
	this.wd=1.0/36.0;
	this.w = new Float32Array([this.w0, this.wa, this.wa, this.wa, this.wa, this.wa, this.wa, this.wd, this.wd, this.wd, this.wd, this.wd, this.wd, this.wd, this.wd, this.wd, this.wd, this.wd, this.wd]);


	//this.sampler = new MeshSurfaceSampler(this.mesh).build();
	
	//this.setupDataFromMesh();
	this.setupGridDataCavity();
	this.setupVelocitiesData();
}

  
	setupDataFromMesh() {
		const data = new Float32Array(4 * this.number);
		const positions = new Float32Array(3 * this.number);
		const uvs = new Float32Array(2 * this.number);
		
		this._position = new THREE.Vector3();
		
		for (let i = 0; i < this.size; i++) {
			for (let j = 0; j < this.size; j++) {
				const index = i * this.size + j;
				
				// Pick random point from Mesh
				
				this.sampler.sample(this._position);


				// Setup for DataTexture
				
				data[4 * index] = this._position.x;
				data[4 * index + 1] = this._position.y;
				data[4 * index + 2] = this._position.z;


				// Setup positions attribute for geometry
				
				positions[3 * index] = this._position.x;
				positions[3 * index + 1] = this._position.y;
				positions[3 * index + 2] = this._position.z;
				
				// Setup UV attribute for geometry
				
				uvs[2 * index] = j / (this.size - 1);
				uvs[2 * index + 1] = i / (this.size - 1);
			}
		}
	  
	
		const positionTexture = new THREE.DataTexture(data, this.size, this.size, THREE.RGBAFormat, THREE.FloatType);
		
		positionTexture.needsUpdate = true;
		
		this.positions = positions;
		
		this.positionTexture = positionTexture;
		
		this.uvs = uvs;
	}

	  
	
	setupVelocitiesData() {
		const data = new Float32Array(4 * this.number);
		
		data.fill(0);
		
		let velocityTexture = new THREE.DataTexture(data, this.size, this.size, THREE.RGBAFormat, THREE.FloatType);
		
		velocityTexture.needsUpdate = true;
		
		this.velocityTexture = velocityTexture
	}

	setupGridDataCavity(){
		const NX = this.NX;
		const NY = this.NY;
		const NZ = this.NZ;

		const cells = NX*NY*NZ;
		const solid = new Uint8Array(cells);
		let ux = new Float32Array(cells);
		let vy = new Float32Array(cells);
		let wz = new Float32Array(cells);
		let rho = new Float32Array(cells);



		// Inlet velocity and kinematic viscocity in physical units

		//let nu_phys = 1.5e-5; // Kinematic viscosity (m^2/s)
		//let rho_phys = 1.293; // Density (kg/m^3)

		// Inlet and outlet locations as a ratio of the total length
		let inletY_start = 0.5;
		let inletY_end = 0.75;
		let inletZ_start = 0.5;
		let inletZ_end = 0.75;

		let outletY_start = 0.2;
		let outletY_end = 0.4;
		let outletZ_start = 0.2;
		let outletZ_end = 0.4;

		

		// Box dimensions in meters (not necessarily all the same length)


		// Calculating the rest of the other nodes accordingly
		// // dx in physical units (m)

		// Sanity check (to ensure that dx_phys = dy_phys = dz_phys)
		//let dy_phys = Ly / NY;
		//let dz_phys = Lz / NZ;

		// Inlet velocity magnitude (m/s)
		let u_inlet_phys = Math.sqrt(this.u_inlet_physX * this.u_inlet_physX + this.u_inlet_physY * this.u_inlet_physY + this.u_inlet_physZ * this.u_inlet_physZ); 

		// Time step in physical units
		//let nu_lbm = 0.1;                    // Lattice viscosity (chosen)
		this.dt_phys = (this.nu_lbm * this.dx_phys * this.dx_phys) / this.nu_phys;  // Physical time step (seconds)

		// LATTICE UNITS
		let dx = 1.0;
		let dt = 1.0;
		let conversion_length = this.dx_phys / dx;
		let conversion_time = this.dt_phys / dt;
		let conversion_mass = this.rho_phys;

		// Convert physical quantities to lattice units
		let u_inlet = u_inlet_phys * (conversion_time / conversion_length);
		let u_inlet_X = this.u_inlet_physX * (conversion_time / conversion_length);
		let u_inlet_Y = this.u_inlet_physY * (conversion_time / conversion_length);
		let u_inlet_Z = this.u_inlet_physZ * (conversion_time / conversion_length);

		let gX = this.gravity_physX * ((conversion_time * conversion_time) / conversion_length) ;
		let gY = this.gravity_physY * ((conversion_time * conversion_time) / conversion_length) ;
		let gZ = this.gravity_physZ * ((conversion_time * conversion_time) / conversion_length) ;

		this.gX = gX;
		this.gY = gY;
		this.gZ = gZ;

		// Fluid density in lattice units
		this.rho0 = 1.0;

		this.init_solid(solid); // uv indices containing solid/fluid flag
		

		const dataf0A = new Float32Array(4*this.cells);
		const dataf0B = new Float32Array(4*this.cells);
		const dataf0C = new Float32Array(4*this.cells);
		const dataf0D = new Float32Array(4*this.cells);
		const dataf0E = new Float32Array(4*this.cells);
		const dataMacro = new Float32Array(4*this.cells);

		// initialize macroscopic variables (TODO: get rid of dataMacro)
		this.init_macros(dataMacro, u_inlet_X,u_inlet_Y,u_inlet_Z,this.rho0,ux,vy,wz,rho);

		this.u_inlet_X = u_inlet_X;
		this.u_inlet_Y = u_inlet_Y;
		this.u_inlet_Z = u_inlet_Z;

		// initialize velocity distributions
		this.init_equilibrium(dataf0A,dataf0B,dataf0C,dataf0D,dataf0E,ux,vy,wz,rho,solid);

		
		
		let texf0A = new THREE.DataTexture(dataf0A, this.NX, this.NY*this.NZ, THREE.RGBAFormat, THREE.FloatType);
		let texf0B = new THREE.DataTexture(dataf0B, this.NX, this.NY*this.NZ, THREE.RGBAFormat, THREE.FloatType);
		let texf0C = new THREE.DataTexture(dataf0C, this.NX, this.NY*this.NZ, THREE.RGBAFormat, THREE.FloatType);
		let texf0D = new THREE.DataTexture(dataf0D, this.NX, this.NY*this.NZ, THREE.RGBAFormat, THREE.FloatType);
		let texf0E = new THREE.DataTexture(dataf0E, this.NX, this.NY*this.NZ, THREE.RGBAFormat, THREE.FloatType);


		texf0A.needsUpdate = true;
		texf0B.needsUpdate = true;
		texf0C.needsUpdate = true;
		texf0D.needsUpdate = true;
		texf0E.needsUpdate = true;

		this.texf0A = texf0A;
		this.texf0B = texf0B;
		this.texf0C = texf0C;
		this.texf0D = texf0D;
		this.texf0E = texf0E;
		
	}

	init_solid(solid){
		const NX = this.NX;
		const NY = this.NY;
		const NZ = this.NZ;
		const slice = NY*NX;
		for (let z = 0; z < NZ; z++) {
			for (let y = 0; y < NY; y++) {
				for (let x = 0; x < NX; x++) {
	
					//uv_idx = this.xyz_to_uv_idx(x,y,z);
					const idx1D = z*slice + y*NX + x;
					//const off = idx1D*4;
	
					if (z == NZ-1){
						// Lid nodes
						solid[idx1D] = 2;
					}else if(x == 0 || y == 0 || x == NX-1 || y == NY-1 || z == 0 || z == NZ-1) {
						// Wall nodes
						solid[idx1D] = 1;
					}else{
						// Fluid nodes
						solid[idx1D] = 0;
					}
						
				}
			}
		}
		return solid
	}

	init_macros(dataMacro, u_inlet_X, u_inlet_Y, u_inlet_Z, rho0, ux, vy, wz,rho){
		const NX = this.NX;
		const NY = this.NY;
		const NZ = this.NZ;
		const slice = NX*NY;
		for (let z = 0; z < NZ; ++z) {
			for (let y = 0; y < NY; ++y) {
				for (let x = 0; x < NX; ++x) {
	
					const idx1D = z*slice + y*NX + x;
					const off = idx1D * 4;

					// Initialize Lid
					if (z == NZ-1){
						ux[idx1D] = u_inlet_X;
						vy[idx1D] = u_inlet_Y;
						wz[idx1D] = u_inlet_Z;
						dataMacro[off] = u_inlet_X;
						dataMacro[off+1] = u_inlet_Y;
						dataMacro[off+2] = u_inlet_Z;
					}
					else { // Other velocities are zero
						ux[idx1D] = 0.0;
						vy[idx1D] = 0.0;
						wz[idx1D] = 0.0;
						dataMacro[off] = 0.0;
						dataMacro[off+1] = 0.0;
						dataMacro[off+2] = 0.0;
					}
					rho[idx1D] = rho0;
					dataMacro[off+3] = rho0;
				}
			}
		}

	}

	init_equilibrium(data0, data1, data2, data3, data4, ux, vy, wz, rho, solid){
		const { NX, NY, NZ, q, dirx, diry, dirz, w } = this;
		const slice = NX * NY;  
		
		for (let z = 0; z < NZ; z++) {
			for (let y = 0; y < NY; y++) {
				for (let x = 0; x < NX; x++) {
					//uv_idx = this.xyz_to_uv_idx(x,y,z);
					const idx1D = z * slice + y * NX + x;
					const off = idx1D * 4;

					const r = rho[idx1D];
					const ux_cur = ux[idx1D];
					const vy_cur = vy[idx1D];
					const wz_cur = wz[idx1D];

					for (let i = 0; i < q; i++){
						const cidotu = dirx[i] * ux_cur + diry[i] * vy_cur + dirz[i] * wz_cur;
						let ft = w[i] * r * (1.0 + 3.0 * cidotu + 4.5 * cidotu * cidotu - 1.5 * (ux_cur*ux_cur + vy_cur*vy_cur + wz_cur*wz_cur));

						if      (i < 4 ) data0[off + i          ] = ft;
						else if (i < 8 ) data1[off + (i - 4)    ] = ft;
						else if (i < 12) data2[off + (i - 8)    ] = ft;
						else if (i < 16) data3[off + (i - 12)   ] = ft;
						else             data4[off + (i - 16)   ] = ft;
					}

					data4[off + 3] = solid[idx1D];

				}

			}
		}
	}	

	xyz_to_uv( x,  y,  z){
		const u = x/this.NX;
		const v = (y + this.NY*z)/(this.NY*this.NZ);
		return [u,v];
	}

	xyz_to_uv_idx( x,  y,  z){
		const uidx = x;
		const vidx = (y + this.NY*z);
		return [uidx,vidx];
	}

	  
	
	getPositions() {
		return this.positions;
	}
	
	  
	getUVs() {
		return this.uvs;
	}
	
	  
	getPositionTexture() {
		return this.positionTexture;
	}
	 
	
	getVelocityTexture() {
		return this.velocityTexture;
	}

	getTexf0A(){
		return this.texf0A
	}
	getTexf0B(){
		return this.texf0B
	}
	getTexf0C(){
		return this.texf0C
	}
	getTexf0D(){
		return this.texf0D
	}
	getTexf0E(){
		return this.texf0E
	}

	getTexf1A(){
		return this.texf1A
	}
	getTexf1B(){
		return this.texf1B
	}
	getTexf1C(){
		return this.texf1C
	}
	getTexf1D(){
		return this.texf1D
	}
	getTexf1E(){
		return this.texf1E
	}
	getTexMacros(){
		return this.texMacros0
	}
}