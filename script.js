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

        if (u_highPrecision) {
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
                    // Calculate log_zn for smoothing
                    // |z|^2 = z_x2.x + z_y2.x (approx for high precision)
                    log_zn = log(z_x2.x + z_y2.x) / 2.0;
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
            vec2 c = vec2(u_zoomCenter_x.x, u_zoomCenter_y.x) + uv * u_zoomSize.x;
            
            float p = sqrt((c.x - 0.25) * (c.x - 0.25) + c.y * c.y);
            if (c.x < p - 2.0 * p * p + 0.25) {
                iterations = float(u_maxIterations);
            } else if ((c.x + 1.0) * (c.x + 1.0) + c.y * c.y < 0.0625) {
                iterations = float(u_maxIterations);
            } else {
                vec2 z = vec2(0.0);
                for (int i = 0; i < 10000; i++) {
                    if (i >= u_maxIterations) break;
                    
                    float x = (z.x * z.x - z.y * z.y) + c.x;
                    float y = (2.0 * z.x * z.y) + c.y;
                    
                    if (x * x + y * y > 4.0) {
                        escaped = true;
                        iterations = float(i);
                        log_zn = log(x * x + y * y) / 2.0;
                        break;
                    }
                    z.x = x;
                    z.y = y;
                }
            }
        }

        if (escaped) {
            // Continuous iteration count smoothing
            // nu = log2(log2(|z|)) / log2(2)
            // log_zn is already log(|z|) = log(|z|^2)/2
            float nu = log(log_zn / log(2.0)) / log(2.0);
            
            // Smooth iteration count
            float smooth_i = iterations + 1.0 - nu;
            
            // Normalize t for palette lookup
            float t = smooth_i / float(u_maxIterations);
            
            // Add a slight offset to t for animation/cycling if desired, 
            // but for now just use the smooth value
            
            vec3 color = vec3(0.0);

            if (u_paletteId == 0) {
                // Ocean - adjusted for smooth t
                color = palette(t * 10.0, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.00, 0.10, 0.20));
            } else if (u_paletteId == 1) {
                // Magma
                color = palette(t * 10.0, vec3(0.5), vec3(0.5), vec3(1.0, 1.0, 0.5), vec3(0.8, 0.9, 0.3));
                color = mix(vec3(0.1, 0.0, 0.0), color, sin(t * 20.0) * 0.5 + 0.5);
            } else if (u_paletteId == 2) {
                // Aurora
                color = palette(t * 15.0, vec3(0.5), vec3(0.5), vec3(2.0, 1.0, 0.0), vec3(0.5, 0.20, 0.25));
            } else if (u_paletteId == 3) {
                // Amber
                color = palette(t * 8.0, vec3(0.8, 0.5, 0.4), vec3(0.2, 0.4, 0.2), vec3(2.0, 1.0, 1.0), vec3(0.00, 0.25, 0.25));
            } else {
                // Texture palette (Extreme)
                // Use smooth_i for cycle
                float cycle = mod(smooth_i, 512.0) / 512.0;
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
    panelVisible: false,
    tourActive: false,
    tourStep: 0,
    lastStatsUpdate: 0,
    statsUpdateInterval: 100,
    autoHideTimer: null,
    tutorialShown: localStorage.getItem('mandelbrot_tutorial_shown') === 'true'
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

    gl.uniform2f(programInfo.uniformLocations.zoomCenterX, centerXSplit[0], centerXSplit[1]);
    gl.uniform2f(programInfo.uniformLocations.zoomCenterY, centerYSplit[0], centerYSplit[1]);
    gl.uniform2f(programInfo.uniformLocations.zoomSize, zoomSizeSplit[0], zoomSizeSplit[1]);

    gl.uniform1i(programInfo.uniformLocations.maxIterations, state.maxIterations);
    gl.uniform1i(programInfo.uniformLocations.paletteId, state.paletteId);

    const highPrecision = state.zoomSize < 0.001;
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

    document.getElementById('coordX').innerText = state.zoomCenter.x.toFixed(5);
    document.getElementById('coordY').innerText = state.zoomCenter.y.toFixed(5);
    document.getElementById('zoomLevel').innerText = `${(3.0 / state.zoomSize).toFixed(1)}×`;
}

function updateLocationInfo(locationKey) {
    const loc = locations[locationKey];
    if (!loc) return;

    document.getElementById('locationTitle').innerText = loc.title;
    document.getElementById('locationDescription').innerText = loc.description;

    const infoPanel = document.getElementById('locationInfo');
    infoPanel.classList.add('visible');

    setTimeout(() => {
        infoPanel.classList.remove('visible');
    }, 4000);
}

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

document.getElementById('controlToggle').addEventListener('click', () => {
    togglePanel();
});

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

document.getElementById('locationSelect').addEventListener('change', (e) => {
    const loc = locations[e.target.value];
    if (loc) {
        state.isAnimating = true;
        state.velocity = { x: 0, y: 0 };

        state.targetZoomCenter = { x: loc.x, y: loc.y };
        state.targetZoomSize = loc.size;

        updateLocationInfo(e.target.value);

        setTimeout(() => { state.isAnimating = false; }, 1000);
    }
});

document.getElementById('resetBtn').addEventListener('click', () => {
    state.targetZoomCenter = { x: -0.75, y: 0.0 };
    state.targetZoomSize = 3.0;
    state.velocity = { x: 0, y: 0 };
    document.getElementById('locationSelect').value = 'default';
    updateLocationInfo('default');
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
            console.error(`Fullscreen error: ${err.message}`);
        });
        document.getElementById('fullscreenLabel').innerText = 'Exit';
    } else {
        document.exitFullscreen();
        document.getElementById('fullscreenLabel').innerText = 'Full';
    }
}

// Zoom buttons
let zoomInterval = null;

function startZoom(direction) {
    handleZoom(direction);
    zoomInterval = setInterval(() => {
        handleZoom(direction);
    }, 50);
}

function stopZoom() {
    if (zoomInterval) {
        clearInterval(zoomInterval);
        zoomInterval = null;
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

// Keyboard shortcuts (desktop only)
document.addEventListener('keydown', (e) => {
    const screenCtx = getScreenContext();
    if (screenCtx.isMobile) return; // Disable keyboard shortcuts on mobile

    switch (e.key.toLowerCase()) {
        case 'c':
            togglePanel();
            break;
        case 'r':
        case 't':
            document.getElementById('autoTourBtn').click();
            break;
        case 'escape':
            togglePanel(false);
            break;
    }
});

// Auto Tour
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
    updateLocationInfo(locationKey);

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
updateLocationInfo('default');

// Start rendering
requestAnimationFrame(drawScene);
