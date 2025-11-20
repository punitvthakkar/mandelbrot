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
    uniform bool u_highPrecision; // Toggle for optimization
    uniform sampler2D u_paletteTexture; // For Fractal Extreme mode

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

    vec2 ds_set(float a) {
        return vec2(a, 0.0);
    }

    vec3 palette( float t, vec3 a, vec3 b, vec3 c, vec3 d ) {
        return a + b*cos( 6.28318*(c*t+d) );
    }

    void main() {
        vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution.xy) / u_resolution.y;
        
        // --- Cardioid & Bulb Check (Optimization) ---
        // Only works roughly if we are zoomed out, but good for general speedup
        // We'll skip this for simplicity in deep zoom as it might cause artifacts if not precise
        
        float iterations = 0.0;
        bool escaped = false;

        if (u_highPrecision) {
             // --- HIGH PRECISION MODE (Double Emulation) ---
            vec2 uv_x_ds = vec2(uv.x, 0.0);
            vec2 uv_y_ds = vec2(uv.y, 0.0);

            vec2 c_x = ds_add(u_zoomCenter_x, ds_mul(uv_x_ds, u_zoomSize));
            vec2 c_y = ds_add(u_zoomCenter_y, ds_mul(uv_y_ds, u_zoomSize));

            vec2 z_x = vec2(0.0);
            vec2 z_y = vec2(0.0);
            
            for (int i = 0; i < 10000; i++) {
                if (i >= u_maxIterations) break;
                
                vec2 z_x2 = ds_mul(z_x, z_x);
                vec2 z_y2 = ds_mul(z_y, z_y);
                
                if (z_x2.x + z_y2.x > 4.0) {
                    escaped = true;
                    iterations = float(i);
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
            // --- LOW PRECISION MODE (Standard Float) ---
            // Much faster!
            vec2 c = vec2(u_zoomCenter_x.x, u_zoomCenter_y.x) + uv * u_zoomSize.x;
            
            // Cardioid Check
            float p = sqrt((c.x - 0.25) * (c.x - 0.25) + c.y * c.y);
            if (c.x < p - 2.0 * p * p + 0.25) {
                iterations = float(u_maxIterations); // Inside
            } else if ((c.x + 1.0) * (c.x + 1.0) + c.y * c.y < 0.0625) {
                iterations = float(u_maxIterations); // Inside bulb
            } else {
                vec2 z = vec2(0.0);
                for (int i = 0; i < 10000; i++) {
                    if (i >= u_maxIterations) break;
                    
                    float x = (z.x * z.x - z.y * z.y) + c.x;
                    float y = (2.0 * z.x * z.y) + c.y;
                    
                    if (x * x + y * y > 4.0) {
                        escaped = true;
                        iterations = float(i);
                        break;
                    }
                    z.x = x;
                    z.y = y;
                }
            }
        }

        if (escaped) {
            // Smooth coloring
            // float sl = iterations - log2(log2(dot(z,z))) + 4.0; // Requires z from loop, tricky with branching
            // Simple linear smoothing for now to match both modes
            float t = iterations / float(u_maxIterations);
            
            vec3 color = vec3(0.0);

            if (u_paletteId == 0) {
                // Electric Blue (Refined)
                color = palette(t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.00, 0.10, 0.20));
            } else if (u_paletteId == 1) {
                // Fire & Ice (Refined)
                color = palette(t, vec3(0.5), vec3(0.5), vec3(1.0, 1.0, 0.5), vec3(0.8, 0.9, 0.3));
                color = mix(vec3(0.1, 0.0, 0.0), color, t);
            } else if (u_paletteId == 2) {
                // Neon Night (Refined)
                color = palette(t, vec3(0.5), vec3(0.5), vec3(2.0, 1.0, 0.0), vec3(0.5, 0.20, 0.25));
            } else if (u_paletteId == 3) {
                // Golden Hour (Refined)
                color = palette(t, vec3(0.8, 0.5, 0.4), vec3(0.2, 0.4, 0.2), vec3(2.0, 1.0, 1.0), vec3(0.00, 0.25, 0.25));
            } else {
                // Fractal Extreme (Texture)
                // Sample texture with smooth, gradual color progression
                // Use a longer cycle for more gradual color transitions
                float cycle = mod(iterations, 512.0) / 512.0;
                color = texture2D(u_paletteTexture, vec2(cycle, 0.5)).rgb;
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

// State
let state = {
    zoomCenter: { x: -0.75, y: 0.0 },
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
    drawerCollapsed: window.innerWidth < 768, // Collapsed by default on mobile
    onboardingStep: 0,
    onboardingVisible: true,
    tourActive: false,
    tourStep: 0,
    lastStatsUpdate: 0,
    statsUpdateInterval: 100,
    lastUniformValues: {}
};

const locations = {
    default: {
        x: -0.75, y: 0.0, size: 3.0,
        title: 'Home View',
        description: 'The complete Mandelbrot set in its iconic form'
    },
    seahorse: {
        x: -0.748, y: 0.1, size: 0.01,
        title: 'Seahorse Valley',
        description: 'Delicate tendrils spiral into intricate seahorse-like patterns'
    },
    elephant: {
        x: 0.275, y: 0.0, size: 0.01,
        title: 'Elephant Valley',
        description: 'Bulbous spirals reminiscent of elephant trunks'
    },
    spiral: {
        x: -0.088, y: 0.654, size: 0.005,
        title: 'Triple Spiral',
        description: 'A hypnotic vortex of three intertwined spirals'
    },
    minibrot: {
        x: -1.75, y: 0.0, size: 0.1,
        title: 'Mini Mandelbrot',
        description: 'A perfect miniature copy of the full set—fractal self-similarity'
    }
};

const onboardingSteps = [
    {
        title: 'Welcome!',
        text: 'Explore the infinite beauty of the Mandelbrot set. Drag to pan around the fractal.'
    },
    {
        title: 'Zoom In',
        text: 'Scroll your mouse wheel or use the zoom buttons to dive deeper into the fractal.'
    },
    {
        title: 'Double-Click',
        text: 'Double-click anywhere to zoom toward that point for precise exploration.'
    },
    {
        title: 'Keyboard Shortcuts',
        text: 'Press H for help, R to reset, F for fullscreen. Check the bottom for more shortcuts!'
    },
    {
        title: 'Ready to Explore!',
        text: 'Try the location presets or take the auto-tour. Enjoy your journey!'
    }
];

// Shader Program Setup
function loadShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        console.error('Shader compilation error:', info);
        console.error('Shader type:', type === gl.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT');
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
        const info = gl.getProgramInfoLog(shaderProgram);
        console.error('Shader program linking error:', info);
        return null;
    }

    console.log('Shaders compiled and linked successfully');
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
    },
} : null;

// --- Texture Palette Generation ---
function generateFractalExtremePalette() {
    // Create a beautiful, smooth gradient using curated color stops
    // This creates a rich, vibrant palette without harsh transitions
    const colorStops = [
        { pos: 0.00, r: 0, g: 0, b: 0 },           // Deep black
        { pos: 0.05, r: 25, g: 7, b: 26 },         // Deep purple
        { pos: 0.10, r: 9, g: 1, b: 47 },          // Deep blue
        { pos: 0.15, r: 4, g: 4, b: 73 },          // Dark blue
        { pos: 0.20, r: 0, g: 7, b: 100 },         // Ocean blue
        { pos: 0.25, r: 12, g: 44, b: 138 },       // Rich blue
        { pos: 0.30, r: 24, g: 82, b: 177 },       // Sky blue
        { pos: 0.35, r: 57, g: 125, b: 209 },      // Bright blue
        { pos: 0.40, r: 134, g: 181, b: 229 },     // Light blue
        { pos: 0.45, r: 211, g: 236, b: 248 },     // Pale blue
        { pos: 0.50, r: 241, g: 233, b: 191 },     // Soft yellow
        { pos: 0.55, r: 248, g: 201, b: 95 },      // Golden
        { pos: 0.60, r: 255, g: 170, b: 0 },       // Orange
        { pos: 0.65, r: 240, g: 126, b: 13 },      // Deep orange
        { pos: 0.70, r: 204, g: 71, b: 10 },       // Red-orange
        { pos: 0.75, r: 158, g: 1, b: 66 },        // Deep red
        { pos: 0.80, r: 110, g: 0, b: 95 },        // Purple-red
        { pos: 0.85, r: 106, g: 0, b: 168 },       // Purple
        { pos: 0.90, r: 77, g: 16, b: 140 },       // Deep purple
        { pos: 0.95, r: 45, g: 20, b: 80 },        // Dark purple
        { pos: 1.00, r: 0, g: 0, b: 0 }            // Back to black
    ];

    // Create a 2048-pixel texture for super smooth gradients
    const textureSize = 2048;
    const textureData = new Uint8Array(textureSize * 4);

    for (let i = 0; i < textureSize; i++) {
        const t = i / (textureSize - 1);

        // Find the two color stops to interpolate between
        let lower = colorStops[0];
        let upper = colorStops[colorStops.length - 1];

        for (let j = 0; j < colorStops.length - 1; j++) {
            if (t >= colorStops[j].pos && t <= colorStops[j + 1].pos) {
                lower = colorStops[j];
                upper = colorStops[j + 1];
                break;
            }
        }

        // Smooth interpolation between color stops
        const localT = (t - lower.pos) / (upper.pos - lower.pos);
        const smoothT = localT * localT * (3 - 2 * localT); // Smoothstep

        textureData[i * 4 + 0] = Math.round(lower.r + (upper.r - lower.r) * smoothT);
        textureData[i * 4 + 1] = Math.round(lower.g + (upper.g - lower.g) * smoothT);
        textureData[i * 4 + 2] = Math.round(lower.b + (upper.b - lower.b) * smoothT);
        textureData[i * 4 + 3] = 255; // Alpha
    }

    return textureData;
}

// Create and upload texture
const paletteTexture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
const textureData = generateFractalExtremePalette();
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2048, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, textureData);

