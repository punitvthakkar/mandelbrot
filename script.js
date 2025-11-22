// Shaders
const vsSource = `
    attribute vec4 aVertexPosition;
    void main() {
        gl_Position = aVertexPosition;
    }
`;

const fsSource = `
    precision highp float;

    uniform vec2 u_resolution;
    // Double precision emulation: .x = high, .y = low
    uniform vec2 u_zoomCenter_x; 
    uniform vec2 u_zoomCenter_y;
    uniform vec2 u_zoomSize;
    uniform int u_maxIterations;
    uniform int u_paletteId;
    uniform bool u_highPrecision;
    uniform sampler2D u_paletteTexture;
    
    // New Uniforms
    uniform int u_fractalType; // 0: Mandelbrot, 1: Julia, 2: Bifurcation
    uniform vec2 u_juliaC;

    // Emulated double math functions
    vec2 ds_add(vec2 dsa, vec2 dsb) {
        vec2 dsc;
        float t1, t2, e;
        t1 = dsa.x + dsb.x;
        e = t1 - dsa.x;
        t2 = ((dsb.x - e) + (dsa.x - (t1 - e))) + dsa.y + dsb.y;
        dsc.x = t1 + t2;
        dsc.y = t2 - (dsc.x - t1);
        return dsc;
    }

    vec2 ds_sub(vec2 dsa, vec2 dsb) {
        vec2 dsc;
        float t1, t2, e;
        t1 = dsa.x - dsb.x;
        e = t1 - dsa.x;
        t2 = ((-dsb.x - e) + (dsa.x - (t1 - e))) + dsa.y - dsb.y;
        dsc.x = t1 + t2;
        dsc.y = t2 - (dsc.x - t1);
        return dsc;
    }

    vec2 ds_mul(vec2 dsa, vec2 dsb) {
        vec2 dsc;
        float c11, c21, c2, e, t1, t2;
        float a1, a2, b1, b2, cona, conb, split = 8193.0;
        
        cona = dsa.x * split;
        a1 = cona - (cona - dsa.x);
        a2 = dsa.x - a1;
        
        conb = dsb.x * split;
        b1 = conb - (conb - dsb.x);
        b2 = dsb.x - b1;
        
        c11 = dsa.x * dsb.x;
        c21 = a1 * b1 - c11;
        c21 += a1 * b2;
        c21 += a2 * b1;
        c21 += a2 * b2;
        
        c2 = dsa.x * dsb.y + dsa.y * dsb.x;
        
        t1 = c11 + c2;
        e = t1 - c11;
        t2 = dsa.y * dsb.y + ((c2 - e) + (c11 - (t1 - e))) + c21;
        
        dsc.x = t1 + t2;
        dsc.y = t2 - (dsc.x - t1);
        return dsc;
    }

    vec3 palette( float t, vec3 a, vec3 b, vec3 c, vec3 d ) {
        return a + b*cos( 6.28318*(c*t+d) );
    }

    void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
        
        float iterations = 0.0;
        bool escaped = false;
        float log_zn = 0.0;
        
        // Sierpinski Triangle (Type 2)
        if (u_fractalType == 2) {
            vec2 z = vec2(u_zoomCenter_x.x, u_zoomCenter_y.x) + uv * u_zoomSize.x;
            
            // Center correction
            z.y -= 0.25; 
            
            float scale = 1.0;
            float d = 1000.0;
            
            for (int i = 0; i < 20; i++) { // Fixed iterations for IFS usually enough
                z.x = abs(z.x);
                z.y = abs(z.y);
                
                if (z.x + z.y > 1.0) {
                    float temp = z.x;
                    z.x = 1.0 - z.y;
                    z.y = 1.0 - temp;
                }
                
                z *= 2.0;
                z.y -= 1.0; // Standard Gasket shift
                scale *= 2.0;
                
                // Trap for coloring
                d = min(d, length(z));
            }
            
            // Coloring based on trap distance
            float t = 0.5 + 0.5 * sin(d * 4.0 + float(u_paletteId));
            vec4 color = texture2D(u_paletteTexture, vec2(t, 0.0));
            
            // Make background black-ish
            if (length(z) > 2.0) color *= 0.0;
            
            gl_FragColor = color;
            return;
        }


        // Mandelbrot (0) and Julia (1) Logic
        if (u_highPrecision) {
            vec2 uv_x_ds = vec2(uv.x, 0.0);
            vec2 uv_y_ds = vec2(uv.y, 0.0);

            vec2 c_x, c_y;
            vec2 z_x, z_y;

            if (u_fractalType == 1) {
                // Julia: c is constant, z is pixel
                c_x = vec2(u_juliaC.x, 0.0);
                c_y = vec2(u_juliaC.y, 0.0);
                z_x = ds_add(u_zoomCenter_x, ds_mul(uv_x_ds, u_zoomSize));
                z_y = ds_add(u_zoomCenter_y, ds_mul(uv_y_ds, u_zoomSize));
            } else {
                // Mandelbrot: z starts at 0, c is pixel
                c_x = ds_add(u_zoomCenter_x, ds_mul(uv_x_ds, u_zoomSize));
                c_y = ds_add(u_zoomCenter_y, ds_mul(uv_y_ds, u_zoomSize));
                z_x = vec2(0.0);
                z_y = vec2(0.0);
            }
            
            for (int i = 0; i < 10000; i++) {
                if (i >= u_maxIterations) break;
                
                vec2 z_x2 = ds_mul(z_x, z_x);
                vec2 z_y2 = ds_mul(z_y, z_y);
                
                if (z_x2.x + z_y2.x > 4.0) {
                    escaped = true;
                    iterations = float(i);
                    log_zn = log2(z_x2.x + z_y2.x) / 2.0;
                    break;
                }

                vec2 two = vec2(2.0, 0.0);
                vec2 z_xy = ds_mul(z_x, z_y);
                vec2 two_z_xy = ds_mul(two, z_xy);
                vec2 new_y = ds_add(two_z_xy, c_y);

                vec2 diff_sq = ds_sub(z_x2, z_y2);
                vec2 new_x = ds_add(diff_sq, c_x);

                z_x = new_x;
                z_y = new_y;
            }
        } else {
            vec2 c, z;
            
            if (u_fractalType == 1) {
                // Julia
                c = u_juliaC;
                z = vec2(u_zoomCenter_x.x, u_zoomCenter_y.x) + uv * u_zoomSize.x;
            } else {
                // Mandelbrot
                c = vec2(u_zoomCenter_x.x, u_zoomCenter_y.x) + uv * u_zoomSize.x;
                z = vec2(0.0);
                
                // Cardioid check optimization (Mandelbrot only)
                if (u_fractalType == 0) {
                    float p = sqrt((c.x - 0.25) * (c.x - 0.25) + c.y * c.y);
                    if (c.x < p - 2.0 * p * p + 0.25) {
                        iterations = float(u_maxIterations);
                        // Skip loop
                        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                        return;
                    } 
                }
            }

            for (int i = 0; i < 10000; i++) {
                if (i >= u_maxIterations) break;
                
                float x = (z.x * z.x - z.y * z.y) + c.x;
                float y = (2.0 * z.x * z.y) + c.y;
                
                if (x * x + y * y > 4.0) {
                    escaped = true;
                    iterations = float(i);
                    log_zn = log2(x * x + y * y) / 2.0;
                    break;
                }
                z.x = x;
                z.y = y;
            }
        }

        if (escaped) {
            float nu = log2(log_zn);
            float smooth_i = iterations + 1.0 - nu;
            float t = smooth_i / float(u_maxIterations);
            
            vec3 color = vec3(0.0);

            if (u_paletteId == 0) {
                color = palette(t * 10.0, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.00, 0.10, 0.20));
            } else if (u_paletteId == 1) {
                color = palette(t * 10.0, vec3(0.5), vec3(0.5), vec3(1.0, 1.0, 0.5), vec3(0.8, 0.9, 0.3));
                color = mix(vec3(0.1, 0.0, 0.0), color, sin(t * 20.0) * 0.5 + 0.5);
            } else if (u_paletteId == 2) {
                color = palette(t * 15.0, vec3(0.5), vec3(0.5), vec3(2.0, 1.0, 0.0), vec3(0.5, 0.20, 0.25));
            } else if (u_paletteId == 3) {
                color = palette(t * 8.0, vec3(0.8, 0.5, 0.4), vec3(0.2, 0.4, 0.2), vec3(2.0, 1.0, 1.0), vec3(0.00, 0.25, 0.25));
            } else if (u_paletteId == 4) {
                // Extreme (Texture)
                float cycle = mod(smooth_i, 512.0) / 512.0;
                color = texture2D(u_paletteTexture, vec2(cycle, 0.5)).rgb;
            } else if (u_paletteId == 5) {
                // Neon Nights
                color = palette(t * 4.0, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.3, 0.2, 0.2));
                color = mix(color, vec3(0.0, 1.0, 1.0), sin(t * 10.0) * 0.5 + 0.5);
            } else if (u_paletteId == 6) {
                // Golden Hour
                color = palette(t * 5.0, vec3(0.8, 0.5, 0.4), vec3(0.2, 0.4, 0.2), vec3(2.0, 1.0, 1.0), vec3(0.00, 0.25, 0.25));
                color += vec3(0.2, 0.1, 0.0); 
            } else if (u_paletteId == 7) {
                // Cyberpunk
                color = palette(t * 6.0, vec3(0.5), vec3(0.5), vec3(2.0, 1.0, 0.0), vec3(0.5, 0.20, 0.25));
                color = vec3(1.0) - color; // Invert
            } else if (u_paletteId == 8) {
                // Ice Age
                color = palette(t * 12.0, vec3(0.5), vec3(0.5), vec3(1.0, 1.0, 1.0), vec3(0.0, 0.33, 0.67));
            } else if (u_paletteId == 9) {
                // Forest Deep
                color = palette(t * 8.0, vec3(0.2, 0.7, 0.4), vec3(0.5, 0.2, 0.3), vec3(1.0), vec3(0.0, 0.1, 0.0));
            }
            
            gl_FragColor = vec4(color, 1.0);
        } else {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        }
    }
`;

