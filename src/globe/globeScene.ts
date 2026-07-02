import Globe from 'globe.gl'
import * as THREE from 'three'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { dayNightVertex, dayNightFragment } from './dayNightShader'
import { subsolarPoint } from '../astro/sun'

export interface GlobeScene {
  globe: any
  setSun(date: Date): void
  cameraPos(): { x: number; y: number; z: number }
  onCameraChange(cb: () => void): void
}

export function createGlobeScene(host: HTMLElement, viewport: HTMLElement): GlobeScene {
  const loader = new THREE.TextureLoader()
  const dayTex = loader.load('/textures/earth-day.jpg')
  const nightTex = loader.load('/textures/earth-night.jpg')
  const material = new THREE.ShaderMaterial({
    uniforms: {
      dayTexture: { value: dayTex },
      nightTexture: { value: nightTex },
      sunPosition: { value: new THREE.Vector2() },
      globeRotation: { value: new THREE.Vector2() },
    },
    vertexShader: dayNightVertex,
    fragmentShader: dayNightFragment,
  })

  // preserveDrawingBuffer lets the share card read the frame back out of the canvas.
  const globe = (Globe as any)({ rendererConfig: { preserveDrawingBuffer: true } })(host)
    .backgroundColor('rgba(0,0,0,0)')
    .globeMaterial(material)
    .showAtmosphere(true).atmosphereColor('#6db6ff').atmosphereAltitude(0.2)

  // Free sharpness at close zoom: max anisotropic filtering on both Earth textures.
  const maxAniso = globe.renderer().capabilities.getMaxAnisotropy()
  dayTex.anisotropy = maxAniso
  nightTex.anisotropy = maxAniso

  // Real bloom: only pixels above the threshold glow — the cyan arcs, the dart's additive
  // cones, and terminator-boosted city lights. The day-side Earth stays below threshold.
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(host.clientWidth || 800, host.clientHeight || 600), 0.55, 0.4, 0.85)
  globe.postProcessingComposer().addPass(bloom)

  // Progressive detail: the first time the camera comes in close, swap the 4K maps
  // for 8K (guarded by GPU max texture size; ~8MB fetched once, only for engaged users).
  let hiRes = false
  const maybeLoadHiRes = () => {
    if (hiRes) return
    const p = globe.camera().position
    if (Math.hypot(p.x, p.y, p.z) > 320) return
    hiRes = true
    if (globe.renderer().capabilities.maxTextureSize < 8192) return
    loader.load('/textures/earth-day-8k.jpg', (t: any) => { t.anisotropy = maxAniso; material.uniforms.dayTexture.value = t })
    loader.load('/textures/earth-night-8k.jpg', (t: any) => { t.anisotropy = maxAniso; material.uniforms.nightTexture.value = t })
  }

  const size = () => {
    globe.width(host.clientWidth).height(host.clientHeight)
    bloom.setSize(host.clientWidth || 800, host.clientHeight || 600)
  }
  size(); window.addEventListener('resize', size)
  globe.pointOfView({ lat: 25, lng: -40, altitude: 2.4 }, 0)

  const ctr = globe.controls()
  ctr.autoRotate = true; ctr.autoRotateSpeed = 0.5
  ctr.enableZoom = true; ctr.minDistance = 160; ctr.maxDistance = 1800
  globe.camera().far = 50000; globe.camera().updateProjectionMatrix() // render the distant sky bodies (Sun/planets)
  ctr.addEventListener('change', () => {
    const pov = globe.pointOfView()
    material.uniforms.globeRotation.value.set(pov.lng, pov.lat)
    maybeLoadHiRes()
  })

  // The viewport parallax tilt (perspective + rotateX/Y + scale) has been removed.
  // Applying it to the canvas container breaks globe.gl's raycaster; applying it to the
  // HUD breaks pointer-events on HUD buttons. The starfield translate in main.ts remains.

  return {
    globe,
    setSun(date) { const s = subsolarPoint(date); material.uniforms.sunPosition.value.set(s.lng, s.lat) },
    cameraPos() { const p = globe.camera().position; return { x: p.x, y: p.y, z: p.z } },
    onCameraChange(cb) { ctr.addEventListener('change', cb) },
  }
}