// Texture parameters
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

// Helper to split double into two floats
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

// Time for animation
let lastTime = 0;

// Rendering
function drawScene(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const deltaTime = (timestamp - lastTime) / 1000; // Seconds
    lastTime = timestamp;

    // Inertia / Momentum (Time-based)
    if (!state.isDragging && !state.isAnimating) {
        state.targetZoomCenter.x -= state.velocity.x * deltaTime * 60; // Normalize to ~60fps scale
        state.targetZoomCenter.y -= state.velocity.y * deltaTime * 60;

        state.velocity.x *= Math.pow(state.friction, deltaTime * 60);
        state.velocity.y *= Math.pow(state.friction, deltaTime * 60);

        if (Math.abs(state.velocity.x) < 1e-9 && Math.abs(state.velocity.y) < 1e-9) {
            state.velocity = { x: 0, y: 0 };
        }
    }

    // Smooth interpolation (Time-based)
    const lerpFactor = 1.0 - Math.pow(0.1, deltaTime * 10); // Tuned for smoothness

    state.zoomSize += (state.targetZoomSize - state.zoomSize) * lerpFactor;
    state.zoomCenter.x += (state.targetZoomCenter.x - state.zoomCenter.x) * lerpFactor;
    state.zoomCenter.y += (state.targetZoomCenter.y - state.zoomCenter.y) * lerpFactor;

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

    // Assuming zoomSizeKey was meant to be a unique identifier for the current view state
    // For continuous animation, we always update uniforms and draw.
    // The original code's `if (state.lastUniformValues.zoomSize !== zoomSizeKey)`
    // was likely an optimization attempt, but moving drawArrays inside it would halt animation.
    // We'll apply the uniform updates directly.

    gl.uniform2f(programInfo.uniformLocations.zoomCenterX, centerXSplit[0], centerXSplit[1]);
    gl.uniform2f(programInfo.uniformLocations.zoomCenterY, centerYSplit[0], centerYSplit[1]);
    gl.uniform2f(programInfo.uniformLocations.zoomSize, zoomSizeSplit[0], zoomSizeSplit[1]);

    gl.uniform1i(programInfo.uniformLocations.maxIterations, state.maxIterations);
    gl.uniform1i(programInfo.uniformLocations.paletteId, state.paletteId);

    // Dynamic Precision Switch
    // Standard float has ~7 decimal digits. If zoomSize < 0.001, we need double.
    const highPrecision = state.zoomSize < 0.001;
    gl.uniform1i(programInfo.uniformLocations.highPrecision, highPrecision ? 1 : 0);

    // Bind Texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, paletteTexture);
    gl.uniform1i(programInfo.uniformLocations.paletteTexture, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    updateStats();
    requestAnimationFrame(drawScene);
}

document.addEventListener('visibilitychange', () => {
    isPageVisible = !document.hidden;
    if (isPageVisible && !animationFrameId) {
        animationFrameId = requestAnimationFrame(drawScene);
    }
});

function resizeCanvasToDisplaySize(canvas) {
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;
    if (canvas.width !== displayWidth ||
        canvas.height !== displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
    }
}

function updateStats() {
    const now = Date.now();
    if (now - state.lastStatsUpdate < state.statsUpdateInterval) return;
    state.lastStatsUpdate = now;

    document.getElementById('coordX').innerText = state.zoomCenter.x.toFixed(5);
    document.getElementById('coordY').innerText = state.zoomCenter.y.toFixed(5);
    document.getElementById('zoomLevel').innerText = `${(3.0 / state.zoomSize).toFixed(1)}×`;
}

function updateLocationStory(locationKey) {
    const loc = locations[locationKey];
    if (!loc) return;

    document.getElementById('storyTitle').innerText = loc.title;
    document.getElementById('storyDescription').innerText = loc.description;
    document.getElementById('storyCoords').innerText = `Center: ${loc.x.toFixed(3)}, ${loc.y.toFixed(2)}`;
    document.getElementById('storyZoom').innerText = `Zoom: ${(3.0 / loc.size).toFixed(1)}×`;

    const storyPanel = document.getElementById('locationStory');
    storyPanel.classList.add('visible');

    setTimeout(() => {
        storyPanel.classList.remove('visible');
    }, 5000);
}

function updateLegendGradient() {
    const gradients = [
        'linear-gradient(90deg, #001133 0%, #006699 50%, #eef 100%)',
        'linear-gradient(90deg, #220011 0%, #cc4400 40%, #ffeeaa 100%)',
        'linear-gradient(90deg, #002211 0%, #00aa88 50%, #ccffdd 100%)',
        'linear-gradient(90deg, #331100 0%, #cc8822 50%, #ffeedd 100%)'
    ];
    document.getElementById('legendGradient').style.background = gradients[state.paletteId];
}

function handleZoom(delta, x, y) {
    // Dynamic zoom factor: slows down as you zoom in (size decreases)
    // At size 3.0 (start): factor ~ 1.2
    // At size 0.00003 (limit): factor ~ 1.006
    const zoomFactor = 1.0 + 0.15 * Math.pow(state.targetZoomSize, 0.3);

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

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = Math.sign(e.deltaY);
    handleZoom(delta, e.clientX, e.clientY);
    showZoomFocusRing(e.clientX, e.clientY);
}, { passive: false });

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
        showZoomFocusRing(e.clientX, e.clientY);
        lastClickTime = 0;
    } else {
        lastClickTime = now;
        lastClickPos = { x: e.clientX, y: e.clientY };
    }
});

