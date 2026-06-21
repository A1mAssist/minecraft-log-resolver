import { SkinViewer } from "skinview3d";
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  RepeatWrapping,
} from "three";

const NAME_MC_CAMERA = {
  fov: 38,
  zoom: 0.78,
  yaw: Math.PI / 7,
  pitch: -0.05,
};

const DEFAULT_STEVE_SKIN = "generated-steve-64";

const DEFAULT_STAGE_OPTIONS = {
  armorKit: "diamond",
  handItem: "diamond_sword",
  stageBase: "obsidian_3x3",
  enchantGlint: true,
};

const ARMOR_PALETTE = {
  diamond: {
    primary: "#4deeea",
    secondary: "#2aa8b7",
    edge: "#d8fffb",
    metalness: 0.18,
    roughness: 0.56,
  },
  netherite: {
    primary: "#2f3038",
    secondary: "#171920",
    edge: "#7c6f86",
    metalness: 0.32,
    roughness: 0.62,
  },
};

const BASE_PALETTE = {
  obsidian_3x3: ["#141722", "#10131c", "#202438"],
  bedrock_3x3: ["#2b3039", "#1e232c", "#3a404b"],
};

let activeCleanup = null;

export function initStage3d(root = document) {
  if (activeCleanup) activeCleanup();

  const canvases = [...root.querySelectorAll(".stage-canvas")];
  const cleanups = canvases.map((canvas) => createStage(canvas));
  activeCleanup = () => cleanups.forEach((cleanup) => cleanup());
}

function createStage(canvas) {
  const card = canvas.closest(".stage-card");
  const viewport = canvas.closest(".stage-viewport");
  const controls = card?.querySelector("[data-stage-controls]");
  const status = card?.querySelector("[data-stage-status]");
  const state = { localUrl: null };

  const viewer = new SkinViewer({
    canvas,
    pixelRatio: "match-device",
    model: "auto-detect",
    fov: NAME_MC_CAMERA.fov,
    zoom: NAME_MC_CAMERA.zoom,
    enableControls: true,
    preserveDrawingBuffer: true,
  });
  const stageKit = new StageKit(viewer, canvas);
  const resizeObserver = new ResizeObserver(() => resizeViewer(canvas, viewer));

  canvas.dataset.engine = "skinview3d-namemc";
  canvas.dataset.skinSource = DEFAULT_STEVE_SKIN;
  canvas.dataset.skinKind = "default";
  canvas.dataset.skinModel = "default";

  configureViewer(viewer);
  stageKit.update(readStageOptions(controls));
  loadDefaultSteveSkin(canvas, viewer, stageKit, status);
  resizeViewer(canvas, viewer);
  resizeObserver.observe(viewport ?? canvas);

  if (controls instanceof HTMLFormElement) {
    bindStageControls(controls, canvas, viewer, stageKit, status, state);
  }

  return () => {
    resizeObserver.disconnect();
    revokeLocalSkin(state);
    stageKit.dispose();
    viewer.dispose();
  };
}

function configureViewer(viewer) {
  viewer.background = null;
  viewer.globalLight.intensity = 3.15;
  viewer.cameraLight.intensity = 0.45;
  viewer.autoRotate = false;
  viewer.animation = null;
  viewer.nameTag = null;
  viewer.playerObject.backEquipment = null;
  viewer.playerObject.skin.setInnerLayerVisible(true);
  viewer.playerObject.skin.setOuterLayerVisible(true);
  viewer.playerObject.rotation.set(NAME_MC_CAMERA.pitch, NAME_MC_CAMERA.yaw, 0);
  viewer.playerWrapper.rotation.set(0, 0, 0);
  viewer.controls.enableDamping = true;
  viewer.controls.enablePan = false;
  viewer.controls.minDistance = 18;
  viewer.controls.maxDistance = 78;
  viewer.controls.target.set(0, 6, 0);
  viewer.controls.update();
}

async function loadDefaultSteveSkin(canvas, viewer, stageKit, status) {
  try {
    await viewer.loadSkin(createDefaultSteveSkin(), { model: "default", ears: false });
    viewer.loadCape(null);
    viewer.loadEars(null);
    viewer.playerObject.backEquipment = null;
    viewer.playerObject.skin.visible = true;
    resetPlayerPose(viewer);
    stageKit.refreshAttachments();
    viewer.render();
    canvas.closest(".stage-viewport")?.classList.add("is-loaded");
    setStatus(status, "Default Steve preview rendered", "ready");
  } catch (error) {
    setStatus(status, `Default Steve failed: ${error.message || "skin texture error"}`, "error");
  }
}

