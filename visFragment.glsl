precision highp float;

uniform float uShowWalls;
uniform float uColorIntensity;

in vec2 vMacroUV;
uniform sampler2D uMacro;
in float vID;

// single output must be bound at location 0
layout(location = 0) out vec4 fragColor;

// replace with uniform of lid speed
const float uMaxSpeed = 0.01;

float rand( float seed){
    return fract( sin(seed*12.9898 + 78.233)*43758.5453123 );
}

void main(){
  vec4 macro = texture( uMacro, vMacroUV );
  float nodeType = macro.w;

  // Skip rendering walls if showWalls is off
  if (nodeType > 1.0 && uShowWalls < 0.5) {
    discard;
  }

  float speed = length( macro.xyz );
  vec4 col = speed > 0.0
    ? vec4(vec3(abs(macro.xyz) / uMaxSpeed),0.8)
    : vec4( 0.0,0.0,0.0,0.0 );
  

  // Different coloring for walls vs fluid
  if (nodeType > 1.0) {
    // Wall coloring
    fragColor = vec4(0.3, 0.3, 0.3, 0.2);
  } else {
    // Fluid coloring
    fragColor = vec4( col );
  }
  
   


}