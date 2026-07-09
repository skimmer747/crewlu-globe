import * as THREE from 'three'
import { subsolarPoint } from '../astro/sun'
import { geoToCartesian } from './occlusion'

// Real 3D moon, shown only while the lunar cinematic flies (the everyday Moon stays the DOM
// overlay in moonLayer). Radius matches the app's visual language: MOON_EARTH_RATIO (0.2) ×
// globe radius (100). Added via scene().add() — never customThreeObject (the dart owns it).
const MOON_R = 20

const SITES = [
  { name: 'APOLLO 11', lat: 0.674, lng: 23.473 },
  { name: 'APOLLO 15', lat: 26.132, lng: 3.634 },
  { name: 'APOLLO 17', lat: 20.191, lng: 30.772 },
]

export interface MoonMesh {
  radius: number
  show(center: { x: number; y: number; z: number }, date: Date): void
  hide(): void
  setLabelOpacity(o: number): void
}

export function createMoonMesh(globe: any): MoonMesh {
  const group = new THREE.Group()
  let added = false
  let texRequested = false

  const uniforms = {
    map: { value: new THREE.Texture() as any },
    hasMap: { value: 0 },
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
  }
  // Lambert with a hard cap: 0.05 earthshine floor so the night side never goes black; the
  // 0.85 diffuse ceiling keeps every pixel under the bloom threshold (0.95) — terrain must
  // never bloom.
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `varying vec3 vN; varying vec2 vUv;
void main() { vN = normalize(mat3(modelMatrix) * normal); vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform float hasMap; uniform vec3 sunDir;
varying vec3 vN; varying vec2 vUv;
void main() {
  vec3 base = hasMap > 0.5 ? texture2D(map, vUv).rgb : vec3(0.62, 0.63, 0.66);
  float diff = max(dot(normalize(vN), normalize(sunDir)), 0.0);
  gl_FragColor = vec4(base * (0.05 + 0.85 * diff), 1.0);
}`,
  })
  group.add(new THREE.Mesh(new THREE.SphereGeometry(MOON_R, 96, 48), mat))

  // Apollo-site labels: canvas-text sprites parented to the group (sprites billboard on their
  // own). Selenographic → local: +X faces Earth (three's sphere UV puts the texture center on
  // +X), +Y is lunar north, and east runs toward -Z.
  const labelSprites: any[] = []
  for (const s of SITES) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96
    const x = c.getContext('2d')!
    x.font = '700 40px ui-monospace, Menlo, monospace'
    x.textBaseline = 'middle'
    x.shadowColor = 'rgba(47,214,255,0.9)'; x.shadowBlur = 14
    x.fillStyle = '#dff4ff'
    x.fillText(`· ${s.name}`, 18, 48)
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0, depthWrite: false }))
    const la = (s.lat * Math.PI) / 180, lo = (s.lng * Math.PI) / 180
    const r = MOON_R * 1.1
    spr.position.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo))
    spr.scale.set(13, 2.4, 1)
    group.add(spr)
    labelSprites.push(spr)
  }

  const center = new THREE.Vector3()

  return {
    radius: MOON_R,
    show(c, date) {
      center.set(c.x, c.y, c.z)
      group.position.copy(center)
      // Near side faces Earth: rotate local +X onto the Earth direction, +Y ≈ north.
      const toEarth = center.clone().negate().normalize()
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), toEarth).normalize()
      const up = new THREE.Vector3().crossVectors(toEarth, right).normalize()
      group.setRotationFromMatrix(new THREE.Matrix4().makeBasis(toEarth, up, new THREE.Vector3().crossVectors(toEarth, up)))
      // Correct phase lighting: the sun direction from the live ephemeris (the sun is far
      // enough away that the Earth-centered direction serves at the Moon too).
      const s = subsolarPoint(date)
      const d = geoToCartesian(s.lat, s.lng, 0, 1)
      uniforms.sunDir.value.set(d.x, d.y, d.z)
      if (!texRequested) {
        texRequested = true
        new THREE.TextureLoader().load(
          '/textures/moon-color-2k.jpg',
          (t: any) => {
            t.colorSpace = THREE.SRGBColorSpace
            t.anisotropy = globe.renderer().capabilities.getMaxAnisotropy()
            uniforms.map.value = t
            uniforms.hasMap.value = 1
          },
          undefined,
          () => console.warn('moon-color-2k.jpg failed to load — flat-grey moon'),
        )
      }
      if (!added) { globe.scene().add(group); added = true }
    },
    hide() { if (added) { globe.scene().remove(group); added = false } },
    setLabelOpacity(o) { for (const spr of labelSprites) spr.material.opacity = o },
  }
}