function showZoomFocusRing(x, y) {
    const ring = document.getElementById('zoomFocusRing');
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    ring.classList.remove('fade-out');
    ring.classList.add('active');

    setTimeout(() => {
        ring.classList.remove('active');
        ring.classList.add('fade-out');
    }, 400);

    setTimeout(() => {
        ring.classList.remove('fade-out');
    }, 800);
}

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

let lastTouchDistance = 0;

canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
        state.isDragging = true;
        state.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
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

        state.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

        if (lastTouchDistance > 0) {
            const delta = lastTouchDistance - distance;
            // Much more natural zoom speed for mobile
            handleZoom(delta * 0.05, centerX, centerY);
        }
        lastTouchDistance = distance;
    }
}, { passive: false });

document.getElementById('drawerToggle').addEventListener('click', () => {
    state.drawerCollapsed = !state.drawerCollapsed;
    document.getElementById('controlDrawer').classList.toggle('collapsed', state.drawerCollapsed);
});

document.getElementById('iterations').addEventListener('input', (e) => {
    state.maxIterations = parseInt(e.target.value);
    document.getElementById('iterValue').innerText = state.maxIterations;
});

document.querySelectorAll('.palette-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        state.paletteId = parseInt(e.currentTarget.dataset.palette);
        updateLegendGradient();
    });
});

