/* ============================================================
   PORTRAIT — ASCII face that dissolves on mouse proximity
   ============================================================ */

const PORTRAIT_ROWS = [
  '          .:::::::.          ',
  '       .:%%@@@@@@%%:.        ',
  '     :%@@@@@@@@@@@@@@%:      ',
  '    %@@@@@@@@@@@@@@@@@@%     ',
  '   %@@@@@@@@@@@@@@@@@@@@%    ',
  '  %@@@@@@@@@@@@@@@@@@@@@@%   ',
  '  %@@@@@############@@@@@@%  ',
  '  %@@@@#            #@@@@@%  ',
  '  %@@@@#  [O]  [O]  #@@@@@%  ',
  '  %@@@@#            #@@@@@%  ',
  '  %@@@@#   ______   #@@@@@%  ',
  '  %@@@@@############@@@@@@%  ',
  '  %@@@@@@@@@@@@@@@@@@@@@@@%  ',
  '  %@@@@@@@@..@@@@..@@@@@@@%  ',
  '  %@@@@@@@@..@@@@..@@@@@@@%  ',
  '  %@@@@@@@@@@@@@@@@@@@@@@@%  ',
  '   %@@@@@@@@########@@@@@%   ',
  '    %@@@@@@@@@@@@@@@@@@@%    ',
  '     :%@@@@@@@@@@@@@@@%:     ',
  '        %%@@@@@@@@@%%        ',
  '           ::::::::          ',
];

const DISSOLVE_CHARS = '░▒▓█▄▀■□●◆◇★∷⁚⁙#@%+=~-:. ';

const WORD_FRAMES = [
  'PROJECTS',
  'DESIGN  ',
  'SYSTEMS ',
  'PRODUCT ',
  'RESEARCH',
  'STRATEGY',
];

class Portrait {
  constructor(el) {
    this.el = el;
    this.dissolve = 0;
    this.target = 0;
    this.tick = 0;
    this.wordPhase = 0; // 0-1 through WORD_FRAMES
  }

  update(dissolveTarget) {
    this.target = dissolveTarget;
    this.dissolve += (this.target - this.dissolve) * 0.04;
    this.tick++;
  }

  render() {
    const t = this.tick;
    const d = this.dissolve;
    const wordProgress = Math.max(0, (d - 0.55) / 0.45); // 0→1 after 55% dissolve

    const html = PORTRAIT_ROWS.map((row, ri) => {
      const chars = row.split('').map((ch, ci) => {
        // Perlin-ish noise via sin combos
        const noise = (Math.sin(t * 0.07 + ri * 4.1 + ci * 2.3) * 0.5 + 0.5) *
                      (Math.sin(t * 0.13 + ri * 1.7 + ci * 5.9) * 0.5 + 0.5);

        const threshold = d * (0.7 + 0.3 * noise);

        // Word mode — substitute characters with keyword letters
        if (wordProgress > 0.01 && ch !== ' ') {
          const wordIdx = ri % WORD_FRAMES.length;
          const wordChar = WORD_FRAMES[wordIdx][ci % WORD_FRAMES[wordIdx].length];
          if (noise < wordProgress && wordChar && wordChar !== ' ') {
            const glow = `color:#00F7FF;text-shadow:0 0 10px #00F7FF,0 0 20px rgba(0,247,255,0.4)`;
            return `<span style="${glow}">${wordChar}</span>`;
          }
        }

        // Dissolve — swap character
        if (noise < threshold && ch !== ' ') {
          const di = Math.floor(noise * DISSOLVE_CHARS.length);
          const dissolveChar = DISSOLVE_CHARS[di];
          const hue = d > 0.5 ? `color:#FF00AA;text-shadow:0 0 6px #FF00AA` : `color:#7A00FF;text-shadow:0 0 4px #7A00FF`;
          return `<span style="${hue}">${dissolveChar}</span>`;
        }

        // Default character coloring
        if (ch === '@') return `<span style="color:#D6D6FF">${ch}</span>`;
        if (ch === '%') return `<span style="color:rgba(214,214,255,0.65)">${ch}</span>`;
        if (ch === '#') return `<span style="color:rgba(0,247,255,0.75)">${ch}</span>`;
        if (ch === 'O') return `<span style="color:#00F7FF;text-shadow:0 0 8px #00F7FF">${ch}</span>`;
        if (ch === '[' || ch === ']') return `<span style="color:rgba(0,247,255,0.4)">${ch}</span>`;
        if (ch === '.') return `<span style="color:rgba(214,214,255,0.25)">${ch}</span>`;
        if (ch === ':') return `<span style="color:rgba(0,247,255,0.2)">${ch}</span>`;
        if (ch === '_') return `<span style="color:rgba(0,247,255,0.35)">${ch}</span>`;
        return ch === ' ' ? ' ' : `<span style="color:rgba(214,214,255,0.4)">${ch}</span>`;
      });
      return chars.join('');
    }).join('\n');

    this.el.innerHTML = html;
  }
}
