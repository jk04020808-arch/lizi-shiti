/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { BlenderEngine } from './lib/BlenderEngine';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { Upload, Settings2, Box, Sparkles, Loader2 } from 'lucide-react';

export default function App() {
  const panePRef = useRef<HTMLDivElement>(null);
  const paneMRef = useRef<HTMLDivElement>(null);
  const [engineP, setEngineP] = useState<BlenderEngine | null>(null);
  const [engineM, setEngineM] = useState<BlenderEngine | null>(null);
  const [sourceScene, setSourceScene] = useState<THREE.Group | null>(null);
  const [particleData, setParticleData] = useState<{ geometry: THREE.BufferGeometry, maxPoints: number } | null>(null);
  const [density, setDensity] = useState(40);
  const [loading, setLoading] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [solidMode, setSolidMode] = useState(false);
  
  const transitionUniformsRef = useRef({
    uTransitionY: { value: -10000 },
    uEdge: { value: 20 }
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const MAX_POINTS = 2500000;

  useEffect(() => {
    if (panePRef.current && paneMRef.current) {
      const ep = new BlenderEngine(panePRef.current, true);
      const em = new BlenderEngine(paneMRef.current, false);
      ep.animate();
      em.animate();
      setEngineP(ep);
      setEngineM(em);

      const handleResize = () => {
        ep.resize();
        em.resize();
      };
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        ep.dispose();
        em.dispose();
      };
    }
  }, []);

  useEffect(() => {
    if (!sourceScene) return;
    
    setLoading(true);
    
    setTimeout(() => {
      const textureCanvasMap = new Map<string, { data: Uint8ClampedArray, width: number, height: number } | null>();
      const getTextureData = (texture: THREE.Texture) => {
        if (!texture.image) return null;
        if (textureCanvasMap.has(texture.uuid)) return textureCanvasMap.get(texture.uuid);
        
        try {
          const image = texture.image as any;
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) return null;
          
          ctx.drawImage(image, 0, 0, image.width, image.height);
          const data = ctx.getImageData(0, 0, image.width, image.height).data;
          const result = { data, width: image.width, height: image.height };
          textureCanvasMap.set(texture.uuid, result);
          return result;
        } catch (e) {
          console.warn('Could not read texture data', e);
          textureCanvasMap.set(texture.uuid, null);
          return null;
        }
      };

      let totalArea = 0;
      const meshData: { mesh: THREE.Mesh, area: number, sampler: MeshSurfaceSampler }[] = [];

      sourceScene.traverse((c: any) => {
        if (c.isMesh && c.geometry && c.geometry.attributes.position) {
          c.updateMatrixWorld();
          
          let area = 0;
          const pos = c.geometry.attributes.position;
          const index = c.geometry.index;
          const vA = new THREE.Vector3();
          const vB = new THREE.Vector3();
          const vC = new THREE.Vector3();
          
          if (index) {
            for (let i = 0; i < index.count; i += 3) {
              vA.fromBufferAttribute(pos, index.getX(i)).applyMatrix4(c.matrixWorld);
              vB.fromBufferAttribute(pos, index.getX(i + 1)).applyMatrix4(c.matrixWorld);
              vC.fromBufferAttribute(pos, index.getX(i + 2)).applyMatrix4(c.matrixWorld);
              area += new THREE.Vector3().subVectors(vC, vB).cross(new THREE.Vector3().subVectors(vA, vB)).length() / 2;
            }
          } else {
            for (let i = 0; i < pos.count; i += 3) {
              if (i + 2 >= pos.count) break;
              vA.fromBufferAttribute(pos, i).applyMatrix4(c.matrixWorld);
              vB.fromBufferAttribute(pos, i + 1).applyMatrix4(c.matrixWorld);
              vC.fromBufferAttribute(pos, i + 2).applyMatrix4(c.matrixWorld);
              area += new THREE.Vector3().subVectors(vC, vB).cross(new THREE.Vector3().subVectors(vA, vB)).length() / 2;
            }
          }

          if (area > 0) {
            const sampler = new MeshSurfaceSampler(c).build();
            meshData.push({ mesh: c, area, sampler });
            totalArea += area;
          }
        }
      });

      const positions = new Float32Array(MAX_POINTS * 3);
      const colors = new Float32Array(MAX_POINTS * 3);
      let offset = 0;

      if (totalArea > 0) {
        const _position = new THREE.Vector3();
        const _normal = new THREE.Vector3();
        const _color = new THREE.Color();
        const _uv = new THREE.Vector2();

        for (const { mesh, area, sampler } of meshData) {
          const meshPoints = Math.floor((area / totalArea) * MAX_POINTS);
          const mat = mesh.material;
          const materials = Array.isArray(mat) ? mat : [mat];
          
          for (let i = 0; i < meshPoints; i++) {
            if (offset >= MAX_POINTS) break;
            
            sampler.sample(_position, _normal, _color, _uv);
            _position.applyMatrix4(mesh.matrixWorld);
            
            positions[offset * 3] = _position.x;
            positions[offset * 3 + 1] = _position.y;
            positions[offset * 3 + 2] = _position.z;
            
            let hasColor = false;
            const tempCol = new THREE.Color(1, 1, 1);
            const currentMat = materials[0] as any; 
            
            if (mesh.geometry.attributes.color) {
              tempCol.copy(_color);
              hasColor = true;
            }
            
            if (currentMat && currentMat.map && mesh.geometry.attributes.uv) {
              const texData = getTextureData(currentMat.map);
              if (texData) {
                let u = _uv.x - Math.floor(_uv.x);
                let vCoord = _uv.y - Math.floor(_uv.y);
                if (currentMat.map.flipY) vCoord = 1.0 - vCoord;
                
                const tx = Math.min(Math.max(Math.floor(u * texData.width), 0), texData.width - 1);
                const ty = Math.min(Math.max(Math.floor(vCoord * texData.height), 0), texData.height - 1);
                const idx = (ty * texData.width + tx) * 4;
                
                const texCol = new THREE.Color(
                  texData.data[idx] / 255,
                  texData.data[idx+1] / 255,
                  texData.data[idx+2] / 255
                );
                
                if (currentMat.map.colorSpace === THREE.SRGBColorSpace && typeof texCol.convertSRGBToLinear === 'function') {
                  texCol.convertSRGBToLinear();
                }
                
                if (hasColor) {
                  tempCol.multiply(texCol);
                } else {
                  tempCol.copy(texCol);
                  hasColor = true;
                }
              }
            }
            
            if (currentMat && currentMat.color) {
              if (hasColor) {
                tempCol.multiply(currentMat.color);
              } else {
                tempCol.copy(currentMat.color);
                hasColor = true;
              }
            }
            
            if (hasColor) {
              colors[offset * 3] = tempCol.r;
              colors[offset * 3 + 1] = tempCol.g;
              colors[offset * 3 + 2] = tempCol.b;
            } else {
              colors[offset * 3] = 0.8;
              colors[offset * 3 + 1] = 0.8;
              colors[offset * 3 + 2] = 0.8;
            }
            
            offset++;
          }
        }
      } else {
        sourceScene.traverse((c: any) => {
          if (c.isMesh && c.geometry && c.geometry.attributes.position) {
            const pos = c.geometry.attributes.position;
            const colorAttr = c.geometry.attributes.color;
            const uvAttr = c.geometry.attributes.uv;
            const mat = c.material;
            const materials = Array.isArray(mat) ? mat : [mat];
            
            for (let i = 0; i < pos.count; i++) {
              if (offset >= MAX_POINTS) break;
              
              const v = new THREE.Vector3().fromBufferAttribute(pos, i);
              v.applyMatrix4(c.matrixWorld);
              
              positions[offset * 3] = v.x;
              positions[offset * 3 + 1] = v.y;
              positions[offset * 3 + 2] = v.z;
              
              let hasColor = false;
              const tempCol = new THREE.Color(1, 1, 1);
              const currentMat = materials[0] as any;
              
              if (colorAttr) {
                tempCol.fromBufferAttribute(colorAttr, i);
                hasColor = true;
              }
              
              if (currentMat && currentMat.map && uvAttr) {
                const _uv = new THREE.Vector2().fromBufferAttribute(uvAttr, i);
                const texData = getTextureData(currentMat.map);
                if (texData) {
                  let u = _uv.x - Math.floor(_uv.x);
                  let vCoord = _uv.y - Math.floor(_uv.y);
                  if (currentMat.map.flipY) vCoord = 1.0 - vCoord;
                  
                  const tx = Math.min(Math.max(Math.floor(u * texData.width), 0), texData.width - 1);
                  const ty = Math.min(Math.max(Math.floor(vCoord * texData.height), 0), texData.height - 1);
                  const idx = (ty * texData.width + tx) * 4;
                  
                  const texCol = new THREE.Color(
                    texData.data[idx] / 255,
                    texData.data[idx+1] / 255,
                    texData.data[idx+2] / 255
                  );
                  
                  if (currentMat.map.colorSpace === THREE.SRGBColorSpace && typeof texCol.convertSRGBToLinear === 'function') {
                    texCol.convertSRGBToLinear();
                  }
                  
                  if (hasColor) {
                    tempCol.multiply(texCol);
                  } else {
                    tempCol.copy(texCol);
                    hasColor = true;
                  }
                }
              }
              
              if (currentMat && currentMat.color) {
                if (hasColor) {
                  tempCol.multiply(currentMat.color);
                } else {
                  tempCol.copy(currentMat.color);
                  hasColor = true;
                }
              }
              
              if (hasColor) {
                colors[offset * 3] = tempCol.r;
                colors[offset * 3 + 1] = tempCol.g;
                colors[offset * 3 + 2] = tempCol.b;
              } else {
                colors[offset * 3] = 0.8;
                colors[offset * 3 + 1] = 0.8;
                colors[offset * 3 + 2] = 0.8;
              }
              
              offset++;
            }
          }
        });
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, offset * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors.slice(0, offset * 3), 3));
      
      setParticleData({ geometry: geo, maxPoints: offset });
      setLoading(false);
    }, 50);
  }, [sourceScene]);

  useEffect(() => {
    if (particleData && engineP && sourceScene) {
      transitionUniformsRef.current.uTransitionY.value = -10000;

      const box = new THREE.Box3().setFromObject(sourceScene);
      const size = new THREE.Vector3();
      box.getSize(size);
      transitionUniformsRef.current.uEdge.value = size.y * 0.8;

      const setupMaterial = (m: THREE.Material, isSolid: boolean) => {
        const newMat = m.clone();
        newMat.userData.uniforms = transitionUniformsRef.current;
        newMat.onBeforeCompile = (shader) => {
          shader.uniforms.uTransitionY = transitionUniformsRef.current.uTransitionY;
          shader.uniforms.uEdge = transitionUniformsRef.current.uEdge;

          shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
             varying vec3 vWorldPos;`
          );
          shader.vertexShader = shader.vertexShader.replace(
            '#include <worldpos_vertex>',
            `#include <worldpos_vertex>
             vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
          );

          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
             varying vec3 vWorldPos;
             uniform float uTransitionY;
             uniform float uEdge;

             float hash(vec3 p) {
                 p = fract(p * 0.3183099 + .1);
                 p *= 17.0;
                 return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
             }
             float noise(vec3 x) {
                 vec3 i = floor(x);
                 vec3 f = fract(x);
                 f = f * f * (3.0 - 2.0 * f);
                 return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                                mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                                mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
             }
            `
          );

          const discardLogic = isSolid
            ? `
              float n1 = noise(vWorldPos * 0.015);
              float n2 = noise(vWorldPos * 0.05);
              float n3 = noise(vWorldPos * 0.15);
              float n = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
              float boundary = uTransitionY + (n - 0.5) * uEdge;
              if (vWorldPos.y > boundary) discard;
              `
            : `
              float n1 = noise(vWorldPos * 0.015);
              float n2 = noise(vWorldPos * 0.05);
              float n3 = noise(vWorldPos * 0.15);
              float n = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
              float boundary = uTransitionY + (n - 0.5) * uEdge;
              if (vWorldPos.y < boundary) discard;
              `;

          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <clipping_planes_fragment>',
            `#include <clipping_planes_fragment>
             ${discardLogic}
            `
          );
        };
        return newMat;
      };

      const material = new THREE.PointsMaterial({
        size: 0.15,
        vertexColors: true,
        color: new THREE.Color(0.5, 0.5, 0.5), // Decrease brightness
        transparent: true,
        opacity: 1.0,
        blending: THREE.NormalBlending,
        depthWrite: true,
      });
      const customParticleMat = setupMaterial(material, false) as THREE.PointsMaterial;
      const pointsObj = new THREE.Points(particleData.geometry, customParticleMat);
      pointsObj.name = 'particleModel';
      
      const solidObj = sourceScene.clone();
      solidObj.name = 'solidModel';
      solidObj.visible = false;
      
      solidObj.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (Array.isArray(child.material)) {
            child.material = child.material.map(m => setupMaterial(m as THREE.Material, true));
          } else {
            child.material = setupMaterial(child.material as THREE.Material, true);
            child.material.needsUpdate = true;
          }
        }
      });

      const group = new THREE.Group();
      group.add(pointsObj);
      group.add(solidObj);
      
      engineP.setModel(group);
      setSolidMode(false);
      setIsTransitioning(false);
    }
  }, [particleData, engineP, sourceScene]);

  useEffect(() => {
    if (particleData && engineP) {
      const pointsObj = engineP.modelGroup.getObjectByName('particleModel') as THREE.Points;
      const solidObj = engineP.modelGroup.getObjectByName('solidModel');
      
      if (pointsObj) {
        const minPoints = Math.max(1000, Math.floor(particleData.maxPoints * 0.005));
        const currentPoints = Math.floor(THREE.MathUtils.mapLinear(density, 1, 100, minPoints, particleData.maxPoints));
        
        pointsObj.geometry.setDrawRange(0, currentPoints);
        
        const mat = pointsObj.material as THREE.PointsMaterial;
        mat.opacity = THREE.MathUtils.mapLinear(density, 1, 100, 0.6, 1.0);
        mat.size = THREE.MathUtils.mapLinear(density, 1, 100, 0.3, 0.25);
        mat.needsUpdate = true;

        if (density < 100 && solidMode) {
          setSolidMode(false);
          if (solidObj) solidObj.visible = false;
          pointsObj.visible = true;
          transitionUniformsRef.current.uTransitionY.value = -10000;
        }
      }
    }
  }, [density, particleData, engineP, solidMode]);

  const startTransition = () => {
    if (!engineP) return;
    setIsTransitioning(true);
    
    const pointsObj = engineP.modelGroup.getObjectByName('particleModel') as THREE.Points;
    const solidObj = engineP.modelGroup.getObjectByName('solidModel');
    
    if (solidObj) solidObj.visible = true;
    if (pointsObj) pointsObj.visible = true;
    
    // Ensure world matrices are up to date
    engineP.modelGroup.updateMatrixWorld(true);
    
    // Compute world bounds of the model group
    const box = new THREE.Box3().setFromObject(engineP.modelGroup);
    const size = new THREE.Vector3();
    box.getSize(size);
    
    const duration = 8000; // Even slower transition (8 seconds)
    const startTime = performance.now();
    const edge = transitionUniformsRef.current.uEdge.value;
    const startY = box.min.y - edge * 0.5;
    const endY = box.max.y + edge * 0.5;
    
    const animateTransition = (time: number) => {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1.0);
      
      // Smooth step easing
      const easeProgress = progress < 0.5 
        ? 4 * progress * progress * progress 
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        
      const currentY = THREE.MathUtils.lerp(startY, endY, easeProgress);
      
      transitionUniformsRef.current.uTransitionY.value = currentY;
      
      if (progress < 1.0) {
        requestAnimationFrame(animateTransition);
      } else {
        setIsTransitioning(false);
        setSolidMode(true);
        if (pointsObj) pointsObj.visible = false;
        transitionUniformsRef.current.uTransitionY.value = 10000;
      }
    };
    
    requestAnimationFrame(animateTransition);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const url = URL.createObjectURL(file);

    new GLTFLoader().load(url, (gltf) => {
      setSourceScene(gltf.scene);
      engineM?.setModel(gltf.scene);
      setLoading(false);
    }, undefined, (error) => {
      console.error(error);
      setLoading(false);
    });
  };

  return (
    <div className="w-full h-screen overflow-hidden bg-black text-white font-sans selection:bg-cyan-500/30">
      {/* Top UI */}
      <div className="absolute top-0 left-0 w-full h-16 bg-black/60 backdrop-blur-md border-b border-cyan-500/30 flex items-center justify-between px-6 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-cyan-500/10 border border-cyan-500/50 flex items-center justify-center">
            <Box className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="font-black tracking-[0.2em] text-cyan-50 text-sm">
            SYSTEM_V6
          </div>
        </div>
        
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-cyan-400 font-medium uppercase tracking-wider">
              <Settings2 className="w-4 h-4" />
              <span>Particle Density</span>
            </div>
            <input 
              type="range" 
              min="1" 
              max="100" 
              value={density}
              onChange={(e) => setDensity(Number(e.target.value))}
              className="w-32 accent-cyan-400 cursor-pointer" 
            />
            <span className="text-xs text-cyan-400 w-6 text-right font-mono">{density}%</span>
          </div>
          
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="group relative px-5 py-2 bg-transparent border border-cyan-500 text-cyan-400 text-xs font-bold uppercase tracking-wider transition-all duration-300 hover:bg-cyan-500 hover:text-black hover:shadow-[0_0_20px_rgba(0,242,255,0.5)] flex items-center gap-2 overflow-hidden"
          >
            <div className="absolute inset-0 bg-cyan-400/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            <Upload className="w-4 h-4 relative z-10" />
            <span className="relative z-10">Load 3D Model</span>
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            accept=".glb,.gltf" 
            onChange={handleFileUpload}
            className="hidden" 
          />
        </div>
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[2000] flex flex-col items-center justify-center text-cyan-400 gap-4">
          <Loader2 className="w-12 h-12 animate-spin" />
          <div className="text-lg tracking-[0.3em] font-light animate-pulse">DECODING GEOMETRY...</div>
        </div>
      )}

      {/* View Container */}
      <div className="flex w-full h-full pt-16">
        {/* Particle Pane */}
        <div className="flex-1 relative border-r border-cyan-500/20 group">
          <div className="absolute top-6 left-6 z-10 pointer-events-none">
            <div className="flex items-center gap-2 text-[10px] text-cyan-400 tracking-[0.2em] uppercase font-bold opacity-70 group-hover:opacity-100 transition-opacity">
              <Sparkles className="w-3 h-3" />
              <span>Particle Reconstruction Field</span>
            </div>
            <div className="w-8 h-[2px] bg-cyan-500 mt-2 opacity-50" />
          </div>
          <div ref={panePRef} className="w-full h-full" />
          
          {/* Decorative corners */}
          <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-cyan-500/30 m-4 pointer-events-none" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-cyan-500/30 m-4 pointer-events-none" />

          {/* Transition Button */}
          {density === 100 && !solidMode && !isTransitioning && particleData && (
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20">
              <button
                onClick={startTransition}
                className="group relative px-6 py-3 bg-black/80 backdrop-blur-md border border-cyan-500 text-cyan-400 text-xs font-bold uppercase tracking-[0.2em] transition-all duration-300 hover:bg-cyan-500 hover:text-black hover:shadow-[0_0_30px_rgba(0,242,255,0.6)] flex items-center gap-3 overflow-hidden rounded-sm"
              >
                <div className="absolute inset-0 bg-cyan-400/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                <Sparkles className="w-4 h-4 relative z-10 animate-pulse" />
                <span className="relative z-10">Materialize Solid</span>
              </button>
            </div>
          )}
          {isTransitioning && (
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 px-6 py-3 bg-black/80 backdrop-blur-md border border-cyan-500/50 text-cyan-400/80 text-xs font-bold uppercase tracking-[0.2em] rounded-sm flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Materializing...</span>
            </div>
          )}
          {solidMode && (
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20 px-6 py-3 bg-emerald-950/80 backdrop-blur-md border border-emerald-500/50 text-emerald-400 text-xs font-bold uppercase tracking-[0.2em] rounded-sm flex items-center gap-3 shadow-[0_0_20px_rgba(16,185,129,0.2)]">
              <Box className="w-4 h-4" />
              <span>Solid Material Active</span>
            </div>
          )}
        </div>

        {/* Mesh Pane */}
        <div className="flex-1 relative group bg-black/50">
          <div className="absolute top-6 left-6 z-10 pointer-events-none">
            <div className="flex items-center gap-2 text-[10px] text-cyan-400 tracking-[0.2em] uppercase font-bold opacity-70 group-hover:opacity-100 transition-opacity">
              <Box className="w-3 h-3" />
              <span>Original Material Mesh</span>
            </div>
            <div className="w-8 h-[2px] bg-cyan-500 mt-2 opacity-50" />
          </div>
          <div ref={paneMRef} className="w-full h-full" />
          
          {/* Decorative corners */}
          <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-cyan-500/30 m-4 pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-cyan-500/30 m-4 pointer-events-none" />
        </div>
      </div>
    </div>
  );
}