document.getElementById('locationSelect').addEventListener('change', (e) => {
    const loc = locations[e.target.value];
    if (loc) {
        state.isAnimating = true;
        state.velocity = { x: 0, y: 0 };

        state.targetZoomCenter = { x: loc.x, y: loc.y };
        state.targetZoomSize = loc.size;

        updateLocationStory(e.target.value);

        setTimeout(() => { state.isAnimating = false; }, 1000);
    }
});

document.getElementById('resetBtn').addEventListener('click', () => {
    state.targetZoomCenter = { x: -0.75, y: 0.0 };
    state.targetZoomSize = 3.0;
    state.velocity = { x: 0, y: 0 };
    document.getElementById('locationSelect').value = 'default';
    updateLocationStory('default');
});

document.getElementById('screenshotBtn').addEventListener('click', () => {
    const link = document.createElement('a');
    link.download = `mandelbrot-${Date.now()}.png`;
    link.href = canvas.toDataURL();
    link.click();
});

document.getElementById('fullscreenBtn').addEventListener('click', () => {
    toggleFullscreen();
});

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.body.requestFullscreen().catch(err => {
            console.error(`Error attempting to enable fullscreen: ${err.message}`);
        });
        document.getElementById('fullscreenLabel').innerText = 'Exit';
    } else {
        document.exitFullscreen();
        document.getElementById('fullscreenLabel').innerText = 'Full';
    }
}

