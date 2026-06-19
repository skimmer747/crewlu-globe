import './styles.css'
import { createGlobeScene } from './globe/globeScene'
const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = '<div id="viewport" style="position:fixed;inset:0"><div id="globe" style="width:100%;height:100%"></div></div>'
const scene = createGlobeScene(app.querySelector('#globe')!, app.querySelector('#viewport')!)
scene.setSun(new Date('2024-03-20T12:00:00Z'))
