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
    float intensity = dot(normalize(vNormal), normalize(sunDir));
    vec4 day = texture2D(dayTexture, vUv);
    vec4 night = texture2D(nightTexture, vUv);
    float f = smoothstep(-0.12, 0.12, intensity);
    gl_FragColor = vec4(mix(night.rgb * vec3(1.05,1.0,0.85), day.rgb, f), 1.0);
  }
`
