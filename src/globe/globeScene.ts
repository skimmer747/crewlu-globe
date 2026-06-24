import Globe from 'globe.gl'
import * as THREE from 'three'
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
  const material = new THREE.ShaderMaterial({
    uniforms: {
      dayTexture: { value: loader.load('/textures/earth-day.jpg') },
      nightTexture: { value: loader.load('/textures/earth-night.jpg') },
      sunPosition: { value: new THREE.Vector2() },
      globeRotation: { value: new THREE.Vector2() },
    },
    vertexShader: dayNightVertex,
    fragmentShader: dayNightFragment,
  })

  const globe = (Globe as any)()(host)
    .backgroundColor('rgba(0,0,0,0)')
    .globeMaterial(material)
    .showAtmosphere(true).atmosphereColor('#6db6ff').atmosphereAltitude(0.2)

  const size = () => globe.width(host.clientWidth).height(host.clientHeight)
  size(); window.addEventListener('resize', size)
  globe.pointOfView({ lat: 25, lng: -40, altitude: 2.4 }, 0)

  const ctr = globe.controls()
  ctr.autoRotate = true; ctr.autoRotateSpeed = 0.5
  ctr.enableZoom = true; ctr.minDistance = 160; ctr.maxDistance = 1800
  globe.camera().far = 50000; globe.camera().updateProjectionMatrix() // render the distant sky bodies (Sun/planets)
  ctr.addEventListener('change', () => {
    const pov = globe.pointOfView()
    material.uniforms.globeRotation.value.set(pov.lng, pov.lat)
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