// Main Logic
const canvas = document.getElementById('glCanvas');
const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });

if (!gl) {
    alert('Unable to initialize WebGL. Your browser or machine may not support it.');
}

// Detect screen type for context-aware zoom
function getScreenContext() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const isMobile = width < 768;
    const isSmall = width < 480;

    return {
        isMobile,
        isSmall,
        width,
        height,
        aspectRatio: width / height
    };
}

// State
let state = {
    zoomCenter: { x: -0.74364388703, y: 0.1318259042 }, // Start at Seahorse Valley
    zoomSize: 3.0,
    maxIterations: 500,
    paletteId: 0,
    isDragging: false,
    lastMouse: { x: 0, y: 0 },
    targetZoomCenter: { x: -0.75, y: 0.0 },
    targetZoomSize: 3.0,
    velocity: { x: 0, y: 0 },
    friction: 0.9,
    isAnimating: false,
    panelVisible: false,
    lastStatsUpdate: 0,
    statsUpdateInterval: 500, // Throttled to 500ms for smoothness
    autoHideTimer: null,
    tutorialShown: localStorage.getItem('mandelbrot_tutorial_shown') === 'true',
    fidgetZoomVelocity: 0,
    fractalType: 0, // 0: Mandelbrot, 1: Julia, 2: Sierpinski
    juliaC: { x: -0.7269, y: 0.1889 },
    circleDrag: { active: false, startX: 0, startY: 0, startIter: 0 }
};