let zoomInterval = null;
let zoomAcceleration = 1;

function startZoom(direction) {
    zoomAcceleration = 1;
    handleZoom(direction);
    zoomInterval = setInterval(() => {
        zoomAcceleration = Math.min(zoomAcceleration * 1.05, 3);
        for (let i = 0; i < zoomAcceleration; i++) {
            handleZoom(direction);
        }
    }, 50);
}

function stopZoom() {
    if (zoomInterval) {
        clearInterval(zoomInterval);
        zoomInterval = null;
        zoomAcceleration = 1;
    }
}

document.getElementById('zoomInBtn').addEventListener('mousedown', () => startZoom(-1));
document.getElementById('zoomInBtn').addEventListener('mouseup', stopZoom);
document.getElementById('zoomInBtn').addEventListener('mouseleave', stopZoom);
document.getElementById('zoomInBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    startZoom(-1);
});
document.getElementById('zoomInBtn').addEventListener('touchend', stopZoom);

document.getElementById('zoomOutBtn').addEventListener('mousedown', () => startZoom(1));
document.getElementById('zoomOutBtn').addEventListener('mouseup', stopZoom);
document.getElementById('zoomOutBtn').addEventListener('mouseleave', stopZoom);
document.getElementById('zoomOutBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    startZoom(1);
});
document.getElementById('zoomOutBtn').addEventListener('touchend', stopZoom);

