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
  ctr.enableZoom = true; ctr.minDistance = 160; ctr.maxDistance = 600
  ctr.addEventListener('change', () => {
    const pov = globe.pointOfView()
    material.uniforms.globeRotation.value.set(pov.lng, pov.lat)
  })

  window.addEventListener('mousemove', (e) => {
    const x = e.clientX / window.innerWidth - 0.5
    const y = e.clientY / window.innerHeight - 0.5
    viewport.style.transform = `perspective(1300px) rotateY(${x * 5}deg) rotateX(${-y * 5}deg) scale(1.01)`
  })

  return {
    globe,
    setSun(date) { const s = subsolarPoint(date); material.uniforms.sunPosition.value.set(s.lng, s.lat) },
    cameraPos() { const p = globe.camera().position; return { x: p.x, y: p.y, z: p.z } },
    onCameraChange(cb) { ctr.addEventListener('change', cb) },
  }
}