function bindStageControls(controls, canvas, viewer, stageKit, status, state) {
  const sourceInput = controls.elements.namedItem("skinSource");
  const kindSelect = controls.elements.namedItem("skinKind");
  const modelSelect = controls.elements.namedItem("skinModel");
  const fileInput = controls.elements.namedItem("skinFile");

  controls.addEventListener("input", (event) => {
    if (!isStageOptionElement(event.target)) return;
    stageKit.update(readStageOptions(controls));
    viewer.render();
  });

  controls.addEventListener("change", (event) => {
    if (!isStageOptionElement(event.target)) return;
    stageKit.update(readStageOptions(controls));
    viewer.render();
  });

  controls.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!(sourceInput instanceof HTMLInputElement)) return;
    const source = sourceInput.value.trim();
    if (!source) {
      setStatus(status, "Enter a player, UUID, or PNG URL.", "error");
      return;
    }

    revokeLocalSkin(state);
    loadRemoteSkin(canvas, viewer, stageKit, status, {
      source,
      kind: selectValue(kindSelect, "auto"),
      model: selectValue(modelSelect, "auto-detect"),
    });
  });

  fileInput?.addEventListener("change", async (event) => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    if (!file) return;

    if (file.type && file.type !== "image/png") {
      setStatus(status, "Only Minecraft skin PNG files can be imported.", "error");
      return;
    }

    revokeLocalSkin(state);
    state.localUrl = URL.createObjectURL(file);
    canvas.dataset.skinSource = file.name;
    canvas.dataset.skinKind = "file";
    canvas.dataset.skinModel = selectValue(modelSelect, "auto-detect");
    await loadSkinSource(viewer, stageKit, state.localUrl, selectValue(modelSelect, "auto-detect"), status, "local PNG");
  });
}

async function loadRemoteSkin(canvas, viewer, stageKit, status, options) {
  const { source, kind, model } = options;
  canvas.dataset.skinSource = source;
  canvas.dataset.skinKind = kind;
  canvas.dataset.skinModel = model;

  const proxied = `/api/skin?kind=${encodeURIComponent(kind)}&source=${encodeURIComponent(source)}`;
  await loadSkinSource(viewer, stageKit, proxied, model, status, skinLabel(kind, source));
}

async function loadSkinSource(viewer, stageKit, source, model, status, label) {
  setStatus(status, `Loading ${label}...`, "loading");
  try {
    await viewer.loadSkin(source, { model, ears: false });
    viewer.loadCape(null);
    viewer.loadEars(null);
    viewer.playerObject.backEquipment = null;
    viewer.playerObject.skin.visible = true;
    resetPlayerPose(viewer);
    stageKit.refreshAttachments();
    viewer.render();
    viewer.canvas.closest(".stage-viewport")?.classList.add("is-loaded");
    setStatus(status, `${label} rendered`, "ready");
  } catch (error) {
    viewer.loadSkin(createDefaultSteveSkin(), { model: "default", ears: false });
    resetPlayerPose(viewer);
    stageKit.refreshAttachments();
    viewer.render();
    viewer.canvas.dataset.skinSource = DEFAULT_STEVE_SKIN;
    viewer.canvas.dataset.skinKind = "default";
    viewer.canvas.dataset.skinModel = "default";
    viewer.canvas.closest(".stage-viewport")?.classList.add("is-loaded");
    setStatus(status, `Skin load failed; showing default Steve. ${error.message || "check the source"}`, "error");
  }
}

function resetPlayerPose(viewer) {
  viewer.playerObject.resetJoints();
  viewer.playerObject.rotation.set(NAME_MC_CAMERA.pitch, NAME_MC_CAMERA.yaw, 0);
}

function resizeViewer(canvas, viewer) {
  const viewport = canvas.closest(".stage-viewport");
  const rect = viewport?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width || viewport?.clientWidth || canvas.clientWidth || 560));
  const height = Math.max(320, Math.round(rect.height || viewport?.clientHeight || canvas.clientHeight || 420));
  setViewerRenderSize(viewer, width, height);
  viewer.fov = NAME_MC_CAMERA.fov;
  viewer.zoom = NAME_MC_CAMERA.zoom;
  viewer.controls.target.set(0, 6, 0);
  viewer.controls.update();
  viewer.render();
}

