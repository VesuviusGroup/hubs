import {
  Mesh,
  PlaneBufferGeometry,
  MeshStandardMaterial,
  MeshPhongMaterial,
  Vector2,
  RepeatWrapping,
  Texture,
  IUniform,
  Color,
  BufferAttribute,
  InterleavedBufferAttribute,
  DynamicDrawUsage
} from "three";
import { SimplexNoise } from "three/examples/jsm/math/SimplexNoise";
import waterNormalsUrl from "../assets/waternormals.jpg";
import HubsTextureLoader from "../loaders/HubsTextureLoader";

/**
 * SimpleWater
 * Keep in sync with Spoke's SimpleWater class
 */

/**
 * Adapted dynamic geometry code from: https://github.com/ditzel/UnityOceanWavesAndShip
 */
class Octave {
  speed: Vector2;
  scale: Vector2;
  height: number;
  alternate: boolean;
  constructor(
    speed: Vector2 = new Vector2(1, 1),
    scale: Vector2 = new Vector2(1, 1),
    height: number = 0.0025,
    alternate: boolean = true
  ) {
    this.speed = speed;
    this.scale = scale;
    this.height = height;
    this.alternate = alternate;
  }
}

let normalMap: Texture;

export class SimpleWaterMesh extends Mesh {
  lowQuality: boolean;
  waterUniforms: { [uniform: string]: IUniform };
  resolution: number;
  octaves: Octave[];
  simplex: SimplexNoise;
  waterMaterial: MeshPhongMaterial | MeshStandardMaterial;

  constructor({ resolution = 24, lowQuality = false }: { resolution?: number; lowQuality?: boolean }) {
    if (!normalMap) {
      normalMap = new HubsTextureLoader().load(waterNormalsUrl);
    }

    const geometry = new PlaneBufferGeometry(10, 10, resolution, resolution);
    geometry.rotateX(-Math.PI / 2);

    const waterUniforms = {
      ripplesSpeed: { value: 0.25 },
      ripplesScale: { value: 1 },
      time: { value: 0 }
    };

    const materialClass = lowQuality ? MeshPhongMaterial : MeshStandardMaterial;

    normalMap.wrapS = normalMap.wrapT = RepeatWrapping;

    const material = new materialClass({ color: 0x0054df, normalMap, roughness: 0.5, metalness: 0.5 });
    material.name = "SimpleWaterMaterial";

    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, waterUniforms);

      shader.vertexShader = shader.vertexShader.replace(
        "#include <fog_pars_vertex>",
        `
          #include <fog_pars_vertex>
          varying vec3 vWPosition;
        `
      );

      shader.vertexShader = shader.vertexShader.replace(
        "#include <fog_vertex>",
        `
          #include <fog_vertex>
          vWPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        `
      );