const locations = {
    0: [ // Mandelbrot
        {
            id: 'rising_up',
            title: 'Rising Up',
            description: 'A journey to the upper regions.',
            x: -1.47853,
            y: -0.00307,
            zoom: 26263.8,
            iterations: 800,
            paletteId: 2 // Aurora
        },
        {
            id: 'elephant_saw_me',
            title: 'The Elephant Saw Me',
            description: 'Deep inside the Elephant Valley.',
            x: 0.35506,
            y: -0.06286,
            zoom: 6043.3,
            iterations: 200,
            paletteId: 0 // Ocean
        },
        {
            id: 'hello_jellyfish',
            title: 'Hello Jellyfish',
            description: 'Tentacles of infinite complexity.',
            x: -0.73722,
            y: 0.20866,
            zoom: 6146.2,
            iterations: 650,
            paletteId: 4 // Extreme
        },
        {
            id: 'three_arms',
            title: 'The Three Arms',
            description: 'A spiraling trifecta.',
            x: -0.05154,
            y: 0.83636,
            zoom: 1460.9,
            iterations: 300,
            paletteId: 1 // Magma
        }
    ],
    1: [ // Julia
        {
            id: 'julia_spiral',
            title: 'Electric Spirals',
            description: 'The classic Julia spiral center.',
            x: 0.0,
            y: 0.0,
            zoom: 500.0,
            iterations: 300,
            paletteId: 4 // Extreme
        },
        {
            id: 'julia_edge',
            title: 'Edge of Chaos',
            description: 'Where order meets the void.',
            x: 0.8,
            y: 0.2,
            zoom: 1200.0,
            iterations: 400,
            paletteId: 2 // Aurora
        },
        {
            id: 'julia_deep',
            title: 'Deep Dive',
            description: 'Plunging into the infinite pattern.',
            x: -0.5,
            y: 0.5,
            zoom: 3000.0,
            iterations: 600,
            paletteId: 0 // Ocean
        },
        {
            id: 'julia_tendrils',
            title: 'Golden Tendrils',
            description: 'Delicate structures in the gloom.',
            x: 0.3,
            y: -0.3,
            zoom: 1500.0,
            iterations: 350,
            paletteId: 3 // Amber
        }
    ],
    2: [ // Sierpinski
        {
            id: 'sierpinski_void',
            title: 'The Great Void',
            description: 'The central emptiness.',
            x: 0.5,
            y: 0.288,
            zoom: 100.0,
            iterations: 200,
            paletteId: 1 // Magma
        },
        {
            id: 'sierpinski_corner',
            title: 'Cornerstone',
            description: 'The edge of the triangle.',
            x: 0.0,
            y: 0.0,
            zoom: 500.0,
            iterations: 300,
            paletteId: 0 // Ocean
        },
        {
            id: 'sierpinski_micro',
            title: 'Microverse',
            description: 'Infinite regression of triangles.',
            x: 0.25,
            y: 0.433,
            zoom: 2000.0,
            iterations: 400,
            paletteId: 2 // Aurora
        },
        {
            id: 'sierpinski_peak',
            title: 'The Summit',
            description: 'At the very top of the structure.',
            x: 0.5,
            y: 0.866,
            zoom: 800.0,
            iterations: 250,
            paletteId: 4 // Extreme
        }
    ]
};

// Shader Program Setup
function loadShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Shader compilation error:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }

    return shader;
}

function initShaderProgram(gl, vsSource, fsSource) {
    const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource);

    if (!vertexShader || !fragmentShader) {
        console.error('Failed to compile shaders');
        return null;
    }

    const shaderProgram = gl.createProgram();
    gl.attachShader(shaderProgram, vertexShader);
    gl.attachShader(shaderProgram, fragmentShader);
    gl.linkProgram(shaderProgram);

    if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        console.error('Shader program linking error:', gl.getProgramInfoLog(shaderProgram));
        return null;
    }

    return shaderProgram;
}

const shaderProgram = initShaderProgram(gl, vsSource, fsSource);

if (!shaderProgram) {
    console.error('Failed to initialize shader program');
}

const programInfo = shaderProgram ? {
    program: shaderProgram,
    attribLocations: {
        vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition'),
    },
    uniformLocations: {
        resolution: gl.getUniformLocation(shaderProgram, 'u_resolution'),
        zoomCenterX: gl.getUniformLocation(shaderProgram, 'u_zoomCenter_x'),
        zoomCenterY: gl.getUniformLocation(shaderProgram, 'u_zoomCenter_y'),
        zoomSize: gl.getUniformLocation(shaderProgram, 'u_zoomSize'),
        maxIterations: gl.getUniformLocation(shaderProgram, 'u_maxIterations'),
        paletteId: gl.getUniformLocation(shaderProgram, 'u_paletteId'),
        highPrecision: gl.getUniformLocation(shaderProgram, 'u_highPrecision'),
        paletteTexture: gl.getUniformLocation(shaderProgram, 'u_paletteTexture'),
        fractalType: gl.getUniformLocation(shaderProgram, 'u_fractalType'),
        juliaC: gl.getUniformLocation(shaderProgram, 'u_juliaC'),
    },
} : null;

