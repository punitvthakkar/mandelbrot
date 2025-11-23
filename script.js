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
    circleDrag: { active: false, startX: 0, startY: 0, startIter: 0 },
    pendingInteraction: null, // For RAF-throttled interactions
    interactionRAF: null // Track RAF ID for interactions
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

// Rendering - Optimized for smoothness
function drawScene(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const deltaTime = (timestamp - lastTime) / 1000;
    lastTime = timestamp;

    // Velocity physics - only when not dragging or animating
    if (!state.isDragging && !state.isAnimating) {
        const dt60 = deltaTime * 60;
        state.targetZoomCenter.x -= state.velocity.x * dt60;
        state.targetZoomCenter.y -= state.velocity.y * dt60;

        const frictionPow = Math.pow(state.friction, dt60);
        state.velocity.x *= frictionPow;
        state.velocity.y *= frictionPow;

        // Early zero-out for better performance
        if (Math.abs(state.velocity.x) < 1e-9 && Math.abs(state.velocity.y) < 1e-9) {
            state.velocity.x = 0;
            state.velocity.y = 0;
        }
    }

    // Handle Fidget Zoom
    if (state.fidgetZoomVelocity !== 0) {
        handleZoom(state.fidgetZoomVelocity);
    }

    // Smooth interpolation
    if (!state.isAnimating) {
        const lerpFactor = 1.0 - Math.pow(0.1, deltaTime * 10);
        
        // Apply smooth zoom limit at 0.5x (zoomSize = 6.0)
        const maxZoomSize = 6.0;
        if (state.targetZoomSize > maxZoomSize) {
            const excess = state.targetZoomSize - maxZoomSize;
            const resistance = 1.0 / (1.0 + excess * 0.5);
            state.targetZoomSize = maxZoomSize + excess * resistance;
            state.targetZoomCenter.x = 0.75;
            state.targetZoomCenter.y = 0.0;
        }
        
        // Single lerp calculation for all axes
        const diffSize = state.targetZoomSize - state.zoomSize;
        const diffX = state.targetZoomCenter.x - state.zoomCenter.x;
        const diffY = state.targetZoomCenter.y - state.zoomCenter.y;
        
        state.zoomSize += diffSize * lerpFactor;
        state.zoomCenter.x += diffX * lerpFactor;
        state.zoomCenter.y += diffY * lerpFactor;
    } else {
        state.zoomSize = state.targetZoomSize;
    }

    // Minimal canvas resize check
    resizeCanvasToDisplaySize(gl.canvas);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(programInfo.program);

    // Vertex setup (no change needed each frame, but kept for compatibility)
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(programInfo.attribLocations.vertexPosition, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);

    // Set uniforms
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

    const highPrecision = state.zoomSize < 0.001 && state.fractalType < 2;
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
        
        // Check if this is a saved location (has an id that's a timestamp string)
        const isSavedLocation = savedLocations.some(saved => saved.id === loc.id);
        
        item.innerHTML = `
            <div class="catalogue-item-content">
                <h4>${loc.title}</h4>
                <p>${loc.description}</p>
                <div class="meta">
                    <span>Zoom: ${loc.zoom}x</span>
                    <span>Iter: ${loc.iterations}</span>
                </div>
            </div>
            ${isSavedLocation ? `
                <div class="catalogue-item-actions" onclick="event.stopPropagation()">
                    <button class="catalogue-action-btn share-btn" data-loc-id="${loc.id}" title="Share">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                            <polyline points="16 6 12 2 8 6"></polyline>
                            <line x1="12" y1="2" x2="12" y2="15"></line>
                        </svg>
                    </button>
                    <button class="catalogue-action-btn delete-btn" data-loc-id="${loc.id}" title="Delete">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            ` : ''}
        `;
        
        // Main click to start journey
        const contentDiv = item.querySelector('.catalogue-item-content');
        if (contentDiv) {
            contentDiv.onclick = () => startHypnoticJourney(loc);
        }
        
        // Share button handler
        const shareBtn = item.querySelector('.share-btn');
        if (shareBtn) {
            shareBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                shareLocation(loc);
            });
        }
        
        // Delete button handler
        const deleteBtn = item.querySelector('.delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteLocation(loc.id);
            });
        }
        
        container.appendChild(item);
    });
}

