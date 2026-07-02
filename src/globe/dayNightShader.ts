export const dayNightVertex = /* glsl */`
  varying vec3 vNormal; varying vec2 vUv;
  void main(){ vNormal = normalize(normalMatrix * normal); vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

export const dayNightFragment = /* glsl */`
  #define PI 3.141592653589793
  uniform sampler2D dayTexture; uniform sampler2D nightTexture;
  uniform vec2 sunPosition; uniform vec2 globeRotation;
  varying vec3 vNormal; varying vec2 vUv;
  float toRad(float a){ return a * PI / 180.0; }
  vec3 polar2cart(vec2 c){ float t = toRad(90.0 - c.x); float p = toRad(90.0 - c.y);
    return vec3(sin(p)*cos(t), cos(p), sin(p)*sin(t)); }
  void main(){
    float invLon = toRad(globeRotation.x);
    float invLat = -toRad(globeRotation.y);
    mat3 rotX = mat3(1.0,0.0,0.0, 0.0,cos(invLat),-sin(invLat), 0.0,sin(invLat),cos(invLat));
    mat3 rotY = mat3(cos(invLon),0.0,sin(invLon), 0.0,1.0,0.0, -sin(invLon),0.0,cos(invLon));
    vec3 sunDir = rotX * rotY * polar2cart(sunPosition);
    vec3 n = normalize(vNormal);
    vec3 sd = normalize(sunDir);
    float intensity = dot(n, sd);
    vec4 day = texture2D(dayTexture, vUv);
    vec4 night = texture2D(nightTexture, vUv);
    float f = smoothstep(-0.12, 0.12, intensity);
    // Dusk ignition: city lights flare along the terminator, so towns visibly switch on
    // as the shadow line sweeps across them (and feed the bloom pass).
    float dusk = smoothstep(0.25, 0.0, abs(intensity));
    vec3 nightLit = night.rgb * vec3(1.05, 1.0, 0.85) * (1.0 + 1.6 * dusk);
    // Ocean glint: a water-masked specular highlight on the day side (view axis ~ +Z in view space).
    float sea = smoothstep(0.02, 0.12, day.b - day.r);
    vec3 h = normalize(sd + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, h), 0.0), 60.0) * sea * f;
    vec3 color = mix(nightLit, day.rgb, f) + vec3(0.5, 0.7, 0.9) * spec * 0.35;
    gl_FragColor = vec4(color, 1.0);
  }
`