// Texture Palette Generation
function generateFractalExtremePalette() {
    const colorStops = [
        { pos: 0.00, r: 0, g: 0, b: 0 },
        { pos: 0.05, r: 25, g: 7, b: 26 },
        { pos: 0.10, r: 9, g: 1, b: 47 },
        { pos: 0.15, r: 4, g: 4, b: 73 },
        { pos: 0.20, r: 0, g: 7, b: 100 },
        { pos: 0.25, r: 12, g: 44, b: 138 },
        { pos: 0.30, r: 24, g: 82, b: 177 },
        { pos: 0.35, r: 57, g: 125, b: 209 },
        { pos: 0.40, r: 134, g: 181, b: 229 },
        { pos: 0.45, r: 211, g: 236, b: 248 },
        { pos: 0.50, r: 241, g: 233, b: 191 },
        { pos: 0.55, r: 248, g: 201, b: 95 },
        { pos: 0.60, r: 255, g: 170, b: 0 },
        { pos: 0.65, r: 240, g: 126, b: 13 },
        { pos: 0.70, r: 204, g: 71, b: 10 },
        { pos: 0.75, r: 158, g: 1, b: 66 },
        { pos: 0.80, r: 110, g: 0, b: 95 },
        { pos: 0.85, r: 106, g: 0, b: 168 },
        { pos: 0.90, r: 77, g: 16, b: 140 },
        { pos: 0.95, r: 45, g: 20, b: 80 },
        { pos: 1.00, r: 0, g: 0, b: 0 }
    ];

    const textureSize = 2048;
    const textureData = new Uint8Array(textureSize * 4);

    for (let i = 0; i < textureSize; i++) {
        const t = i / (textureSize - 1);
        let lower = colorStops[0];
        let upper = colorStops[colorStops.length - 1];

        for (let j = 0; j < colorStops.length - 1; j++) {
            if (t >= colorStops[j].pos && t <= colorStops[j + 1].pos) {
                lower = colorStops[j];
                upper = colorStops[j + 1];
                break;
            }
        }

        const localT = (t - lower.pos) / (upper.pos - lower.pos);
        const smoothT = localT * localT * (3 - 2 * localT);

        textureData[i * 4 + 0] = Math.round(lower.r + (upper.r - lower.r) * smoothT);
        textureData[i * 4 + 1] = Math.round(lower.g + (upper.g - lower.g) * smoothT);
        textureData[i * 4 + 2] = Math.round(lower.b + (upper.b - lower.b) * smoothT);
        textureData[i * 4 + 3] = 255;
    }

    return textureData;
}

const paletteTexture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
const textureData = generateFractalExtremePalette();
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2048, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, textureData);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

function splitDouble(value) {
    const hi = Math.fround(value);
    const lo = value - hi;
    return [hi, lo];
}

// Buffers
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
const positions = [
    -1.0, 1.0,
    1.0, 1.0,
    -1.0, -1.0,
    1.0, -1.0,
];
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

let lastTime = 0;