function getShareText(locationName, shareUrl) {
    return `Let's go on a trip to ${locationName} on Fractonaut\n\n${shareUrl}`;
}

function getShareTextWithoutUrl(locationName) {
    return `Let's go on a trip to ${locationName} on Fractonaut`;
}

function shareLocation(loc) {
    const zoom = loc.zoom || (3.0 / state.zoomSize);
    const params = new URLSearchParams({
        x: loc.x.toFixed(6),
        y: loc.y.toFixed(6),
        z: zoom.toFixed(2),
        i: loc.iterations,
        p: loc.paletteId,
        f: state.fractalType,
        n: loc.title,
        d: loc.duration || 30
    });
    const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    const shareText = getShareText(loc.title, shareUrl);
    const shareTextWithoutUrl = getShareTextWithoutUrl(loc.title);

    // Try Web Share API first (mobile)
    if (navigator.share) {
        navigator.share({
            title: loc.title,
            text: shareTextWithoutUrl,
            url: shareUrl
        }).catch(() => {
            // Fallback to clipboard
            navigator.clipboard.writeText(shareText).then(() => {
                showToast('Link copied to clipboard!');
            }).catch(() => {
                showToast('Could not share');
            });
        });
    } else {
        // Fallback to clipboard
        navigator.clipboard.writeText(shareText).then(() => {
            showToast('Link copied to clipboard!');
        }).catch(() => {
            showToast('Could not copy link');
        });
    }
}

function deleteLocation(locId) {
    if (confirm('Are you sure you want to delete this location?')) {
        const saved = JSON.parse(localStorage.getItem('fractonaut_saved_locations') || '[]');
        const filtered = saved.filter(loc => loc.id !== locId);
        localStorage.setItem('fractonaut_saved_locations', JSON.stringify(filtered));
        renderCatalogue();
        showToast('Location deleted');
    }
}

function startHypnoticJourney(loc) {
    const durationInput = document.getElementById('journeyDuration');
    const duration = loc.duration || parseFloat(durationInput.value) || 10;

    // Stop any existing animation first
    state.isAnimating = false;
    state.velocity = { x: 0, y: 0 };

    // 1. Reset to Home Zoom but Target Location (z = 1x means zoom level 3.0)
    state.zoomCenter = { x: loc.x, y: loc.y };
    state.zoomSize = 3.0; // z = 1x
    state.targetZoomCenter = { x: loc.x, y: loc.y };
    state.targetZoomSize = 3.0;

    // 2. Set Color & Detail
    state.paletteId = loc.paletteId;
    state.maxIterations = loc.iterations;

    // Update UI controls to match
    const iterationsEl = document.getElementById('iterations');
    const iterValueEl = document.getElementById('iterValue');
    if (iterationsEl) iterationsEl.value = loc.iterations;
    if (iterValueEl) iterValueEl.innerText = loc.iterations;
    document.querySelectorAll('.palette-card').forEach(c => c.classList.remove('active'));
    const paletteBtn = document.querySelector(`.palette-card[data-palette="${loc.paletteId}"]`);
    if (paletteBtn) paletteBtn.classList.add('active');

    // 3. Fade transition
    const canvas = document.getElementById('glCanvas');
    if (canvas) {
        canvas.classList.remove('canvas-fade', 'fade-in');
        canvas.classList.add('canvas-fade');
        setTimeout(() => {
            canvas.classList.add('fade-in');
        }, 50);
    }

    // 4. Animate Zoom Only
    state.isAnimating = true;
    const startTime = Date.now();
    const startSize = 3.0; // Start from z = 1x
    const targetSize = 3.0 / (loc.zoom || 1.0);

    function animate() {
        if (!state.isAnimating) return; // Safety check
        
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
            // Ensure final values are set exactly before ending animation
            state.targetZoomSize = targetSize;
            state.zoomSize = targetSize;
            state.targetZoomCenter.x = loc.x;
            state.targetZoomCenter.y = loc.y;
            state.zoomCenter.x = loc.x;
            state.zoomCenter.y = loc.y;
            
            // Use requestAnimationFrame to ensure drawScene processes final frame first
            requestAnimationFrame(() => {
                state.isAnimating = false;
                // Show share button popup after flythrough completes
                showShareButtonPopup(loc);
            });
        }
    }

    // Start animation on next frame to ensure state is set
    requestAnimationFrame(animate);

    // Close panel on all devices
    const panel = document.getElementById('controlPanel');
    if (panel) panel.classList.remove('visible');
    const toggle = document.getElementById('controlToggle');
    if (toggle) toggle.classList.remove('hidden');
}