function setViewerRenderSize(viewer, width, height) {
  viewer.camera.aspect = width / height;
  viewer.camera.updateProjectionMatrix();
  viewer.renderer.setSize(width, height, false);
  viewer.canvas.style.removeProperty("width");
  viewer.canvas.style.removeProperty("height");
  viewer.composer.setSize(width, height);
  viewer.fxaaPass.uniforms.resolution.value.x = 1 / (width * window.devicePixelRatio);
  viewer.fxaaPass.uniforms.resolution.value.y = 1 / (height * window.devicePixelRatio);
}

class StageKit {
  constructor(viewer, canvas) {
    this.viewer = viewer;
    this.canvas = canvas;
    this.stageRoot = new Group();
    this.stageRoot.name = "mc-stagekit-root";
    this.baseRoot = new Group();
    this.baseRoot.name = "mc-stagekit-base";
    this.stageRoot.add(this.baseRoot);
    this.viewer.scene.add(this.stageRoot);
    this.attachmentGroups = [];
    this.glintMaterials = [];
    this.disposables = [];
    this.glintTexture = createGlintTexture();
    this.options = { ...DEFAULT_STAGE_OPTIONS };
    this.glintAnimation = window.requestAnimationFrame((time) => this.animateGlint(time));
  }

  update(options) {
    this.options = { ...this.options, ...options };
    this.canvas.dataset.armorKit = this.options.armorKit;
    this.canvas.dataset.handItem = this.options.handItem;
    this.canvas.dataset.stageBase = this.options.stageBase;
    this.canvas.dataset.enchantGlint = String(this.options.enchantGlint);
    this.rebuild();
  }

  refreshAttachments() {
    this.rebuild();
  }

  rebuild() {
    this.clearDynamicObjects();
    this.buildBase();
    this.buildArmor();
    this.buildWeapon();
  }

  buildBase() {
    this.baseRoot.visible = this.options.stageBase !== "none";
    if (!this.baseRoot.visible) return;

    const colors = BASE_PALETTE[this.options.stageBase] ?? BASE_PALETTE.obsidian_3x3;
    const cubeGeometry = new BoxGeometry(7.8, 1.6, 7.8);
    this.trackGeometry(cubeGeometry);

    for (let z = -1; z <= 1; z += 1) {
      for (let x = -1; x <= 1; x += 1) {
        const material = this.createMaterial({
          color: colors[(x + z + 4) % colors.length],
          roughness: 0.86,
          metalness: 0.02,
        });
        const cube = new Mesh(cubeGeometry, material);
        cube.position.set(x * 7.9, -16.95 + ((x + z) % 2) * 0.06, z * 7.9);
        cube.name = `${this.options.stageBase}-block`;
        this.baseRoot.add(cube);

        const cap = new Mesh(
          new BoxGeometry(7.72, 0.08, 7.72),
          this.createMaterial({ color: "#303746", roughness: 0.72, metalness: 0.05 })
        );
        cap.position.set(x * 7.9, -16.1, z * 7.9);
        cap.name = "stage-base-pixel-edge";
        this.baseRoot.add(cap);
        this.trackGeometry(cap.geometry);
      }
    }
  }

  buildArmor() {
    const kit = this.options.armorKit;
    if (kit === "none") return;

    const palette = ARMOR_PALETTE[kit] ?? ARMOR_PALETTE.diamond;
    const skin = this.viewer.playerObject.skin;
    const slim = skin.modelType === "slim";

    this.attachBox(skin.head, "armor-helmet", [8.85, 8.85, 8.85], [0, 4, 0], palette, true);
    this.attachBox(skin.body, "armor-chest", [8.95, 12.85, 4.95], [0, 0, 0], palette, true);
    this.attachBox(skin.rightArm, "armor-right-arm", [slim ? 3.95 : 4.95, 12.8, 4.95], [slim ? -0.5 : -1, -4, 0], palette, true);
    this.attachBox(skin.leftArm, "armor-left-arm", [slim ? 3.95 : 4.95, 12.8, 4.95], [slim ? 0.5 : 1, -4, 0], palette, true);
    this.attachBox(skin.rightLeg, "armor-right-leg", [4.78, 12.75, 4.78], [0, -6, 0], palette, true);
    this.attachBox(skin.leftLeg, "armor-left-leg", [4.78, 12.75, 4.78], [0, -6, 0], palette, true);
  }

