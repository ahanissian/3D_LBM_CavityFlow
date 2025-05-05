precision highp float;

// per‑vertex / instancing inputs:
//in vec3 position;
//in mat4 instanceMatrix;
//in vec2 macroUV;
attribute vec2 macroUV;

// standard three.js camera uniforms:
//uniform mat4 modelViewMatrix;
//uniform mat4 projectionMatrix;

// varying to pass to the fragment shader
out vec2 vMacroUV;
out float vID;          // pass instance ID

void main(){
    vID      = float( gl_InstanceID );
    vMacroUV = macroUV;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0);
}