document.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
        case 'h':
            toggleOnboarding();
            break;
        case 'r':
            document.getElementById('resetBtn').click();
            break;
        case 'f':
            toggleFullscreen();
            break;
        case 't':
            document.getElementById('autoTourBtn').click();
            break;
        case 'escape':
            if (state.onboardingVisible) {
                closeOnboarding();
            }
            if (state.tourActive) {
                stopTour();
            }
            break;
        case '+':
        case '=':
            handleZoom(-1);
            break;
        case '-':
        case '_':
            handleZoom(1);
            break;
    }
});

function initOnboarding() {
    const tooltip = document.getElementById('onboardingTooltip');
    const dotsContainer = document.getElementById('tooltipDots');

    onboardingSteps.forEach((_, i) => {
        const dot = document.createElement('span');
        dot.className = 'tooltip-dot';
        if (i === 0) dot.classList.add('active');
        dotsContainer.appendChild(dot);
    });

    updateOnboardingStep(0);

    setTimeout(() => {
        tooltip.classList.add('visible');
    }, 1000);
}

function updateOnboardingStep(step) {
    state.onboardingStep = step;
    const stepData = onboardingSteps[step];

    document.getElementById('tooltipTitle').innerText = stepData.title;
    document.getElementById('tooltipText').innerText = stepData.text;

    document.querySelectorAll('.tooltip-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === step);
    });

    document.getElementById('tooltipPrev').disabled = step === 0;
    document.getElementById('tooltipNext').disabled = step === onboardingSteps.length - 1;
}

function toggleOnboarding() {
    state.onboardingVisible = !state.onboardingVisible;
    const tooltip = document.getElementById('onboardingTooltip');
    tooltip.classList.toggle('visible', state.onboardingVisible);
}

function closeOnboarding() {
    state.onboardingVisible = false;
    document.getElementById('onboardingTooltip').classList.remove('visible');
}

document.getElementById('tooltipClose').addEventListener('click', closeOnboarding);

document.getElementById('tooltipPrev').addEventListener('click', () => {
    if (state.onboardingStep > 0) {
        updateOnboardingStep(state.onboardingStep - 1);
    }
});

document.getElementById('tooltipNext').addEventListener('click', () => {
    if (state.onboardingStep < onboardingSteps.length - 1) {
        updateOnboardingStep(state.onboardingStep + 1);
    } else {
        closeOnboarding();
    }
});

const tourLocations = ['default', 'seahorse', 'elephant', 'spiral', 'minibrot'];
let tourTimeout = null;

function startTour() {
    state.tourActive = true;
    state.tourStep = 0;
    document.getElementById('tourLabel').innerText = 'Stop';
    document.getElementById('autoTourBtn').classList.add('active');
    tourNextLocation();
}

function stopTour() {
    state.tourActive = false;
    document.getElementById('tourLabel').innerText = 'Tour';
    document.getElementById('autoTourBtn').classList.remove('active');
    if (tourTimeout) {
        clearTimeout(tourTimeout);
        tourTimeout = null;
    }
}

function tourNextLocation() {
    if (!state.tourActive) return;

    const locationKey = tourLocations[state.tourStep];
    const loc = locations[locationKey];

    state.isAnimating = true;
    state.velocity = { x: 0, y: 0 };
    state.targetZoomCenter = { x: loc.x, y: loc.y };
    state.targetZoomSize = loc.size;

    document.getElementById('locationSelect').value = locationKey;
    updateLocationStory(locationKey);

    state.tourStep = (state.tourStep + 1) % tourLocations.length;

    tourTimeout = setTimeout(() => {
        state.isAnimating = false;
        tourTimeout = setTimeout(tourNextLocation, 3000);
    }, 2000);
}

document.getElementById('autoTourBtn').addEventListener('click', () => {
    if (state.tourActive) {
        stopTour();
    } else {
        startTour();
    }
});

let resizeTimeout = null;
window.addEventListener('resize', () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        resizeCanvasToDisplaySize(canvas);
    }, 150);
});

updateLegendGradient();
updateLocationStory('default');
initOnboarding();

// Apply drawer state for mobile
if (state.drawerCollapsed) {
    document.getElementById('controlDrawer').classList.add('collapsed');
}

animationFrameId = requestAnimationFrame(drawScene);
