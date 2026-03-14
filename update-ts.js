const fs = require('fs');

const file = 'website/landing/src/main.ts';
let content = fs.readFileSync(file, 'utf8');

// 1. Remove Tide Animation Section
content = content.replace(/\/\/ ── Tide Animation ──[\s\S]*?\/\/ ── Floating Tags ──/g, '// ── Floating Tags ──');

// 2. Remove Floating Tags Section
content = content.replace(/\/\/ ── Floating Tags ──[\s\S]*?\/\/ ── Mouse Parallax ──/g, '// ── Mouse Parallax ──');

// 3. Remove Mouse Parallax Section
content = content.replace(/\/\/ ── Mouse Parallax ──[\s\S]*?\/\/ ── Slot Machine ──/g, '// ── Slot Machine ──');

// 4. Remove Slot Machine Section
content = content.replace(/\/\/ ── Slot Machine ──[\s\S]*?\/\/ ── Showcase Carousel ──/g, '// ── Showcase Carousel ──');

// 5. Remove canvas/ctx from state
content = content.replace(/let canvas: HTMLCanvasElement \| null = null;\nlet ctx: CanvasRenderingContext2D \| null = null;\n/g, '');

// 6. Update init() to remove deleted function calls
content = content.replace(/  initTideAnimation\(\);\n  initFloatingTags\(\);\n  initMouseParallax\(\);\n/g, '');
content = content.replace(/  initSlotMachine\(\);\n/g, '');

// 7. Remove scroll morph references to floating tags
content = content.replace(/const floatingTags = document\.getElementById\("floating-tags"\);\n/g, '');
content = content.replace(/        \/\/ Floating tags: scroll parallax via CSS custom property\n        if \(floatingTags\) \{\n          floatingTags\.style\.setProperty\("--sy", `\$\{progress \* -150\}px`\);\n        \}\n/g, '');

fs.writeFileSync(file, content);
