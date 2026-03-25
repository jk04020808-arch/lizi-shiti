import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class BlenderEngine {
    dom: HTMLElement;
    isParticle: boolean;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    targetZoom: number;
    currentZoom: number;
    minZoom: number;
    maxZoom: number;
    modelGroup: THREE.Group;
    animationId: number | null = null;
    
    constructor(dom: HTMLElement, isParticle: boolean) {
        this.dom = dom;
        this.isParticle = isParticle;
        this.scene = new THREE.Scene();
        
        this.camera = new THREE.PerspectiveCamera(45, this.dom.clientWidth / this.dom.clientHeight, 0.1, 100000);
        this.camera.position.set(150, 150, 150);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(this.dom.clientWidth, this.dom.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.localClippingEnabled = true;
        this.dom.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true; 
        this.controls.dampingFactor = 0.03;
        this.controls.rotateSpeed = 0.7;
        this.controls.enableZoom = false;
        this.controls.screenSpacePanning = true;

        this.targetZoom = 250;
        this.currentZoom = 250;
        this.minZoom = 10;
        this.maxZoom = 2000;

        this.initWorld();
        this.setupZoomEvents();

        this.modelGroup = new THREE.Group();
        this.scene.add(this.modelGroup);
    }

    setupZoomEvents() {
        this.dom.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomStep = this.targetZoom * 0.1; 
            if (e.deltaY > 0) {
                this.targetZoom += zoomStep;
            } else {
                this.targetZoom -= zoomStep;
            }
            this.targetZoom = THREE.MathUtils.clamp(this.targetZoom, this.minZoom, this.maxZoom);
        }, { passive: false });
    }

    initWorld() {
        const sGeo = new THREE.BufferGeometry();
        const sPos = [];
        for(let i=0; i<2000; i++) sPos.push((Math.random()-0.5)*2000, (Math.random()-0.5)*2000, (Math.random()-0.5)*2000);
        sGeo.setAttribute('position', new THREE.Float32BufferAttribute(sPos, 3));
        this.scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({color: 0x444444, size: 1})));

        this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const sun = new THREE.DirectionalLight(0xffffff, 1.2);
        sun.position.set(100, 100, 100);
        this.scene.add(sun);
        
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
        fillLight.position.set(-100, 0, -100);
        this.scene.add(fillLight);
    }

    setModel(object: THREE.Object3D) {
        this.modelGroup.clear();
        const model = object.clone();
        
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 100 / (maxDim || 1);
        
        model.scale.setScalar(scale);
        model.position.sub(center.multiplyScalar(scale)); 
        
        this.modelGroup.add(model);
        
        this.targetZoom = 250;
        this.currentZoom = 500;
        this.controls.target.set(0, 0, 0);
    }

    animate = () => {
        this.animationId = requestAnimationFrame(this.animate);

        this.currentZoom = THREE.MathUtils.lerp(this.currentZoom, this.targetZoom, 0.05);
        
        const direction = new THREE.Vector3().subVectors(this.camera.position, this.controls.target).normalize();
        this.camera.position.copy(this.controls.target).addScaledVector(direction, this.currentZoom);

        this.controls.update();
        
        if(this.isParticle && this.modelGroup.children.length > 0) {
            this.modelGroup.rotation.y += 0.0005;
        }
        
        this.renderer.render(this.scene, this.camera);
    }

    resize() {
        this.camera.aspect = this.dom.clientWidth / this.dom.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.dom.clientWidth, this.dom.clientHeight);
    }

    dispose() {
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
        }
        this.renderer.dispose();
        if (this.dom.contains(this.renderer.domElement)) {
            this.dom.removeChild(this.renderer.domElement);
        }
    }
}
