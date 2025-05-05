import {
	ClampToEdgeWrapping,
	DataTexture,
	FloatType,
	NearestFilter,
	RGBAFormat,
	ShaderMaterial,
	WebGLRenderTarget
} from 'three';

import { FullScreenQuad } from './node_modules/three/examples/jsm/postprocessing/Pass.js';

/**
 * GPUComputationRenderer, based on SimulationRenderer by @zz85.
 *
 * The GPUComputationRenderer uses the concept of variables. These variables are RGBA float textures that hold 4 floats
 * for each compute element (texel).
 *
 * Each variable has a fragment shader that defines the computation made to obtain the variable in question.
 * You can use as many variables you need, and make dependencies so you can use textures of other variables in the shader
 * (the sampler uniforms are added automatically) Most of the variables will need themselves as dependency.
 *
 * The renderer has actually two render targets per variable, to make ping-pong. Textures from the current frame are used
 * as inputs to render the textures of the next frame.
 *
 * The render targets of the variables can be used as input textures for your visualization shaders.
 *
 * Variable names should be valid identifiers and should not collide with THREE GLSL used identifiers.
 * a common approach could be to use 'texture' prefixing the variable name; i.e texturePosition, textureVelocity...
 *
 * The size of the computation (sizeX * sizeY) is defined as 'resolution' automatically in the shader. For example:
 * ```
 * #DEFINE resolution vec2( 1024.0, 1024.0 )
 * ```
 * Basic use:
 * ```js
 * // Initialization...
 *
 * // Create computation renderer
 * const gpuCompute = new GPUComputationRenderer( 1024, 1024, renderer );
 *
 * // Create initial state float textures
 * const pos0 = gpuCompute.createTexture();
 * const vel0 = gpuCompute.createTexture();
 * // and fill in here the texture data...
 *
 * // Add texture variables
 * const velVar = gpuCompute.addVariable( "textureVelocity", fragmentShaderVel, vel0 );
 * const posVar = gpuCompute.addVariable( "texturePosition", fragmentShaderPos, pos0 );
 *
 * // Add variable dependencies
 * gpuCompute.setVariableDependencies( velVar, [ velVar, posVar ] );
 * gpuCompute.setVariableDependencies( posVar, [ velVar, posVar ] );
 *
 * // Add custom uniforms
 * velVar.material.uniforms.time = { value: 0.0 };
 *
 * // Check for completeness
 * const error = gpuCompute.init();
 * if ( error !== null ) {
 *		console.error( error );
  * }
 *
 * // In each frame...
 *
 * // Compute!
 * gpuCompute.compute();
 *
 * // Update texture uniforms in your visualization materials with the gpu renderer output
 * myMaterial.uniforms.myTexture.value = gpuCompute.getCurrentRenderTarget( posVar ).texture;
 *
 * // Do your rendering
 * renderer.render( myScene, myCamera );
 * ```
 *
 * Also, you can use utility functions to create ShaderMaterial and perform computations (rendering between textures)
 * Note that the shaders can have multiple input textures.
 *
 * ```js
 * const myFilter1 = gpuCompute.createShaderMaterial( myFilterFragmentShader1, { theTexture: { value: null } } );
 * const myFilter2 = gpuCompute.createShaderMaterial( myFilterFragmentShader2, { theTexture: { value: null } } );
 *
 * const inputTexture = gpuCompute.createTexture();
 *
 * // Fill in here inputTexture...
 *
 * myFilter1.uniforms.theTexture.value = inputTexture;
 *
 * const myRenderTarget = gpuCompute.createRenderTarget();
 * myFilter2.uniforms.theTexture.value = myRenderTarget.texture;
 *
 * const outputRenderTarget = gpuCompute.createRenderTarget();
 *
 * // Now use the output texture where you want:
 * myMaterial.uniforms.map.value = outputRenderTarget.texture;
 *
 * // And compute each frame, before rendering to screen:
 * gpuCompute.doRenderTarget( myFilter1, myRenderTarget );
 * gpuCompute.doRenderTarget( myFilter2, outputRenderTarget );
 * ```
 */
class GPUComputationRendererMRT {

