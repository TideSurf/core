const fs = require('fs');

const file = 'website/landing/index.html';
let content = fs.readFileSync(file, 'utf8');

// Remove canvas
content = content.replace(/<canvas id="tide-canvas"[^>]*><\/canvas>\n*/g, '');

// Remove watermark
content = content.replace(/<div class="hero-watermark"[\s\S]*?<\/div>\n*/, '');

// Remove floating tags
content = content.replace(/<div class="floating-tags" id="floating-tags"><\/div>\n*/g, '');

// Replace slot machine with static terminal block
const slotMachineRegex = /<div class="slot-machine">[\s\S]*?<\/div>/;
const staticCode = `<div class="terminal-block" style="display: flex; align-items: center; gap: 8px;">
                            <span style="color: var(--accent); user-select: none;">$</span>
                            <code>bun add @tidesurf/core</code>
                        </div>`;
content = content.replace(slotMachineRegex, staticCode);

fs.writeFileSync(file, content);