  buildWeapon() {
    if (this.options.handItem !== "diamond_sword") return;

    const rightArm = this.viewer.playerObject.skin.rightArm;
    const weapon = new Group();
    weapon.name = "hand-item-diamond_sword";
    weapon.position.set(-1.2, -10.7, -2.8);
    weapon.rotation.set(0.55, 0.1, -0.78);
    rightArm.add(weapon);
    this.attachmentGroups.push({ parent: rightArm, group: weapon });

    this.addWeaponBox(weapon, [0.82, 7.8, 0.34], [0, 4.15, 0], "#4deeea", true, "diamond_sword-blade");
    this.addWeaponBox(weapon, [1.15, 1.1, 0.42], [0, 0.52, 0], "#d8fffb", true, "diamond_sword-tip");
    this.addWeaponBox(weapon, [4.2, 0.72, 0.72], [0, -0.24, 0], "#26313e", false, "diamond_sword-guard");
    this.addWeaponBox(weapon, [0.78, 3.15, 0.78], [0, -1.95, 0], "#1c242e", false, "diamond_sword-grip");
    this.addWeaponBox(weapon, [1.42, 0.82, 0.82], [0, -3.78, 0], "#2aa8b7", true, "diamond_sword-pommel");
  }

  addWeaponBox(parent, size, position, color, glint, name) {
    const material = this.createMaterial({ color, roughness: 0.46, metalness: 0.18 });
    const mesh = new Mesh(new BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.name = name;
    parent.add(mesh);
    this.trackGeometry(mesh.geometry);
    if (glint) this.addGlint(parent, size.map((value) => value + 0.05), position, name);
  }

  attachBox(parent, name, size, position, palette, glint) {
    const group = new Group();
    group.name = name;
    parent.add(group);
    this.attachmentGroups.push({ parent, group });

    const material = this.createMaterial({
      color: palette.primary,
      roughness: palette.roughness,
      metalness: palette.metalness,
    });
    const shell = new Mesh(new BoxGeometry(...size), material);
    shell.position.set(...position);
    shell.name = `${name}-shell`;
    group.add(shell);
    this.trackGeometry(shell.geometry);

    const edge = new Mesh(
      new BoxGeometry(size[0] * 0.98, 0.1, size[2] * 1.02),
      this.createMaterial({ color: palette.edge, roughness: 0.5, metalness: 0.12 })
    );
    edge.position.set(position[0], position[1] + size[1] / 2 - 0.26, position[2]);
    edge.name = `${name}-highlight`;
    group.add(edge);
    this.trackGeometry(edge.geometry);

    if (glint) this.addGlint(group, size.map((value) => value + 0.08), position, name);
  }

  addGlint(parent, size, position, name) {
    if (!this.options.enchantGlint) return;
    const material = new MeshStandardMaterial({
      color: new Color("#a463ff"),
      map: this.glintTexture,
      transparent: true,
      opacity: 0.18,
      blending: AdditiveBlending,
      depthWrite: false,
      roughness: 0.38,
      metalness: 0.05,
    });
    const mesh = new Mesh(new BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.name = `${name}-enchantment-glint`;
    parent.add(mesh);
    this.glintMaterials.push(material);
    this.trackGeometry(mesh.geometry);
    this.disposables.push(material);
  }

  createMaterial(options) {
    const material = new MeshStandardMaterial(options);
    this.disposables.push(material);
    return material;
  }

  trackGeometry(geometry) {
    this.disposables.push(geometry);
  }

  clearDynamicObjects() {
    for (const { parent, group } of this.attachmentGroups) {
      parent.remove(group);
    }
    this.attachmentGroups = [];
    while (this.baseRoot.children.length) {
      this.baseRoot.remove(this.baseRoot.children[0]);
    }
    for (const disposable of this.disposables) {
      disposable.dispose?.();
    }
    this.disposables = [];
    this.glintMaterials = [];
  }

  dispose() {
    window.cancelAnimationFrame(this.glintAnimation);
    this.clearDynamicObjects();
    this.viewer.scene.remove(this.stageRoot);
    this.glintTexture.dispose();
  }

  animateGlint(time) {
    const progress = time * 0.00018;
    this.glintTexture.offset.set(progress % 1, (progress * 0.55) % 1);
    this.glintAnimation = window.requestAnimationFrame((nextTime) => this.animateGlint(nextTime));
  }
}

function createDefaultSteveSkin() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, 64, 64);

  const skin = "#b9825d";
  const skinShade = "#8f5f46";
  const hair = "#3a2518";
  const hairShade = "#24170f";
  const shirt = "#2e9f9f";
  const shirtShade = "#1f6e75";
  const pants = "#3a4f9a";
  const pantsShade = "#283774";
  const shoe = "#252b35";
  const eye = "#2a3140";