function showShareButtonPopup(loc) {
    const popup = document.getElementById('shareButtonPopup');
    const shareBtn = document.getElementById('shareLocationBtn');
    
    // Generate share URL
    const zoom = loc.zoom || (3.0 / state.zoomSize);
    const params = new URLSearchParams({
        x: loc.x.toFixed(6),
        y: loc.y.toFixed(6),
        z: zoom.toFixed(2),
        i: loc.iterations,
        p: loc.paletteId,
        f: state.fractalType,
        n: loc.title,
        d: loc.duration || 30
    });
    const shareUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    const shareText = getShareText(loc.title, shareUrl);
    const shareTextWithoutUrl = getShareTextWithoutUrl(loc.title);
    const screenCtx = getScreenContext();

    // Clear any existing handlers
    shareBtn.onclick = null;

    // Show popup
    setTimeout(() => {
        popup.classList.add('show');
    }, 500);

    // Handle share button click
    shareBtn.onclick = () => {
        // Mobile: use Web Share API
        if (screenCtx.isMobile && navigator.share) {
            navigator.share({
                title: loc.title,
                text: shareTextWithoutUrl,
                url: shareUrl
            }).then(() => {
                popup.classList.remove('show');
            }).catch(() => {
                // Fallback to clipboard if share is cancelled
                navigator.clipboard.writeText(shareText).then(() => {
                    showToast('Link copied to clipboard!');
                    popup.classList.remove('show');
                }).catch(() => {
                    showToast('Could not share');
                });
            });
        } else {
            // Desktop: copy to clipboard
            navigator.clipboard.writeText(shareText).then(() => {
                showToast('Link copied to clipboard!');
                popup.classList.remove('show');
            }).catch(() => {
                showToast('Could not copy link');
            });
        }
    };

    // Auto-hide after 10 seconds
    setTimeout(() => {
        if (popup.classList.contains('show')) {
            popup.classList.remove('show');
        }
    }, 10000);
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

    // Apply smooth zoom limit at 0.5x (zoomSize = 6.0)
    const maxZoomSize = 6.0;
    if (state.targetZoomSize > maxZoomSize) {
        // Smooth resistance with subtle bounce
        const excess = state.targetZoomSize - maxZoomSize;
        const resistance = 1.0 / (1.0 + excess * 0.5);
        state.targetZoomSize = maxZoomSize + excess * resistance;
        
        // Snap center to (0.75, 0) when at limit
        state.targetZoomCenter.x = 0.75;
        state.targetZoomCenter.y = 0.0;
    } else {
        // Normal zoom behavior when not at limit
        state.targetZoomCenter.x = wx - uvx * state.targetZoomSize;
        state.targetZoomCenter.y = wy - uvy * state.targetZoomSize;
    }
}