      // getNoise function from https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Water.js
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normalmap_pars_fragment>",
        `
          #include <normalmap_pars_fragment>
  
          uniform float time;
          uniform float ripplesSpeed;
          uniform float ripplesScale;
        
          varying vec3 vWPosition;
        
          vec4 getNoise(vec2 uv){
            float timeOffset = time * ripplesSpeed;
            uv = (uv - 0.5) * (1.0 / ripplesScale);
            vec2 uv0 = (uv/103.0)+vec2(timeOffset/17.0, timeOffset/29.0);
            vec2 uv1 = uv/107.0-vec2(timeOffset/-19.0, timeOffset/31.0);
            vec2 uv2 = uv/vec2(897.0, 983.0)+vec2(timeOffset/101.0, timeOffset/97.0);
            vec2 uv3 = uv/vec2(991.0, 877.0)-vec2(timeOffset/109.0, timeOffset/-113.0);
            vec4 noise = (texture2D(normalMap, uv0)) +
                         (texture2D(normalMap, uv1)) +
                         (texture2D(normalMap, uv2)) +
                         (texture2D(normalMap, uv3));
            return noise / 4.0;
          }
        `
      );

      // https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/normalmap_pars_fragment.glsl.js#L20
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_maps>",
        `
            // Workaround for Adreno 3XX dFd*( vec3 ) bug. See #9988
  
            vec3 eye_pos = -vViewPosition;
            vec3 q0 = vec3( dFdx( eye_pos.x ), dFdx( eye_pos.y ), dFdx( eye_pos.z ) );
            vec3 q1 = vec3( dFdy( eye_pos.x ), dFdy( eye_pos.y ), dFdy( eye_pos.z ) );
            vec2 st0 = dFdx( vUv.st );
            vec2 st1 = dFdy( vUv.st );
  
            float scale = sign( st1.t * st0.s - st0.t * st1.s ); // we do not care about the magnitude
  
            vec3 S = normalize( ( q0 * st1.t - q1 * st0.t ) * scale );
            vec3 T = normalize( ( - q0 * st1.s + q1 * st0.s ) * scale );
            vec3 N = normalize( normal );
            mat3 tsn = mat3( S, T, N );
  
            vec3 mapN = getNoise(vWPosition.xz).xyz * 2.0 - 1.0;
  
            mapN.xy *= normalScale;
            mapN.xy *= ( float( gl_FrontFacing ) * 2.0 - 1.0 );
  
            normal = normalize( tsn * mapN );
          `
      );
    };

    super(geometry, material);

    this.resolution = resolution;
    this.lowQuality = lowQuality;
    this.waterMaterial = material;
    this.waterUniforms = waterUniforms;

    if (this.lowQuality) {
      if (this.material instanceof MeshPhongMaterial) {
        this.material.specular.set(0xffffff);
      }
    } else {
      this.receiveShadow = true;
    }

    const buffer: BufferAttribute | InterleavedBufferAttribute = this.geometry.attributes.position;
    if (buffer instanceof BufferAttribute) {
      (buffer as BufferAttribute).setUsage(DynamicDrawUsage);
    }

    this.octaves = [
      new Octave(new Vector2(0.5, 0.5), new Vector2(1, 1), 0.01, true),
      new Octave(new Vector2(0.05, 6), new Vector2(1, 20), 0.1, false)
    ];

    this.simplex = new SimplexNoise();
  }

  get opacity(): number {
    return this.waterMaterial.opacity;
  }

  set opacity(value: number) {
    this.waterMaterial.opacity = value;
    if (value !== 1) {
      this.waterMaterial.transparent = true;
    }
  }

  get color(): Color {
    return this.waterMaterial.color;
  }

  get tideHeight() {
    return this.octaves[0].height;
  }

  get tideScale() {
    return this.octaves[0].scale;
  }

  get tideSpeed() {
    return this.octaves[0].speed;
  }

  set tideHeight(value) {
    this.octaves[0].height = value;
  }

  get waveHeight() {
    return this.octaves[1].height;
  }

  set waveHeight(value) {
    this.octaves[1].height = value;
  }

  get waveScale() {
    return this.octaves[1].scale;
  }

  get waveSpeed() {
    return this.octaves[1].speed;
  }

  set ripplesSpeed(value) {
    this.waterUniforms.ripplesSpeed.value = value;
  }

  get ripplesSpeed() {
    return this.waterUniforms.ripplesSpeed.value;
  }

  set ripplesScale(value) {
    this.waterUniforms.ripplesScale.value = value;
  }

  get ripplesScale() {
    return this.waterUniforms.ripplesScale.value;
  }

  update(time: number) {
    const positionAttribute = this.geometry.attributes.position;

    for (let x = 0; x <= this.resolution; x++) {
      for (let z = 0; z <= this.resolution; z++) {
        let y = 0;

        for (let o = 0; o < this.octaves.length; o++) {
          const octave = this.octaves[o];

          if (octave.alternate) {
            const noise = this.simplex.noise(
              (x * octave.scale.x) / this.resolution,
              (z * octave.scale.y) / this.resolution
            );
            y += Math.cos(noise + octave.speed.length() * time) * octave.height;
          } else {
            const noise =
              this.simplex.noise(
                (x * octave.scale.x + time * octave.speed.x) / this.resolution,
                (z * octave.scale.y + time * octave.speed.y) / this.resolution
              ) - 0.5;
            y += noise * octave.height;
          }
        }

        positionAttribute.setY(x * (this.resolution + 1) + z, y);
      }
    }

    this.geometry.computeVertexNormals();
    positionAttribute.needsUpdate = true;
    this.waterUniforms.time.value = time;
  }

  clone(recursive: boolean = true): this {
    return new (<any>this.constructor)(this.waterMaterial.normalMap, this.resolution, this.lowQuality).copy(
      this,
      recursive
    );
  }

  copy(source: this, recursive: boolean = true) {
    super.copy(source, recursive);

    this.opacity = source.opacity;
    this.color.copy(source.color);
    this.tideHeight = source.tideHeight;
    this.tideScale.copy(source.tideScale);
    this.tideSpeed.copy(source.tideSpeed);
    this.waveHeight = source.waveHeight;
    this.waveScale.copy(source.waveScale);
    this.waveSpeed.copy(source.waveSpeed);
    this.ripplesSpeed = source.ripplesSpeed;
    this.ripplesScale = source.ripplesScale;

    return this;
  }
}