// Rendering
function drawScene(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const deltaTime = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    if (!state.isDragging && !state.isAnimating) {
        state.targetZoomCenter.x -= state.velocity.x * deltaTime * 60;
        state.targetZoomCenter.y -= state.velocity.y * deltaTime * 60;

        state.velocity.x *= Math.pow(state.friction, deltaTime * 60);
        state.velocity.y *= Math.pow(state.friction, deltaTime * 60);

        if (Math.abs(state.velocity.x) < 1e-9 && Math.abs(state.velocity.y) < 1e-9) {
            state.velocity = { x: 0, y: 0 };
        }
    }

    // Handle Fidget Zoom
    if (state.fidgetZoomVelocity && state.fidgetZoomVelocity !== 0) {
        handleZoom(state.fidgetZoomVelocity);
    }

    const lerpFactor = 1.0 - Math.pow(0.1, deltaTime * 10);

    if (!state.isAnimating) {
        state.zoomSize += (state.targetZoomSize - state.zoomSize) * lerpFactor;
        state.zoomCenter.x += (state.targetZoomCenter.x - state.zoomCenter.x) * lerpFactor;
        state.zoomCenter.y += (state.targetZoomCenter.y - state.zoomCenter.y) * lerpFactor;
    }

    resizeCanvasToDisplaySize(gl.canvas);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(programInfo.program);

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

    gl.uniform2f(programInfo.uniformLocations.resolution, gl.canvas.width, gl.canvas.height);

    const centerXSplit = splitDouble(state.zoomCenter.x);
    const centerYSplit = splitDouble(state.zoomCenter.y);
    const zoomSizeSplit = splitDouble(state.zoomSize);

    gl.uniform2f(programInfo.uniformLocations.zoomCenterX, centerXSplit[0], centerXSplit[1]);
    gl.uniform2f(programInfo.uniformLocations.zoomCenterY, centerYSplit[0], centerYSplit[1]);
    gl.uniform2f(programInfo.uniformLocations.zoomSize, zoomSizeSplit[0], zoomSizeSplit[1]);

    gl.uniform1i(programInfo.uniformLocations.maxIterations, state.maxIterations);
    gl.uniform1i(programInfo.uniformLocations.paletteId, state.paletteId);
    gl.uniform1i(programInfo.uniformLocations.fractalType, state.fractalType);
    gl.uniform2f(programInfo.uniformLocations.juliaC, state.juliaC.x, state.juliaC.y);

    const highPrecision = state.zoomSize < 0.001 && state.fractalType < 2; // Only Mandelbrot/Julia use high precision logic
    gl.uniform1i(programInfo.uniformLocations.highPrecision, highPrecision ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
    gl.uniform1i(programInfo.uniformLocations.paletteTexture, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    updateStats();
    requestAnimationFrame(drawScene);
}

function resizeCanvasToDisplaySize(canvas) {
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
    }
}

function updateStats() {
    const now = Date.now();
    if (now - state.lastStatsUpdate < state.statsUpdateInterval) return;
    state.lastStatsUpdate = now;

    const elX = document.getElementById('coordX');
    const elY = document.getElementById('coordY');
    const elZ = document.getElementById('coordZ');

    if (elX) elX.innerText = state.zoomCenter.x.toFixed(6);
    if (elY) elY.innerText = state.zoomCenter.y.toFixed(6);
    if (elZ) elZ.innerText = (3.0 / state.zoomSize).toFixed(1) + '×';
}

// Visual Catalogue
function renderCatalogue() {
    const container = document.getElementById('visualCatalogue');
    if (!container) return;
    container.innerHTML = '';

    const currentLocations = locations[state.fractalType] || [];

    // Load saved locations from localStorage
    const savedLocations = JSON.parse(localStorage.getItem('fractonaut_saved_locations') || '[]');

    // Combine predefined and saved locations
    const allLocations = [...currentLocations, ...savedLocations];

    allLocations.forEach(loc => {
        const item = document.createElement('div');
        item.className = 'catalogue-item';
        item.innerHTML = `
    <h4 > ${loc.title}</h4>
            <p>${loc.description}</p>
            <div class="meta">
                <span>Zoom: ${loc.zoom}x</span>
                <span>Iter: ${loc.iterations}</span>
            </div>
`;
        item.onclick = () => startHypnoticJourney(loc);
        container.appendChild(item);
    });
}

function startHypnoticJourney(loc) {
    const durationInput = document.getElementById('journeyDuration');
    const duration = parseFloat(durationInput.value) || 10;

    // 1. Reset to Home Zoom but Target Location
    state.zoomCenter = { x: loc.x, y: loc.y };
    state.zoomSize = 3.0;
    state.targetZoomCenter = { x: loc.x, y: loc.y };
    state.targetZoomSize = 3.0;

    // 2. Set Color & Detail
    state.paletteId = loc.paletteId;
    state.maxIterations = loc.iterations;

    // Update UI controls to match
    document.getElementById('iterations').value = loc.iterations;
    document.getElementById('iterValue').innerText = loc.iterations;
    document.querySelectorAll('.palette-card').forEach(c => c.classList.remove('active'));
    const paletteBtn = document.querySelector(`.palette-card[data-palette="${loc.paletteId}"]`);
    if (paletteBtn) paletteBtn.classList.add('active');

    // 3. Animate Zoom Only
    state.isAnimating = true;
    const startTime = Date.now();
    const startSize = 3.0;
    const targetSize = 3.0 / (loc.zoom || 1.0);

    function animate() {
        const now = Date.now();
        const elapsed = (now - startTime) / 1000;
        const t = Math.min(elapsed / duration, 1.0);

        // Smooth easing
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

        // Interpolate Zoom (Logarithmic)
        const logStart = Math.log(startSize);
        const logEnd = Math.log(targetSize);
        const currentLog = logStart + (logEnd - logStart) * ease;

        state.targetZoomSize = Math.exp(currentLog);
        state.zoomSize = state.targetZoomSize;

        // Ensure center stays locked
        state.targetZoomCenter.x = loc.x;
        state.targetZoomCenter.y = loc.y;
        state.zoomCenter.x = loc.x;
        state.zoomCenter.y = loc.y;

        if (t < 1.0) {
            requestAnimationFrame(animate);
        } else {
            state.isAnimating = false;
        }
    }

    animate();

    // Close panel on all devices
    document.getElementById('controlPanel').classList.remove('visible');
    document.getElementById('controlToggle').classList.remove('hidden'); // Ensure toggle comes back
}

// Initialize Catalogue
renderCatalogue();

// Context-aware zoom with screen size adaptation
function handleZoom(delta, x, y) {
    const screenCtx = getScreenContext();

    // Base zoom factor varies by screen size and current zoom level
    let baseFactor = 0.15;

    // Mobile gets slower, more controlled zoom
    if (screenCtx.isMobile) {
        baseFactor = screenCtx.isSmall ? 0.08 : 0.10;
    }

    // Progressive slowdown as we zoom in (exponential)
    // Scale baseFactor by delta magnitude for analog control
    const speedMultiplier = Math.abs(delta);
    const zoomFactor = 1.0 + (baseFactor * speedMultiplier) * Math.pow(state.targetZoomSize, 0.3);

    if (x === undefined || y === undefined) {
        x = canvas.width / 2;
        y = canvas.height / 2;
    }

    const uvx = (x - canvas.width / 2) / canvas.height;
    const uvy = (canvas.height - y - canvas.height / 2) / canvas.height;

    const wx = state.targetZoomCenter.x + uvx * state.targetZoomSize;
    const wy = state.targetZoomCenter.y + uvy * state.targetZoomSize;

    if (delta > 0) {
        state.targetZoomSize *= zoomFactor;
    } else {
        state.targetZoomSize /= zoomFactor;
    }

    state.targetZoomCenter.x = wx - uvx * state.targetZoomSize;
    state.targetZoomCenter.y = wy - uvy * state.targetZoomSize;
}

// Mouse/Touch Interactions
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    handleZoom(delta, e.clientX, e.clientY);
}, { passive: false });

