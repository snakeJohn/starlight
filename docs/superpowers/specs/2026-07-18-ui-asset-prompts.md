# GPT-Image-2 素材提示词（Starlight iOS 26 Liquid Glass）

日期: 2026-07-18  
用途: 为 Starlight 插件 UI 生成品牌与导航可选位图资产。当前实现已使用内联 SVG 导航图标与 `static/icon.svg`，下列提示词供用户在 GPT-Image-2（或同类模型）中生成更高保真素材后替换。

## 通用风格约束（所有提示词共用）

- Style: Apple iOS 26 Liquid Glass, soft translucent materials, soft specular highlights, subtle frosted blur, clean SF Pro–like geometry
- Palette: system blue `#0A84FF` as accent; cool gray-white glass; soft mesh gradients (lavender-blue, cyan mist)
- Avoid: emoji, glossy plastic 3D cartoon, neon cyberpunk, heavy drop shadows, marketing hero text
- Output: transparent or soft rounded square safe for plugin chrome; dense tools UI, not consumer marketing

---

## 1. 插件品牌图标 `icon.svg` 替换位图

**File target:** `static/icon.png` or regenerate `static/icon.svg`  
**Size:** 1024×1024, circular crop friendly  

```text
App icon for a self-hosted music bridge plugin named Starlight.
Minimal speaker silhouette centered on a circular frosted glass disc.
iOS 26 Liquid Glass aesthetic: translucent blue-white gradient (#E8F1FF to #DCEBFF),
soft specular highlight top-left, subtle inner rim light.
Speaker body uses Apple system blue (#0A84FF) with gentle vertical gradient,
rounded rectangle body, small LED dot near top, concentric speaker ring at lower half.
Flat modern vector look, no text, no logo lettering, no photoreal materials.
Clean edges suitable for 256px downscale. Square canvas, circular icon mask.
```

---

## 2. 侧栏品牌 Mark（可选）

**File target:** `static/assets/brand-mark.png`  
**Size:** 256×256  

```text
Small monochrome-friendly brand mark for sidebar: letter “S” abstracted as a light
beam refracted through glass, or a simplified star-point fused with a speaker cone.
iOS Liquid Glass, single accent blue on translucent white glass tile with 12–16px
corner radius. High legibility at 42×42 CSS pixels. No text labels.
```

---

## 3. Tab 图标套件（可选，替换 app.js SVG）

**File target:** `static/assets/tabs/{search,speaker,songlists,rankings,sources,logs,automation}.png`  
**Size:** 128×128 each, monochrome template (black glyphs on transparent)  

```text
Set of 7 monoline SF Symbols-style tab icons for a dense music tools app:
1) search — magnifying glass
2) speaker — smart speaker rectangle with ring
3) songlists — three horizontal lines with dots (playlist)
4) rankings — three vertical bars ascending
5) sources — plus-in-circle or nodes merge
6) logs — document with list lines
7) automation — gear with small spark arc
Unified stroke weight ~1.75, rounded caps, Apple HIG tab bar style,
black glyph only on transparent background, no fill color, no gradients.
```

---

## 4. 空状态插画（可选）

**File target:** `static/assets/empty-music.png`  
**Size:** 768×512  

```text
Subtle empty-state illustration for a music tools plugin: floating glass card with
faint waveform and a small speaker silhouette, soft blue mesh background,
lots of negative space, no text. iOS 26 Liquid Glass, desaturated, professional.
Suitable behind Chinese UI captions “暂无结果”.
```

---

## 5. 全屏播放器背景 mesh（可选）

**File target:** `static/assets/player-mesh.png`  
**Size:** 1920×1080  

```text
Abstract soft gradient mesh for a fullscreen music player backdrop.
Deep navy and indigo with translucent cyan and system-blue light blooms,
very soft, low contrast, no hard shapes, no logos. Looks good under heavy blur
and dark overlay. Avoid rainbow or neon.
```

---

## 6. 洛雪同步卡片装饰（可选）

**File target:** `static/assets/lx-sync-badge.png`  
**Size:** 256×256  

```text
Small frosted glass badge icon: two playlist cards with a soft circular arrows
sync glyph, Apple system blue accents, Liquid Glass material, transparent
background. Tool-UI density, not marketing mascot.
```

---

## Integration notes

1. Prefer SVG / monochrome template icons so host theme colors can tint via CSS `currentColor`.
2. Do not commit third-party brand marks (洛雪 / Songloft official logos) without license.
3. Keep paths relative under `static/` for Songloft plugin base-path compatibility.
4. Current production chrome does **not** require these bitmaps; they are optional polish.