	/**
	 * Constructs a new GPU computation renderer.
	 *
	 * @param {number} sizeX - Computation problem size is always 2d: sizeX * sizeY elements.
 	 * @param {number} sizeY - Computation problem size is always 2d: sizeX * sizeY elements.
 	 * @param {WebGLRenderer} renderer - The renderer.
	 */
	constructor( sizeX, sizeY, renderer ) {

		this.variables = [];

		this.currentTextureIndex = 0;

		let dataType = FloatType;

		const passThruUniforms = {
			passThruTexture0: { value: null },
			passThruTexture1: { value: null },
			passThruTexture2: { value: null },
			passThruTexture3: { value: null },
			passThruTexture4: { value: null },
			passThruTexture5: { value: null }

		};

		const passThruShader = createShaderMaterial( getPassThroughFragmentShader(), passThruUniforms );

		const quad = new FullScreenQuad( passThruShader );

		/**
		 * Sets the data type of the internal textures.
		 *
		 * @param {(FloatType|HalfFloatType)} type - The type to set.
		 * @return {GPUComputationRenderer} A reference to this renderer.
		 */
		this.setDataType = function ( type ) {

			dataType = type;
			return this;

		};

		/**
		 * Adds a compute variable to the renderer.
		 *
		 * @param {string} variableName - The variable name.
		 * @param {string} computeFragmentShader - The compute (fragment) shader source.
		 * @param {Texture} initialValueTexture - The initial value texture.
		 * @param {Array<String>} attachments - number of render targets.
		 * @return {Object} The compute variable.
		 */
		this.addVariable = function ( variableName, computeFragmentShader, initialValueTexture, attachments ) {

			const material = this.createShaderMaterial( computeFragmentShader );

			const variable = {
				name: variableName,
				initialValueTexture: initialValueTexture,
				material: material,
				dependencies: null,
				renderTargets: [],
				wrapS: null,
				wrapT: null,
				minFilter: NearestFilter,
				magFilter: NearestFilter,
				attachments: attachments,
				count: attachments.length
			};

			this.variables.push( variable );

			return variable;

		};

		/**
		 * Sets variable dependencies.
		 *
		 * @param {Object} variable - The compute variable.
		 * @param {Array<Object>} dependencies - Other compute variables that represents the dependencies.
		 */
		this.setVariableDependencies = function ( variable, dependencies ) {

			variable.dependencies = dependencies;

		};

		/**
		 * Initializes the renderer.
		 *
		 * @return {?string} Returns `null` if no errors are detected. Otherwise returns the error message.
		 */
		this.init = function () {

			if ( renderer.capabilities.maxVertexTextures === 0 ) {

				return 'No support for vertex shader textures.';

			}

			for ( let i = 0; i < this.variables.length; i ++ ) {

				const variable = this.variables[ i ];
				//let attachments = variable.attachments

				//const initVal = variable.initialValueTexture;
				const count = variable.count;

				//console.log('init value texture 4:')
				//console.table( initVal[4].image.data );

				// Creates rendertargets and initialize them with input texture
				variable.renderTargets[ 0 ] = this.createRenderTarget( sizeX, sizeY, variable.wrapS, variable.wrapT, variable.minFilter, variable.magFilter, variable.attachments, count );
				variable.renderTargets[ 1 ] = this.createRenderTarget( sizeX, sizeY, variable.wrapS, variable.wrapT, variable.minFilter, variable.magFilter, variable.attachments, count );


				
				// 3) initialize each slot by running the passThruShader into that slot only
				//    we assume passThruShader writes to gl_FragData[0]
				//const gl = renderer.getContext();

				//passThruUniforms.passThruTexture0.value = initVal[0];
				//passThruUniforms.passThruTexture1.value = initVal[1];
				//passThruUniforms.passThruTexture2.value = initVal[2];
				//passThruUniforms.passThruTexture3.value = initVal[3];
				//passThruUniforms.passThruTexture4.value = initVal[4];

				this.renderTexture( variable.initialValueTexture, variable.renderTargets[ 0 ] );
				this.renderTexture( variable.initialValueTexture, variable.renderTargets[ 1 ] );



				/*
				for ( let i = 0; i < count; i ++ ) {

					// a) bind only the i‑th color attachment
					gl.drawBuffers( [ gl.COLOR_ATTACHMENT0 ] );

					// b) set the input texture uniform to the i‑th initial value
					passThruUniforms.passThruTexture1.value = Array.isArray( initVal ) ? initVal[ i ] : initVal;

					renderer.setRenderTarget(variable.renderTargets[0]);
					quad.material = passThruShader;
					quad.render(renderer);

					console.log('renderTargets0 i');
					readRenderTargetPixelsMRT(variable.renderTargets[ 0 ],i);

					renderer.setRenderTarget(variable.renderTargets[1]);
					quad.material = passThruShader;
					quad.render(renderer);

					// c) render into both ping‐pong targets
					//this.doRenderTarget( passThruShader, variable.renderTargets[ 0 ].textures[i] );
					//this.doRenderTarget( passThruShader, variable.renderTargets[ 1 ].textures[i] );
				} */


				//console.log('renderTargets0 fE');
				//readRenderTargetPixelsMRT(variable.renderTargets[ 0 ],4);

				// restore all attachments for future MRT passes
				//gl.drawBuffers( Array.from( { length: count }, (_,k)=> gl.COLOR_ATTACHMENT0 + k ) );

				// clear the passThru uniform
				//passThruUniforms.passThruTexture.value = null;

				//this.renderTexture( variable.initialValueTexture, variable.renderTargets[ 0 ] );
				//console.log('renderTargets0 macro');
				//readRenderTargetPixelsMRT(variable.renderTargets[ 0 ],5);

				//this.renderTexture( variable.initialValueTexture, variable.renderTargets[ 1 ] );
				//console.log('renderTargets1 macro');
				//readRenderTargetPixelsMRT(variable.renderTargets[ 1 ],5);

				// Adds dependencies uniforms to the ShaderMaterial
				const material = variable.material;
				const uniforms = material.uniforms;

				if ( variable.dependencies !== null ) {

					for ( let d = 0; d < variable.dependencies.length; d ++ ) {

						const depVar = variable.dependencies[ d ];

						if ( depVar.name !== variable.name ) {

							// Checks if variable exists
							let found = false;

							for ( let j = 0; j < this.variables.length; j ++ ) {

								if ( depVar.name === this.variables[ j ].name ) {

									found = true;
									break;

								}

							}

							if ( ! found ) {

								return 'Variable dependency not found. Variable=' + variable.name + ', dependency=' + depVar.name;

							}

						}

						// provider render target: the render target of the variable the current one depends on
						// what if provider doesnt have a render target?
						// f0 will depend on old f1
						const rt = this.getCurrentRenderTarget( depVar );

						// get the output textures of the provider variable and make them the uniforms of our new variable
						for (let i = 0; i < depVar.count; i++){
							let tex = rt.textures[i];

							//console.log('depvar, texture i');
							//readRenderTargetPixelsMRT(rt,i);

							// its not gonna like that tex.name is a string
							material.uniforms[ tex.name ] = { value: tex }
						}

						/*
						rt.texture.forEach( (tex, idx) => {
							// uniform names must match the ones GPUComputationRenderer injected:
							// for prefix "uF0" -> uF0_0, uF0_1, … uF0_4
							material.uniforms[ `${ depName }_${ idx }` ] = { value: tex };
						  } ); */

						//uniforms[ depVar.name ] = { value: null };

						material.fragmentShader = '\nuniform sampler2D ' + depVar.name + ';\n' + material.fragmentShader;

					}

				}

			}

			this.currentTextureIndex = 0;

			return null;

		};

		/**
		 * Executes the compute. This method is usually called in the animation loop.
		 */
		this.compute = function () {

			const currentTextureIndex = this.currentTextureIndex;
			const nextTextureIndex = this.currentTextureIndex === 0 ? 1 : 0;

			for ( let i = 0, il = this.variables.length; i < il; i ++ ) {

				const variable = this.variables[ i ];

				// Sets texture dependencies uniforms
				if ( variable.dependencies !== null ) {

					//const uniforms = variable.material.uniforms;

					for ( let d = 0, dl = variable.dependencies.length; d < dl; d ++ ) {

						const depVar = variable.dependencies[ d ];

						// begin experimental
						const rt = depVar.renderTargets[ currentTextureIndex ];

						// looping through output textures of dependent variable
						for (let i = 0; i < depVar.count; i++){
							let tex = rt.textures[i];

							// its not gonna like that tex.name is a string
							variable.material.uniforms[ tex.name ] = { value: tex }
						}
						// end experimental

						//uniforms[ depVar.name ].value = depVar.renderTargets[ currentTextureIndex ].texture;
	
					}

				}

				// Performs the computation for this variable
				this.doRenderTarget( variable.material, variable.renderTargets[ nextTextureIndex ] );

			}

			this.currentTextureIndex = nextTextureIndex;

		};

		/**
		 * Returns the current render target for the given compute variable.
		 *
		 * @param {Object} variable - The compute variable.
		 * @return {WebGLRenderTarget} The current render target.
		 */
		this.getCurrentRenderTarget = function ( variable ) {

			return variable.renderTargets[ this.currentTextureIndex ];

		};

		/**
		 * Returns the alternate render target for the given compute variable.
		 *
		 * @param {Object} variable - The compute variable.
		 * @return {WebGLRenderTarget} The alternate render target.
		 */
		this.getAlternateRenderTarget = function ( variable ) {

			return variable.renderTargets[ this.currentTextureIndex === 0 ? 1 : 0 ];

		};

		/**
		 * Frees all internal resources. Call this method if you don't need the
		 * renderer anymore.
		 */
		this.dispose = function () {

			quad.dispose();

			const variables = this.variables;

			for ( let i = 0; i < variables.length; i ++ ) {

				const variable = variables[ i ];

				if ( variable.initialValueTexture ) { for(let j = 0;j<variable.count;j++){variable.initialValueTexture[i].dispose()}};

				const renderTargets = variable.renderTargets;

				for ( let j = 0; j < renderTargets.length; j ++ ) {

					const renderTarget = renderTargets[ j ];
					renderTarget.dispose();

				}

			}

		};

		function addResolutionDefine( materialShader ) {

			materialShader.defines.resolution = 'vec2( ' + sizeX.toFixed( 1 ) + ', ' + sizeY.toFixed( 1 ) + ' )';

		}

		/**
		 * Adds a resolution defined for the given material shader.
		 *
		 * @param {Object} materialShader - The material shader.
		 */
		this.addResolutionDefine = addResolutionDefine;


		// The following functions can be used to compute things manually

		function createShaderMaterial( computeFragmentShader, uniforms ) {

			uniforms = uniforms || {};

			const material = new ShaderMaterial( {
				name: 'GPUComputationShader',
				uniforms: uniforms,
				vertexShader: getPassThroughVertexShader(),
				fragmentShader: computeFragmentShader,
			} );

			addResolutionDefine( material );

			return material;

		}

		this.createShaderMaterial = createShaderMaterial;

		/**
		 * Creates a new render target from the given parameters.
		 *
		 * @param {number} sizeXTexture - The width of the render target.
		 * @param {number} sizeYTexture - The height of the render target.
		 * @param {number} wrapS - The wrapS value.
		 * @param {number} wrapT - The wrapS value.
		 * @param {number} minFilter - The minFilter value.
		 * @param {number} magFilter - The magFilter value.
		 * @return {WebGLRenderTarget} The new render target.
		 */
		this.createRenderTarget = function ( sizeXTexture, sizeYTexture, wrapS, wrapT, minFilter, magFilter, attachments = [], count = 1 ) {

			sizeXTexture = sizeXTexture || sizeX;
			sizeYTexture = sizeYTexture || sizeY;

			wrapS = wrapS || ClampToEdgeWrapping;
			wrapT = wrapT || ClampToEdgeWrapping;

			minFilter = minFilter || NearestFilter;
			magFilter = magFilter || NearestFilter;

			if ( count > 1 ) {
				const mrt = new WebGLRenderTarget( sizeXTexture, sizeYTexture, {
					wrapS: wrapS,
					wrapT: wrapT,
					minFilter: minFilter,
					magFilter: magFilter,
					format: RGBAFormat,
					type: dataType,
					depthBuffer: false,
					count: count
				} );
				for (let i = 0; i < count; i++){
					mrt.textures[ i ].name = attachments[i];
				}
				return mrt;
			  }

			const renderTarget = new WebGLRenderTarget( sizeXTexture, sizeYTexture, {
				wrapS: wrapS,
				wrapT: wrapT,
				minFilter: minFilter,
				magFilter: magFilter,
				format: RGBAFormat,
				type: dataType,
				depthBuffer: false
			} );

			return renderTarget;

		};

		/**
		 * Creates a new data texture.
		 *
		 * @return {DataTexture} The new data texture.
		 */
		this.createTexture = function () {

			const data = new Float32Array( sizeX * sizeY * 4 );
			const texture = new DataTexture( data, sizeX, sizeY, RGBAFormat, FloatType );
			texture.needsUpdate = true;
			return texture;

		};

		/**
		 * Renders the given texture into the given render target.
		 *
		 * @param {Texture} input - The input.
		 * @param {WebGLRenderTarget} output - The output.
		 */
		this.renderTexture = function ( input, output ) {

			//passThruUniforms.passThruTexture.value = input;
			passThruUniforms.passThruTexture0.value = input[0];
			passThruUniforms.passThruTexture1.value = input[1];
			passThruUniforms.passThruTexture2.value = input[2];
			passThruUniforms.passThruTexture3.value = input[3];
			passThruUniforms.passThruTexture4.value = input[4];

			this.doRenderTarget( passThruShader, output );

			
			passThruUniforms.passThruTexture0.value = null;
			passThruUniforms.passThruTexture1.value = null;
			passThruUniforms.passThruTexture2.value = null;
			passThruUniforms.passThruTexture3.value = null;
			passThruUniforms.passThruTexture4.value = null;

		};

		function readRenderTargetPixelsMRT(rt,num){
			const w=rt.width, h=rt.height;
			const props  = renderer.properties.get( rt );
			const gl     = renderer.getContext();
			const fbo    = props.__webglFramebuffer;
			// 2) bind it for reading
			gl.bindFramebuffer( gl.READ_FRAMEBUFFER, fbo );
			// 3) select the attachment you want (e.g. 5)
			let attachment = gl.COLOR_ATTACHMENT0 + num;
 			gl.readBuffer(attachment);

			// 4) pull back a single pixel or block
			const buf = new Float32Array( 4 * w * h );
			gl.readPixels( 0, 0, w, h, gl.RGBA, gl.FLOAT, buf );
			console.log( buf );
			// 5) restore  
			gl.bindFramebuffer( gl.READ_FRAMEBUFFER, null );
		}


		/**
		 * Renders the given material into the given render target
		 * with a full-screen pass.
		 *
		 * @param {Material} material - The material.
		 * @param {WebGLRenderTarget} output - The output.
		 */
		this.doRenderTarget = function ( material, output ) {

			const currentRenderTarget = renderer.getRenderTarget();

			const currentXrEnabled = renderer.xr.enabled;
			const currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;

			renderer.xr.enabled = false; // Avoid camera modification
			renderer.shadowMap.autoUpdate = false; // Avoid re-computing shadows
			
			// go to 5 drawbuffers
			//const gl = renderer.getContext();
			//gl.drawBuffers( [ gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1,gl.COLOR_ATTACHMENT2,gl.COLOR_ATTACHMENT3,gl.COLOR_ATTACHMENT4 ] );


			quad.material = material;
			renderer.setRenderTarget( output );
			quad.render( renderer );
			quad.material = passThruShader;

			renderer.xr.enabled = currentXrEnabled;
			renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;

			// restore all attachments
			//gl.drawBuffers( Array.from({length: attachments}, (_,k)=>gl.COLOR_ATTACHMENT0 + k) );

			renderer.setRenderTarget( currentRenderTarget );

		};

		// Shaders

		function getPassThroughVertexShader() {

			return	'void main()	{\n' +
					'\n' +
					'	gl_Position = vec4( position, 1.0 );\n' +
					'\n' +
					'}\n';

		}

		function getPassThroughFragmentShader() {
			return `
			  precision highp float;
			  uniform sampler2D passThruTexture0;
			  uniform sampler2D passThruTexture1;
			  uniform sampler2D passThruTexture2;
			  uniform sampler2D passThruTexture3;
			  uniform sampler2D passThruTexture4;
			  uniform sampler2D passThruTexture5;

			  //layout(location=0) out vec4 outF0;
			  layout(location=1) out vec4 outF1;
			  layout(location=2) out vec4 outF2;
			  layout(location=3) out vec4 outF3;
			  layout(location=4) out vec4 outF4;
			  layout(location=5) out vec4 outF5;
			  
			  void main() {
				vec2 uv = gl_FragCoord.xy / resolution.xy;
				pc_fragColor = texture2D(passThruTexture0, uv);
				outF1 = texture2D(passThruTexture1, uv);
				outF2 = texture2D(passThruTexture2, uv);
				outF3 = texture2D(passThruTexture3, uv);
				outF4 = texture2D(passThruTexture4, uv);
				outF5 = texture2D(passThruTexture5, uv);
			  }
			`;
		}

	}
		

}

export { GPUComputationRendererMRT };