// Circle Control Logic
function initCircleControl() {
    const circle = document.getElementById('circleControl');
    if (!circle) return;

    const handleStart = (x, y) => {
        state.circleDrag.active = true;
        state.circleDrag.startX = x;
        state.circleDrag.startY = y;
        state.circleDrag.startIter = state.maxIterations;
        state.circleDrag.maxDist = 0; // Track max movement for tap detection
        circle.classList.add('dragging');
    };

    const handleMove = (x, y) => {
        if (!state.circleDrag.active) return;

        const dx = x - state.circleDrag.startX;
        const dy = y - state.circleDrag.startY;

        const dist = Math.sqrt(dx * dx + dy * dy);
        state.circleDrag.maxDist = Math.max(state.circleDrag.maxDist, dist);

        // Vertical Drag -> Zoom
        // Pull UP (negative dy) -> Zoom IN (requires negative delta)
        // Pull DOWN (positive dy) -> Zoom OUT (requires positive delta)
        if (Math.abs(dy) > 10) {
            const screenCtx = getScreenContext();
            // Much lower sensitivity for mobile to prevent "way too rapid" zooming
            const sensitivity = screenCtx.isMobile ? 0.015 : 0.05;
            const zoomDelta = dy * sensitivity;
            handleZoom(zoomDelta);
        }

        // Horizontal Drag -> Detail (Iterations)
        // Drag RIGHT (positive dx) -> Increase Detail
        // Drag LEFT (negative dx) -> Decrease Detail
        // Throttle this to prevent stutter
        const now = Date.now();
        if (Math.abs(dx) > 10 && (now - state.lastStatsUpdate > 100)) { // Reuse stats timer or new one? Let's just use loose throttling
            const iterDelta = Math.floor(dx * 2);
            let newIter = state.circleDrag.startIter + iterDelta;
            newIter = Math.max(50, Math.min(5000, newIter)); // Clamp

            if (state.maxIterations !== newIter) {
                state.maxIterations = newIter;
                // Update UI
                const iterInput = document.getElementById('iterations');
                const iterDisplay = document.getElementById('iterValue');
                if (iterInput) iterInput.value = newIter;
                if (iterDisplay) iterDisplay.innerText = newIter;
            }
        }

        // Visual Feedback
        const inner = circle.querySelector('.circle-inner');
        if (inner) {
            const moveX = Math.max(-15, Math.min(15, dx * 0.2));
            const moveY = Math.max(-15, Math.min(15, dy * 0.2));
            inner.style.transform = `translate(${moveX}px, ${moveY}px)`;
        }
    };

    const handleEnd = () => {
        if (!state.circleDrag.active) return;

        // Check for Tap (minimal movement)
        const wasTap = state.circleDrag.maxDist < 10;

        state.circleDrag.active = false;
        circle.classList.remove('dragging');

        const inner = circle.querySelector('.circle-inner');
        if (inner) inner.style.transform = '';

        if (wasTap) {
            toggleControlPanel();
        }
    };

    // Touch Events
    circle.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        handleStart(touch.clientX, touch.clientY);
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (state.circleDrag.active) {
            e.preventDefault(); // Prevent scroll
            const touch = e.touches[0];
            handleMove(touch.clientX, touch.clientY);
        }
    }, { passive: false });

    window.addEventListener('touchend', handleEnd);

    // Mouse Events
    circle.addEventListener('mousedown', (e) => {
        handleStart(e.clientX, e.clientY);
    });

    window.addEventListener('mousemove', (e) => {
        handleMove(e.clientX, e.clientY);
    });

    window.addEventListener('mouseup', handleEnd);
}

function toggleControlPanel() {
    const panel = document.getElementById('controlPanel');
    panel.classList.toggle('visible');
    state.panelVisible = panel.classList.contains('visible');
}

// Save System & URL Logic
function initSaveSystem() {
    const trigger = document.getElementById('statusTrigger');
    const modal = document.getElementById('saveModal');
    const cancelBtn = document.getElementById('cancelSaveBtn');
    const confirmBtn = document.getElementById('confirmSaveBtn');

    if (trigger) {
        trigger.addEventListener('click', () => {
            modal.classList.remove('hidden');
        });
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
    }

    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            const name = document.getElementById('locationNameInput').value || 'Untitled Scene';
            const duration = document.getElementById('locationDurationInput').value || 30;
            saveScene(name, duration);
            modal.classList.add('hidden');
        });
    }

    // Check URL Params on Load
    const params = new URLSearchParams(window.location.search);
    if (params.has('x') && params.has('y') && params.has('z')) {
        state.zoomCenter.x = parseFloat(params.get('x'));
        state.zoomCenter.y = parseFloat(params.get('y'));
        state.zoomSize = 3.0 / parseFloat(params.get('z'));
        state.maxIterations = parseInt(params.get('i')) || 500;
        state.paletteId = parseInt(params.get('p')) || 0;
        state.fractalType = parseInt(params.get('f')) || 0;

        state.targetZoomCenter = { ...state.zoomCenter };
        state.targetZoomSize = state.zoomSize;
    }
}

function saveScene(name, duration) {
    // 1. Generate URL
    const zoom = 3.0 / state.zoomSize;
    const params = new URLSearchParams({
        x: state.zoomCenter.x.toFixed(6),
        y: state.zoomCenter.y.toFixed(6),
        z: zoom.toFixed(2),
        i: state.maxIterations,
        p: state.paletteId,
        f: state.fractalType
    });
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;

    // 2. Save to LocalStorage (Catalogue)
    const newLoc = {
        id: Date.now().toString(),
        title: name,
        description: `Duration: ${duration}s`,
        x: state.zoomCenter.x,
        y: state.zoomCenter.y,
        zoom: zoom,
        iterations: state.maxIterations,
        paletteId: state.paletteId,
        duration: duration
    };

    const saved = JSON.parse(localStorage.getItem('fractonaut_saved_locations') || '[]');
    saved.push(newLoc);
    localStorage.setItem('fractonaut_saved_locations', JSON.stringify(saved));

    // 3. Refresh Catalogue
    renderCatalogue();

    // 4. Copy URL to Clipboard (Feedback)
    navigator.clipboard.writeText(url).then(() => {
        alert('Scene saved & URL copied to clipboard!');
    }).catch(() => {
        alert('Scene saved! (Could not copy URL)');
    });
}

// Initialize
initCircleControl();
initSaveSystem();

let lastClickTime = 0;
let lastClickPos = { x: 0, y: 0 };

