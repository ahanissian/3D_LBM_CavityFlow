
precision highp float;
//varying vec2 vUv;


//layout(location=0) out vec4 outF0;
layout(location=1) out vec4 outF1;
layout(location=2) out vec4 outF2;
layout(location=3) out vec4 outF3;
layout(location=4) out vec4 outF4;
layout(location=5) out vec4 outMacro;

//uniform vec2 resolution;

uniform sampler2D uF_0;
uniform sampler2D uF_1;
uniform sampler2D uF_2;
uniform sampler2D uF_3;
uniform sampler2D uF_4;

uniform float uEu[19];
uniform float uEv[19];
uniform int   uInv[19];
uniform float uOmega;
uniform float uW[19];
uniform float uOmtauinv;
uniform float uOmtauinv_2;
uniform float uDirX[19];
uniform float uDirY[19];
uniform float uDirZ[19];

uniform float uU_inlet_X;
uniform float uU_inlet_Y;
uniform float uU_inlet_Z;

uniform float uRho0;
uniform float uGx;
uniform float uGy;
uniform float uGz;

float rho;
float ux;
float uy;
float uz;


float f1[19];
void main(){
    // get uv coordinate of current grid cell
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    //vec2 uv = vUv;

    // f0-18 stored in 5 textures
    vec4 tex0 = texture2D(uF_0, uv); //0-3
    vec4 tex1 = texture2D(uF_1, uv); //4-7
    vec4 tex2 = texture2D(uF_2, uv); //8-11
    vec4 tex3 = texture2D(uF_3, uv); //12-15
    vec4 tex4 = texture2D(uF_4, uv); //16-18, solid flag

    // flatten into one float array
    float f[19];
    for(int i = 0; i < 4; i++) f[i]      = tex0[i];
    for(int i = 0; i < 4; i++) f[4 + i]  = tex1[i];
    for(int i = 0; i < 4; i++) f[8 + i]  = tex2[i];
    for(int i = 0; i < 4; i++) f[12 + i] = tex3[i];
    for(int i = 0; i < 3; i++) f[16 + i] = tex4[i];


    float node_type = tex4[3];
    if (node_type == 1.0){
        rho = 2.0;
        ux = 0.0;
        uy = 0.0;
        uz = 0.0;
        //outMacro =  vec4(0.0,1.0,0.0,rho);
    } else if (node_type == 2.0){
        // Moving walls
        rho = 1.5;
        ux = uU_inlet_X;
        uy = uU_inlet_Y;
        uz = uU_inlet_Z;
        //outMacro =  vec4(1.0,0.0,0.0,rho);
    } 

    if (node_type == 0.0){
        vec4 tex_from;
        float ft[19];

        ft[0] = f[0];
        for(int i = 1; i < 19; ++i){

            vec2 uv_from = vec2(uv.x - uEu[i], uv.y - uEv[i]);

            // check if you are pulling from a solid
            vec4 tex4_from = texture2D(uF_4, uv_from);
            float solid_from = tex4_from[3];

            if (solid_from == 0.0){
                if (i > 15){
                    tex_from = tex4_from; // sample the relevant velocity distribution
                    ft[i] = tex_from[i-16]; // pull
                } else if (i > 11){
                    tex_from = texture2D(uF_3, uv_from);
                    ft[i] = tex_from[i-12];
                } else if (i > 7){
                    tex_from = texture2D(uF_2, uv_from);
                    ft[i] = tex_from[i-8];
                } else if (i > 3){
                    tex_from = texture2D(uF_1, uv_from);
                    ft[i] = tex_from[i-4];
                } else{
                    tex_from = texture2D(uF_0, uv_from);
                    ft[i] = tex_from[i];
                }
            } else if(solid_from == 1.0){
                ft[i] = f[uInv[i]]; // bounce back
            } else if(solid_from == 2.0){
                float corr = 6.0*uW[uInv[i]]*uRho0*(uDirX[uInv[i]]*uU_inlet_X + uDirY[uInv[i]]*uU_inlet_Y+ uDirZ[uInv[i]]*uU_inlet_Z );
                ft[i] = f[uInv[i]] - corr;
            }

        }

        // Step 1.1: Compute moments (density)
        float r = ft[0] + ft[1] + ft[2] + ft[3] + ft[4] + ft[5] + ft[6] + ft[7] + ft[8] + ft[9] 
                + ft[10] + ft[11] + ft[12] + ft[13] + ft[14] + ft[15] + ft[16] + ft[17] + ft[18];
        float rinv = 1.0 / r;
        float rinv_2 = rinv / 2.0;


        // Compute forces
        float fX = r * uGx;
        float fY = r * uGy;
        float fZ = r * uGz;

        // Step 1.2: Compute moments (velocity) along with half-force correction
        float ux = rinv * ((ft[1] + ft[15] + ft[9] + ft[13] + ft[7]) - (ft[14] + ft[10] + ft[2] + ft[16] + ft[8])) + rinv_2 * fX;
        float uy = rinv * ((ft[3] + ft[14] + ft[11] + ft[17] + ft[7]) - (ft[13] + ft[12] + ft[4] + ft[18] + ft[8])) + rinv_2 * fY;
        float uz = rinv * ((ft[11] + ft[9] + ft[5] + ft[16] + ft[18]) - (ft[17] + ft[15] + ft[10] + ft[6] + ft[12])) + rinv_2 * fZ;
        rho = uRho0;

        //outMacro = vec4(ux,uy,uz,rho);


        // Step 2: Perform collision (compute post-collision populations) for the current node and handle inlets/outlets
        // helper variables
        float twr[19];
        for(int i = 0; i < 19; i++){
            twr[i] = uOmega * uW[i] * r;
        }
        
        for (int i = 1; i < 19; ++i) twr[i] = uOmega * uW[i] * r;

        float omusq = 1.0 - 1.5 * (ux * ux + uy * uy + uz * uz);
        float tux = 3.0 * ux, tuy = 3.0 * uy, tuz = 3.0 * uz;
        float vdotF3 = 3.0 * (ux * fX + uy * fY + uz * fZ);


        // Population 0: rest
        float sf = uOmtauinv_2 * uW[0] * (-vdotF3); // Guo forcing
        f1[0] = uOmtauinv * ft[0] + twr[0] * omusq + sf;

        // Populations 1 through 18
        for (int i = 1; i < 19; ++i) {
            float ciu = uDirX[i] * tux + uDirY[i] * tuy + uDirZ[i] * tuz;
            float Fi = uDirX[i] * fX + uDirY[i] * fY + uDirZ[i] * fZ;
            sf = uOmtauinv_2 * uW[i] * (3.0 * Fi + 9.0 * (uDirX[i] * ux + uDirY[i] * uy + uDirZ[i] * uz) * Fi - vdotF3);

            // write to f1
            f1[i] = uOmtauinv * ft[i] + twr[i] * (omusq + ciu * (1.0 + 0.5 * ciu)) + sf;
        }

        pc_fragColor = vec4(f1[0],  f1[1],  f1[2],  f1[3]);
        //pc_fragColor = vec4(0.5,0.0,0.5,0.5);
        outF1 = vec4(f1[4],  f1[5],  f1[6],  f1[7]);
        outF2 = vec4(f1[8],  f1[9],  f1[10], f1[11]);
        outF3 = vec4(f1[12], f1[13], f1[14], f1[15]);
        outF4 = vec4(f1[16], f1[17], f1[18], node_type);
        outMacro = vec4(ux,uy,uz,rho);
    } else if (node_type == 2.0) { // moving wall

        f1[0] = f[0];
        // For each direction i, apply bounce-back with wall momentum
        for (int i = 1; i < 19; i++) {
            float corr = 6.0*uW[uInv[i]]*uRho0*(uDirX[uInv[i]]*uU_inlet_X + uDirY[uInv[i]]*uU_inlet_Y+ uDirZ[uInv[i]]*uU_inlet_Z );
            f1[i] = f[uInv[i]] - corr;
        } 
        // Pack into outputs
        pc_fragColor = vec4(f1[0], f1[1], f1[2], f1[3]);
        outF1 = vec4(f1[4],  f1[5],  f1[6],  f1[7]);
        outF2 = vec4(f1[8],  f1[9],  f1[10], f1[11]);
        outF3 = vec4(f1[12], f1[13], f1[14], f1[15]);
        outF4 = vec4(f1[16], f1[17], f1[18], node_type);
        outMacro = vec4(ux,uy,uz,rho);

    } else if (node_type == 1.0) {  // node is solid
        // Bounce-back: reverse directions
        pc_fragColor = vec4(f[0], f[uInv[1]], f[uInv[2]], f[uInv[3]]);
        outF1 = vec4(f[uInv[4]], f[uInv[5]], f[uInv[6]], f[uInv[7]]);
        outF2 = vec4(f[uInv[8]], f[uInv[9]], f[uInv[10]], f[uInv[11]]);
        outF3 = vec4(f[uInv[12]], f[uInv[13]], f[uInv[14]], f[uInv[15]]);
        outF4 = vec4(f[uInv[16]], f[uInv[17]], f[uInv[18]], node_type);
        outMacro = vec4(ux,uy,uz,rho);
    }
           
}