  drawBoxUv(ctx, 0, 0, 8, 8, 8, {
    top: hair,
    bottom: skinShade,
    left: skinShade,
    front: skin,
    right: skinShade,
    back: hairShade,
  });
  ctx.fillStyle = hair;
  ctx.fillRect(8, 9, 8, 2);
  ctx.fillRect(8, 11, 2, 3);
  ctx.fillStyle = eye;
  ctx.fillRect(10, 11, 1, 1);
  ctx.fillRect(14, 11, 1, 1);

  drawBoxUv(ctx, 16, 16, 8, 12, 4, {
    top: shirt,
    bottom: shirtShade,
    left: shirtShade,
    front: shirt,
    right: shirtShade,
    back: shirtShade,
  });
  drawBoxUv(ctx, 40, 16, 4, 12, 4, {
    top: skin,
    bottom: skinShade,
    left: skinShade,
    front: skin,
    right: skinShade,
    back: skinShade,
  });
  drawBoxUv(ctx, 32, 48, 4, 12, 4, {
    top: skin,
    bottom: skinShade,
    left: skinShade,
    front: skin,
    right: skinShade,
    back: skinShade,
  });
  ctx.fillStyle = shirt;
  ctx.fillRect(44, 20, 4, 4);
  ctx.fillRect(36, 52, 4, 4);

  drawBoxUv(ctx, 0, 16, 4, 12, 4, {
    top: pants,
    bottom: shoe,
    left: pantsShade,
    front: pants,
    right: pantsShade,
    back: pantsShade,
  });
  drawBoxUv(ctx, 16, 48, 4, 12, 4, {
    top: pants,
    bottom: shoe,
    left: pantsShade,
    front: pants,
    right: pantsShade,
    back: pantsShade,
  });

  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(40, 32, 16, 16);
  ctx.fillRect(0, 32, 16, 16);
  ctx.fillRect(48, 48, 16, 16);
  return canvas;
}

function drawBoxUv(ctx, u, v, w, h, d, colors) {
  fillPixelRect(ctx, u + d, v, w, d, colors.top);
  fillPixelRect(ctx, u + d + w, v, w, d, colors.bottom);
  fillPixelRect(ctx, u, v + d, d, h, colors.left);
  fillPixelRect(ctx, u + d, v + d, w, h, colors.front);
  fillPixelRect(ctx, u + d + w, v + d, d, h, colors.right);
  fillPixelRect(ctx, u + d + w + d, v + d, w, h, colors.back);
}

function fillPixelRect(ctx, x, y, width, height, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}

function createGlintTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 32, 32);
  ctx.fillStyle = "rgba(164, 99, 255, 0.16)";
  for (let offset = -32; offset < 64; offset += 10) {
    ctx.fillRect(offset, 0, 3, 32);
    ctx.fillRect(offset + 4, 0, 1, 32);
  }
  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function readStageOptions(controls) {
  if (!(controls instanceof HTMLFormElement)) return { ...DEFAULT_STAGE_OPTIONS };
  return {
    armorKit: selectValue(controls.elements.namedItem("armorKit"), DEFAULT_STAGE_OPTIONS.armorKit),
    handItem: selectValue(controls.elements.namedItem("handItem"), DEFAULT_STAGE_OPTIONS.handItem),
    stageBase: selectValue(controls.elements.namedItem("stageBase"), DEFAULT_STAGE_OPTIONS.stageBase),
    enchantGlint: checkboxValue(controls.elements.namedItem("enchantGlint"), DEFAULT_STAGE_OPTIONS.enchantGlint),
  };
}

function isStageOptionElement(element) {
  if (!(element instanceof HTMLSelectElement) && !(element instanceof HTMLInputElement)) return false;
  return ["armorKit", "handItem", "stageBase", "enchantGlint"].includes(element.name);
}

function setStatus(status, text, tone) {
  if (!status) return;
  status.textContent = text;
  status.dataset.tone = tone;
}

function selectValue(element, fallback) {
  return element instanceof HTMLSelectElement ? element.value : fallback;
}

function checkboxValue(element, fallback) {
  return element instanceof HTMLInputElement ? element.checked : fallback;
}

function revokeLocalSkin(state) {
  if (!state.localUrl) return;
  URL.revokeObjectURL(state.localUrl);
  state.localUrl = null;
}

function skinLabel(kind, source) {
  if (kind === "player") return `player ${source}`;
  if (kind === "uuid") return "UUID skin";
  if (kind === "url") return "PNG URL";
  return `skin source ${source}`;
}