canvas.addEventListener('click', (e) => {
    const now = Date.now();
    const timeDiff = now - lastClickTime;
    const distance = Math.sqrt(
        Math.pow(e.clientX - lastClickPos.x, 2) +
        Math.pow(e.clientY - lastClickPos.y, 2)
    );

    if (timeDiff < 300 && distance < 10) {
        handleZoom(-1, e.clientX, e.clientY);
        lastClickTime = 0;
    } else {
        lastClickTime = now;
        lastClickPos = { x: e.clientX, y: e.clientY };
    }
});


canvas.addEventListener('mousedown', (e) => {
    state.isDragging = true;
    state.isAnimating = false;
    state.velocity = { x: 0, y: 0 };
    state.lastMouse = { x: e.clientX, y: e.clientY };
});

window.addEventListener('mouseup', () => {
    state.isDragging = false;
});

window.addEventListener('mousemove', (e) => {
    if (!state.isDragging) return;

    const dx = e.clientX - state.lastMouse.x;
    const dy = e.clientY - state.lastMouse.y;

    const scale = state.zoomSize / canvas.height;

    state.targetZoomCenter.x -= dx * scale;
    state.targetZoomCenter.y += dy * scale;

    state.velocity.x = dx * scale * 0.5;
    state.velocity.y = dy * scale * 0.5;

    state.lastMouse = { x: e.clientX, y: e.clientY };
});

// Touch support with improved mobile handling
let lastTouchDistance = 0;

canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
        state.isDragging = true;
        state.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        state.velocity = { x: 0, y: 0 };
    } else if (e.touches.length === 2) {
        state.isDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDistance = Math.sqrt(dx * dx + dy * dy);
    }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();

    if (e.touches.length === 1 && state.isDragging) {
        const dx = e.touches[0].clientX - state.lastMouse.x;
        const dy = e.touches[0].clientY - state.lastMouse.y;

        const scale = state.zoomSize / canvas.height;

        state.targetZoomCenter.x -= dx * scale;
        state.targetZoomCenter.y += dy * scale;

        state.velocity.x = dx * scale * 2.0;
        state.velocity.y = dy * scale * 2.0;

        state.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

        if (lastTouchDistance > 0) {
            const delta = lastTouchDistance - distance;
            const screenCtx = getScreenContext();

            // Adaptive zoom sensitivity for mobile
            const zoomStrength = screenCtx.isMobile ? 0.003 : 0.005;

            const uvx = (centerX - canvas.width / 2) / canvas.height;
            const uvy = (canvas.height - centerY - canvas.height / 2) / canvas.height;

            const wx = state.targetZoomCenter.x + uvx * state.targetZoomSize;
            const wy = state.targetZoomCenter.y + uvy * state.targetZoomSize;

            if (delta > 0) {
                state.targetZoomSize *= (1 + delta * zoomStrength);
            } else {
                state.targetZoomSize /= (1 - delta * zoomStrength);
            }

            state.targetZoomCenter.x = wx - uvx * state.targetZoomSize;
            state.targetZoomCenter.y = wy - uvy * state.targetZoomSize;
        }
        lastTouchDistance = distance;
    }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) {
        state.isDragging = false;
    }
});



// UI Controls - Panel Toggle with Auto-Hide
function togglePanel(forceState) {
    state.panelVisible = forceState !== undefined ? forceState : !state.panelVisible;

    const panel = document.getElementById('controlPanel');
    const fab = document.getElementById('controlToggle');

    panel.classList.toggle('visible', state.panelVisible);
    fab.classList.toggle('hidden', state.panelVisible);

    // Reset auto-hide timer
    clearTimeout(state.autoHideTimer);

    if (state.panelVisible) {
        state.autoHideTimer = setTimeout(() => {
            togglePanel(false);
        }, 10000); // Auto-hide after 10 seconds
    }
}



document.getElementById('panelClose').addEventListener('click', () => {
    togglePanel(false);
});

// Control interactions
document.getElementById('iterations').addEventListener('input', (e) => {
    state.maxIterations = parseInt(e.target.value);
    document.getElementById('iterValue').innerText = state.maxIterations;
});

document.querySelectorAll('.palette-card').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.palette-card').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.paletteId = parseInt(e.currentTarget.dataset.palette);
    });
});

// Removed obsolete locationSelect listener

// Quick Actions
const resetBtn = document.getElementById('resetBtn');
if (resetBtn) {
    resetBtn.addEventListener('click', () => {
        state.velocity = { x: 0, y: 0 };
        state.maxIterations = 500;
        state.paletteId = 0;

        if (state.fractalType === 2) { // Sierpinski
            state.targetZoomCenter = { x: 0.5, y: 0.288 };
            state.targetZoomSize = 1.5;
            state.maxIterations = 200;
        } else if (state.fractalType === 1) { // Julia
            state.targetZoomCenter = { x: 0.0, y: 0.0 };
            state.targetZoomSize = 3.0;
        } else { // Mandelbrot
            state.targetZoomCenter = { x: -0.75, y: 0.0 };
            state.targetZoomSize = 3.0;
        }

        state.zoomCenter = { ...state.targetZoomCenter };
        state.zoomSize = state.targetZoomSize;

        // Reset UI controls
        document.getElementById('iterations').value = state.maxIterations;
        document.getElementById('iterValue').innerText = state.maxIterations;
        document.querySelectorAll('.palette-card').forEach(c => c.classList.remove('active'));
        document.querySelector('.palette-card[data-palette="0"]').classList.add('active');
    });
}

const screenshotBtn = document.getElementById('screenshotBtn');
if (screenshotBtn) {
    screenshotBtn.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = `mandelbrot - ${Date.now()}.png`;
        link.href = canvas.toDataURL();
        link.click();
    });
}

const fullscreenBtn = document.getElementById('fullscreenBtn');
if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', () => {
        toggleFullscreen();
    });
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.body.requestFullscreen().catch(err => {
            console.error(`Fullscreen error: ${err.message} `);
        });
        const label = document.getElementById('fullscreenLabel');
        if (label) label.innerText = 'Exit';
    } else {
        document.exitFullscreen();
        const label = document.getElementById('fullscreenLabel');
        if (label) label.innerText = 'Full';
    }
}