// Mouse/Touch Interactions
canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    handleZoom(delta, e.clientX, e.clientY);
}, { passive: false });

// Circle Control Logic - Optimized for smoothness
function initCircleControl() {
    const circle = document.getElementById('circleControl');
    if (!circle) return;

    let circleRAF = null;
    let pendingCircleMove = null;
    let lastIterUpdate = 0;

    const handleStart = (x, y) => {
        state.circleDrag.active = true;
        state.circleDrag.startX = x;
        state.circleDrag.startY = y;
        state.circleDrag.startIter = state.maxIterations;
        state.circleDrag.maxDist = 0; // Track max movement for tap detection
        circle.classList.add('dragging');
    };

    const processCircleMove = () => {
        if (!pendingCircleMove) {
            circleRAF = null;
            return;
        }

        const { x, y } = pendingCircleMove;
        const dx = x - state.circleDrag.startX;
        const dy = y - state.circleDrag.startY;

        const dist = Math.sqrt(dx * dx + dy * dy);
        state.circleDrag.maxDist = Math.max(state.circleDrag.maxDist, dist);

        // Vertical Drag -> Zoom
        if (Math.abs(dy) > 10) {
            const screenCtx = getScreenContext();
            const sensitivity = screenCtx.isMobile ? 0.015 : 0.05;
            const zoomDelta = dy * sensitivity;
            handleZoom(zoomDelta);
        }

        // Horizontal Drag -> Detail (Iterations)
        const now = performance.now();
        if (Math.abs(dx) > 10 && (now - lastIterUpdate > 100)) {
            const iterDelta = Math.floor(dx * 2);
            let newIter = state.circleDrag.startIter + iterDelta;
            newIter = Math.max(50, Math.min(5000, newIter));

            if (state.maxIterations !== newIter) {
                state.maxIterations = newIter;
                lastIterUpdate = now;
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

        pendingCircleMove = null;
        circleRAF = null;
    };

    const handleMove = (x, y) => {
        if (!state.circleDrag.active) return;

        pendingCircleMove = { x, y };

        if (!circleRAF) {
            circleRAF = requestAnimationFrame(processCircleMove);
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

        // Cancel any pending RAF
        if (circleRAF) {
            cancelAnimationFrame(circleRAF);
            circleRAF = null;
            pendingCircleMove = null;
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
    const nameInput = document.getElementById('locationNameInput');
    const durationInput = document.getElementById('locationDurationInput');
    const cancelBtn = document.getElementById('cancelSaveBtn');
    const confirmBtn = document.getElementById('confirmSaveBtn');

    if (trigger) {
        trigger.addEventListener('click', () => {
            // Calculate suggested duration based on current zoom
            const currentZoom = 3.0 / state.zoomSize;
            const suggestedDuration = calculateDurationFromZoom(currentZoom);
            durationInput.value = suggestedDuration;

            // Set random name suggestion
            const randomName = nameSuggestions[Math.floor(Math.random() * nameSuggestions.length)];
            nameInput.value = randomName;
            nameInput.placeholder = randomName;

            // Show modal
            modal.classList.remove('hidden');
            
            // Focus on name input and open keyboard (mobile)
            setTimeout(() => {
                nameInput.focus();
                nameInput.select();
            }, 100);
        });
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
    }

    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            const name = nameInput.value.trim() || nameInput.placeholder || 'Untitled Scene';
            const duration = parseFloat(durationInput.value) || 30;
            saveScene(name, duration);
        });
    }

    // Check URL Params on Load
    const params = new URLSearchParams(window.location.search);
    if (params.has('x') && params.has('y') && params.has('z')) {
        // Show popup to add shared location
        showAddLocationModal(params);
    }
}

function showAddLocationModal(params) {
    const modal = document.getElementById('addLocationModal');
    const titleEl = document.getElementById('addLocationTitle');
    const cancelBtn = document.getElementById('cancelAddLocationBtn');
    const confirmBtn = document.getElementById('confirmAddLocationBtn');

    // Extract location data from URL
    const locationData = {
        x: parseFloat(params.get('x')),
        y: parseFloat(params.get('y')),
        z: parseFloat(params.get('z')),
        zoom: parseFloat(params.get('z')),
        iterations: parseInt(params.get('i')) || 500,
        paletteId: parseInt(params.get('p')) || 0,
        fractalType: parseInt(params.get('f')) || 0,
        name: params.get('n') || 'this location',
        duration: parseInt(params.get('d')) || 30
    };

    // Update title with location name
    titleEl.textContent = `Start the trip to ${locationData.name}?`;

    // Show modal
    modal.classList.remove('hidden');

    // Handle cancel
    cancelBtn.onclick = () => {
        modal.classList.add('hidden');
        // Clear URL params to prevent showing again on refresh
        window.history.replaceState({}, document.title, window.location.pathname);
    };

    // Handle confirm
    confirmBtn.onclick = () => {
        modal.classList.add('hidden');
        
        // Save location to localStorage
        const newLoc = {
            id: Date.now().toString(),
            title: locationData.name,
            description: `Duration: ${locationData.duration}s`,
            x: locationData.x,
            y: locationData.y,
            zoom: locationData.zoom,
            iterations: locationData.iterations,
            paletteId: locationData.paletteId,
            duration: locationData.duration
        };

        const saved = JSON.parse(localStorage.getItem('fractonaut_saved_locations') || '[]');
        saved.push(newLoc);
        localStorage.setItem('fractonaut_saved_locations', JSON.stringify(saved));

        // Set fractal type
        state.fractalType = locationData.fractalType;

        // Update fractal card UI to show correct fractal as active
        const fractalCards = document.querySelectorAll('.fractal-card');
        fractalCards.forEach(c => c.classList.remove('active'));
        const activeFractalCard = document.querySelector(`.fractal-card[data-type="${locationData.fractalType}"]`);
        if (activeFractalCard) {
            activeFractalCard.classList.add('active');
        }

        // Refresh catalogue
        renderCatalogue();

        // Set duration for flythrough
        const durationInput = document.getElementById('journeyDuration');
        if (durationInput) {
            durationInput.value = locationData.duration;
        }

        // Clear URL params first
        window.history.replaceState({}, document.title, window.location.pathname);

        // Small delay to ensure state is set, then start trip (flythrough)
        setTimeout(() => {
            startHypnoticJourney(newLoc);
        }, 100);
    };
}

// Name suggestions list
const nameSuggestions = [
    'The Elephant Saw Me',
    'The Three Arms',
    'Cosmic Spiral',
    'Rising Up',
    'Hello Jellyfish',
    'The Golden Valley',
    'Infinite Depths',
    'Stellar Whirlpool',
    'The Crystal Garden',
    'Nebula Dreams',
    'The Spiral Heart',
    'Cosmic Tendrils',
    'The Void\'s Edge',
    'Stardust Cascade',
    'The Fractal Crown',
    'Eternal Spiral',
    'The Deep Abyss',
    'Celestial Dance',
    'The Hidden Realm',
    'Mystic Vortex'
];

function calculateDurationFromZoom(zoom) {
    // Calculate smooth GPU-friendly duration based on zoom level
    // Formula ensures smooth 60fps animation with appropriate frame budget
    // 
    // Key principles:
    // 1. Minimum duration ensures smooth animation (enough frames at 60fps)
    // 2. Logarithmic scaling matches exponential nature of zoom
    // 3. Deeper zooms need more time for detail rendering
    // 4. Capped at reasonable maximum to avoid excessive wait times
    
    // Constants for smooth animation
    const TARGET_FPS = 60; // Standard GPU frame rate for smooth animation
    const MIN_DURATION = 4.0; // Minimum seconds for smooth shallow zoom (240 frames)
    const MAX_DURATION = 60.0; // Maximum seconds for very deep zooms (3600 frames)
    
    // Clamp zoom to reasonable range (1x to 100,000x)
    const clampedZoom = Math.max(1.0, Math.min(zoom, 100000.0));
    
    // Use logarithmic scaling since zoom is exponential
    // log10(zoom) converts exponential zoom to linear scale
    // Example: zoom 1x → log=0, zoom 10x → log=1, zoom 100x → log=2, zoom 1000x → log=3
    const logZoom = Math.log10(clampedZoom);
    
    // Normalize log zoom to 0-1 range
    // log10(1) = 0, log10(100000) ≈ 5
    const logMin = 0;
    const logMax = 5;
    const normalizedLog = Math.min(1.0, (logZoom - logMin) / (logMax - logMin));
    
    // Apply smooth easing curve for natural feel
    // Quadratic easing: slower start, faster end (feels more natural for deep zooms)
    const easedNormalized = normalizedLog * normalizedLog;
    
    // Calculate duration: linear interpolation between min and max
    // Formula: duration = MIN + (eased * (MAX - MIN))
    const duration = MIN_DURATION + (easedNormalized * (MAX_DURATION - MIN_DURATION));
    
    // Round to nearest 0.5 seconds for cleaner UI values
    return Math.round(duration * 2) / 2;
}

function showToast(message) {
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    toastMessage.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
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
        f: state.fractalType,
        n: name,
        d: duration
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

    // 4. Copy formatted text to Clipboard (silently, no toast)
    const shareText = getShareText(name, url);
    navigator.clipboard.writeText(shareText).catch(() => {
        // Silently fail if clipboard access is not available
    });

    // 5. Close modal and start flythrough
    const modal = document.getElementById('saveModal');
    modal.classList.add('hidden');

    // 6. Fade transition and start flythrough
    setTimeout(() => {
        startHypnoticJourney(newLoc);
    }, 300);
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

// Smooth RAF-throttled mouse move handler
window.addEventListener('mousemove', (e) => {
    if (!state.isDragging) return;

    // Store pending interaction data
    state.pendingInteraction = {
        type: 'mousemove',
        clientX: e.clientX,
        clientY: e.clientY
    };

    // Process interaction on next animation frame if not already scheduled
    if (!state.interactionRAF) {
        state.interactionRAF = requestAnimationFrame(() => {
            if (state.pendingInteraction && state.pendingInteraction.type === 'mousemove') {
                const dx = state.pendingInteraction.clientX - state.lastMouse.x;
                const dy = state.pendingInteraction.clientY - state.lastMouse.y;

                const scale = state.zoomSize / canvas.height;

                state.targetZoomCenter.x -= dx * scale;
                state.targetZoomCenter.y += dy * scale;

                state.velocity.x = dx * scale * 0.5;
                state.velocity.y = dy * scale * 0.5;

                state.lastMouse = { x: state.pendingInteraction.clientX, y: state.pendingInteraction.clientY };
            }
            state.pendingInteraction = null;
            state.interactionRAF = null;
        });
    }
}, { passive: true });

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

    // Store touch data for RAF processing
    const touchData = {
        type: 'touchmove',
        touches: Array.from(e.touches).map(t => ({ clientX: t.clientX, clientY: t.clientY })),
        isDragging: state.isDragging
    };

    state.pendingInteraction = touchData;

    // Process on next animation frame if not already scheduled
    if (!state.interactionRAF) {
        state.interactionRAF = requestAnimationFrame(() => {
            const data = state.pendingInteraction;
            if (!data || data.type !== 'touchmove') {
                state.pendingInteraction = null;
                state.interactionRAF = null;
                return;
            }

            const touches = data.touches;

            if (touches.length === 1 && data.isDragging) {
                const dx = touches[0].clientX - state.lastMouse.x;
                const dy = touches[0].clientY - state.lastMouse.y;

                const scale = state.zoomSize / canvas.height;

                state.targetZoomCenter.x -= dx * scale;
                state.targetZoomCenter.y += dy * scale;

                state.velocity.x = dx * scale * 2.0;
                state.velocity.y = dy * scale * 2.0;

                state.lastMouse = { x: touches[0].clientX, y: touches[0].clientY };
            } else if (touches.length === 2) {
                const dx = touches[0].clientX - touches[1].clientX;
                const dy = touches[0].clientY - touches[1].clientY;
                const distance = Math.sqrt(dx * dx + dy * dy);

                const centerX = (touches[0].clientX + touches[1].clientX) / 2;
                const centerY = (touches[0].clientY + touches[1].clientY) / 2;

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

                    // Apply smooth zoom limit at 0.5x (zoomSize = 6.0)
                    const maxZoomSize = 6.0;
                    if (state.targetZoomSize > maxZoomSize) {
                        // Smooth resistance with subtle bounce
                        const excess = state.targetZoomSize - maxZoomSize;
                        const resistance = 1.0 / (1.0 + excess * 0.5);
                        state.targetZoomSize = maxZoomSize + excess * resistance;
                        
                        // Snap center to (0.75, 0) when at limit
                        state.targetZoomCenter.x = 0.75;
                        state.targetZoomCenter.y = 0.0;
                    } else {
                        // Normal zoom behavior when not at limit
                        state.targetZoomCenter.x = wx - uvx * state.targetZoomSize;
                        state.targetZoomCenter.y = wy - uvy * state.targetZoomSize;
                    }
                }
                lastTouchDistance = distance;
            }

            state.pendingInteraction = null;
            state.interactionRAF = null;
        });
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

// Reset function (shared by both reset buttons)
function resetView() {
    state.velocity = { x: 0, y: 0 };
    
    // Randomly select palette (0-9, 10 palettes total)
    state.paletteId = Math.floor(Math.random() * 10);
    
    // Randomly select complexity based on fractal type
    if (state.fractalType === 2) { // Sierpinski
        state.targetZoomCenter = { x: 0.5, y: 0.288 };
        state.targetZoomSize = 1.5;
        // Sierpinski: random iterations between 150-400
        state.maxIterations = Math.floor(Math.random() * 250) + 150;
        // Round to nearest 50 for cleaner values
        state.maxIterations = Math.round(state.maxIterations / 50) * 50;
    } else if (state.fractalType === 1) { // Julia
        state.targetZoomCenter = { x: 0.0, y: 0.0 };
        state.targetZoomSize = 3.0;
        // Julia: random iterations between 300-1500
        state.maxIterations = Math.floor(Math.random() * 1200) + 300;
        // Round to nearest 50
        state.maxIterations = Math.round(state.maxIterations / 50) * 50;
    } else { // Mandelbrot
        state.targetZoomCenter = { x: -0.75, y: 0.0 };
        state.targetZoomSize = 3.0;
        // Mandelbrot: random iterations between 300-2000
        state.maxIterations = Math.floor(Math.random() * 1700) + 300;
        // Round to nearest 50
        state.maxIterations = Math.round(state.maxIterations / 50) * 50;
    }

    state.zoomCenter = { ...state.targetZoomCenter };
    state.zoomSize = state.targetZoomSize;

    // Reset UI controls with random values
    const iterationsEl = document.getElementById('iterations');
    const iterValueEl = document.getElementById('iterValue');
    if (iterationsEl) iterationsEl.value = state.maxIterations;
    if (iterValueEl) iterValueEl.innerText = state.maxIterations;
    
    // Update palette UI to show random selection
    document.querySelectorAll('.palette-card').forEach(c => c.classList.remove('active'));
    const selectedPaletteBtn = document.querySelector(`.palette-card[data-palette="${state.paletteId}"]`);
    if (selectedPaletteBtn) {
        selectedPaletteBtn.classList.add('active');
    }
}

// Quick Actions
const resetBtn = document.getElementById('resetBtn');
if (resetBtn) {
    resetBtn.addEventListener('click', resetView);
}

// Joystick side reset button
const resetButton = document.getElementById('resetButton');
if (resetButton) {
    resetButton.addEventListener('click', resetView);
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

// Show tutorial on first visit (all devices)
if (!state.tutorialShown) {
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

// Check if app is currently installed (standalone mode)
function isAppInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true ||
        document.referrer.includes('android-app://');
}

// Check if prompt was dismissed in this session
function wasPromptDismissed() {
    return sessionStorage.getItem('pwa_prompt_dismissed') === 'true';
}

// Mark prompt as dismissed (session only)
function dismissPrompt() {
    sessionStorage.setItem('pwa_prompt_dismissed', 'true');
    pwaPrompt.classList.add('hidden');
}

// Mark app as installed (persistent)
function markAppInstalled() {
    localStorage.setItem('pwa_installed', 'true');
    pwaPrompt.classList.add('hidden');
    deferredPrompt = null;
}

// Check if app was previously installed but is now uninstalled
function wasAppUninstalled() {
    const wasInstalled = localStorage.getItem('pwa_installed') === 'true';
    const isCurrentlyInstalled = isAppInstalled();
    
    // If it was installed but is no longer in standalone mode, it was uninstalled
    if (wasInstalled && !isCurrentlyInstalled) {
        // Clear the installed flag so we can show prompt again
        localStorage.removeItem('pwa_installed');
        return true;
    }
    
    return false;
}

// Check if we should show the prompt
function shouldShowPrompt() {
    // Don't show if currently installed
    if (isAppInstalled()) {
        return false;
    }
    // Don't show if dismissed in this session
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
    // Show the install prompt (happens in background)
    deferredPrompt.prompt();
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to the install prompt: ${outcome}`);
    // We've used the prompt, and can't use it again, throw it away
    deferredPrompt = null;
    // Hide our custom UI
    pwaPrompt.classList.add('hidden');
    // Mark as dismissed if user declined (session only), or mark as installed if accepted
    if (outcome === 'dismissed') {
        dismissPrompt();
    } else if (outcome === 'accepted') {
        // User accepted, app will be installed - mark it
        markAppInstalled();
    }
});

closePwaBtn.addEventListener('click', () => {
    dismissPrompt();
});

window.addEventListener('appinstalled', () => {
    // Hide the app-provided install promotion
    pwaPrompt.classList.add('hidden');
    deferredPrompt = null;
    // Mark as installed so prompt never shows again (until uninstalled)
    markAppInstalled();
    console.log('PWA was installed');
});

// Check on load if we should show/hide the prompt
// Detect if app was uninstalled
if (wasAppUninstalled()) {
    console.log('PWA was uninstalled, prompt will show again next session');
}

// Hide prompt if currently installed or dismissed in this session
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

// --- Service Worker Registration (PWA Update Check) ---
if ('serviceWorker' in navigator) {
    // Register service worker and check for updates on every launch
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
            .then((registration) => {
                console.log('Service Worker registered');

                // Check for updates on every launch
                registration.update();

                // Listen for updates
                registration.addEventListener('updatefound', () => {
                    const newWorker = registration.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                // New service worker available, reload to get fresh content
                                if (navigator.onLine) {
                                    window.location.reload();
                                }
                            }
                        });
                    }
                });

                // Check for updates periodically (every 5 minutes)
                setInterval(() => {
                    if (navigator.onLine) {
                        registration.update();
                    }
                }, 5 * 60 * 1000);
            })
            .catch((error) => {
                console.log('Service Worker registration failed:', error);
            });

        // Handle controller change (when new service worker takes control)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (navigator.onLine) {
                window.location.reload();
            }
        });
    });
}