// Keyboard shortcuts (desktop only)
document.addEventListener('keydown', (e) => {
    const screenCtx = getScreenContext();
    if (screenCtx.isMobile) return; // Disable keyboard shortcuts on mobile

    switch (e.key.toLowerCase()) {
        case 'c':
            togglePanel();
            break;
        case 'escape':
            togglePanel(false);
            break;
    }
});

// Auto Tour logic removed

// Gesture Tutorial (mobile first-time)
function showTutorial() {
    const tutorial = document.getElementById('gestureTutorial');
    tutorial.classList.add('visible');
}

function hideTutorial() {
    const tutorial = document.getElementById('gestureTutorial');
    tutorial.classList.remove('visible');
    localStorage.setItem('mandelbrot_tutorial_shown', 'true');
}

document.getElementById('tutorialClose').addEventListener('click', hideTutorial);
document.getElementById('tutorialNext').addEventListener('click', hideTutorial);

// Show tutorial on first mobile visit
if (!state.tutorialShown && getScreenContext().isMobile) {
    setTimeout(showTutorial, 1500);
}

// Window resize handler with debouncing
let resizeTimeout = null;
window.addEventListener('resize', () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        resizeCanvasToDisplaySize(canvas);
    }, 150);
});

// Initialize
// updateLocationInfo('default'); removed

// --- PWA Install Logic ---
let deferredPrompt;
const pwaPrompt = document.getElementById('pwaInstallPrompt');
const installBtn = document.getElementById('pwaInstallBtn');
const closePwaBtn = document.getElementById('pwaCloseBtn');

// Check if app is already installed (standalone mode)
function isAppInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true ||
        document.referrer.includes('android-app://');
}

// Check if prompt was dismissed
function wasPromptDismissed() {
    return localStorage.getItem('pwa_prompt_dismissed') === 'true';
}

// Mark prompt as dismissed
function dismissPrompt() {
    localStorage.setItem('pwa_prompt_dismissed', 'true');
    pwaPrompt.classList.add('hidden');
}

// Check if we should show the prompt
function shouldShowPrompt() {
    // Don't show if already installed
    if (isAppInstalled()) {
        return false;
    }
    // Don't show if previously dismissed
    if (wasPromptDismissed()) {
        return false;
    }
    // Only show on mobile/tablet widths
    if (window.innerWidth >= 768) {
        return false;
    }
    return true;
}

window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the mini-infobar from appearing on mobile
    e.preventDefault();
    // Stash the event so it can be triggered later.
    deferredPrompt = e;
    console.log('beforeinstallprompt fired');

    // Only show if conditions are met
    if (shouldShowPrompt()) {
        pwaPrompt.classList.remove('hidden');
    }
});

installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) {
        console.log('No deferred prompt available');
        return;
    }
    // Show the install prompt
    deferredPrompt.prompt();
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    // We've used the prompt, and can't use it again, throw it away
    deferredPrompt = null;
    // Hide our custom UI
    pwaPrompt.classList.add('hidden');
    // Mark as dismissed if user declined
    if (outcome === 'dismissed') {
        dismissPrompt();
    }
});

closePwaBtn.addEventListener('click', () => {
    dismissPrompt();
});

window.addEventListener('appinstalled', () => {
    // Hide the app-provided install promotion
    pwaPrompt.classList.add('hidden');
    deferredPrompt = null;
    // Mark as dismissed since app is now installed
    dismissPrompt();
    console.log('PWA was installed');
});

// Check on load if we should hide the prompt
if (isAppInstalled() || wasPromptDismissed()) {
    pwaPrompt.classList.add('hidden');
}

// --- HUD & Save Location Logic ---


// Start rendering
// --- Explore Tabs & Fractal Switching ---
const exploreTabs = document.querySelectorAll('.explore-tab');
const tabContents = document.querySelectorAll('.tab-content');
const fractalCards = document.querySelectorAll('.fractal-card');

exploreTabs.forEach(tab => {
    tab.addEventListener('click', () => {
        // Switch Tabs
        exploreTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const targetId = tab.dataset.tab;
        tabContents.forEach(c => {
            c.classList.remove('active');
            if (c.id === `tab${targetId.charAt(0).toUpperCase() + targetId.slice(1)}`) {
                c.classList.add('active');
            }
        });
    });
});

fractalCards.forEach(card => {
    card.addEventListener('click', () => {
        const type = parseInt(card.dataset.type);

        // Update UI
        fractalCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');

        // Update State
        state.fractalType = type;

        // Reset View for new fractal
        // Reset View for new fractal
        if (type === 2) { // Sierpinski
            state.targetZoomCenter = { x: 0.5, y: 0.288 };
            state.targetZoomSize = 1.5;
            state.maxIterations = 200;
        } else if (type === 1) { // Julia
            state.targetZoomCenter = { x: 0.0, y: 0.0 };
            state.targetZoomSize = 3.0;
            state.maxIterations = 500;
        } else { // Mandelbrot
            state.targetZoomCenter = { x: -0.75, y: 0.0 };
            state.targetZoomSize = 3.0;
            state.maxIterations = 500;
        }

        state.zoomCenter = { ...state.targetZoomCenter };
        state.zoomSize = state.targetZoomSize;

        // Re-render catalogue for the new fractal type
        renderCatalogue();

        // Snap to view
        state.zoomCenter = { ...state.targetZoomCenter };
        state.zoomSize = state.targetZoomSize;

        // Close panel on mobile
        if (window.innerWidth < 768) {
            togglePanel(false);
        }
    });
});

// Start rendering
requestAnimationFrame(drawScene);
