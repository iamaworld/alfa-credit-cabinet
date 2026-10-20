// Иконки из открытого набора Альфа-Банка @alfalab/icons-glyph 2.293.0 (лицензия MIT, см. THIRD_PARTY_NOTICES.md).
// Хранятся только контуры SVG, React-обёртка пакета не нужна.
const PATHS = {
  "wallet": [
    {
      "d": "M18.283 6.619L5.859 7.734c-.69.088-.859.493-.859.99V9h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8.724C3 7.231 3.606 6 5.576 5.754l10.534-.946a2 2 0 012.158 1.71l.015.1zM15 15.01c0 1.12.891 1.989 2.011 1.989S19 16.131 19 15.011 18.131 13 17.011 13A2 2 0 0015 15.011z",
      "evenodd": true
    }
  ],
  "tools": [
    {
      "d": "M5.33 3.27a3.5 3.5 0 014.472 4.475L20.647 18.59l-2.122 2.12L7.68 9.868a3.5 3.5 0 01-4.472-4.474L5.444 7.63a1.5 1.5 0 102.121-2.121l-2.236-2.24.001.002zm10.367 1.885l3.182-1.768L20.293 4.8l-1.768 3.182-1.768.354-2.12 2.12-1.415-1.413 2.121-2.121.354-1.768zm-7.071 7.778l2.121 2.122-4.95 4.95A1.5 1.5 0 013.58 17.99l.097-.107 4.95-4.95h-.001z",
      "evenodd": false
    }
  ],
  "arrowsCw": [
    {
      "d": "M15 8h2.277c-1.5-2-3.121-3-5.5-3C8.606 5 6 6.5 5.067 12H3c.5-6 4.494-9 8.777-9 2.827 0 5.5 1.5 7 3.5L19 4h2v6h-6V8zm-6 8H6.723c1.5 2 3.121 3 5.5 3 3.171 0 5.777-1.5 6.71-7H21c-.5 6-4.494 9-8.777 9-2.827 0-5.5-1.5-7-3.5L5 20H3v-6h6v2z",
      "evenodd": false
    }
  ],
  "bell": [
    {
      "d": "M3.404 9.171L15.233 21l.926-.669.188-1.065a7 7 0 011.943-3.73l1.292-1.293a6.2 6.2 0 001.822-4.416c0-3.53-3.312-6.827-6.827-6.827a6.2 6.2 0 00-4.416 1.822L8.868 6.114a7 7 0 01-3.73 1.943l-1.064.188-.67.926zm2.663 9.078a2.498 2.498 0 003.534 0l-3.534-3.533a2.498 2.498 0 000 3.533z",
      "evenodd": false
    }
  ],
  "check": [
    {
      "d": "M20 7.519L9.903 17 5 12.327l1.448-1.503 3.47 3.308L18.569 6 20 7.519z",
      "evenodd": true
    }
  ],
  "cross": [
    {
      "d": "M10.586 12L6 16.5 7.5 18l4.5-4.586L16.5 18l1.5-1.5-4.586-4.5L18 7.5 16.5 6 12 10.586 7.5 6 6 7.5l4.586 4.5z",
      "evenodd": false
    }
  ],
  "exclamation": [
    {
      "d": "M13.7 4h-3.4l.7 10h2l.7-10zM12 20.5a2 2 0 100-4 2 2 0 000 4z",
      "evenodd": false
    }
  ],
  "house": [
    {
      "d": "M3.586 13c-.914 0-1.349-1.125-.673-1.74l8.077-7.343a1.5 1.5 0 012.018 0l8.078 7.343c.676.615.24 1.74-.673 1.74h-1.414v6.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 19.5V13H3.586zM10 13h4v5h-4v-5z",
      "evenodd": true
    },
    {
      "d": "M16 3.545h2V7l-2-2V3.545z",
      "evenodd": false
    }
  ],
  "document": [
    {
      "d": "M5 2a1 1 0 00-1 1v18a1 1 0 001 1h14a1 1 0 001-1V9.815a3 3 0 00-3.299-2.985l-1.458.146a.2.2 0 01-.219-.22L15.17 5.3A3 3 0 0012.185 2H5z",
      "evenodd": true
    }
  ],
  "door": [
    {
      "d": "M10 3.344a1 1 0 011.287-.957l8.143 2.442a.8.8 0 01.57.767v12.81a.8.8 0 01-.57.765l-8.143 2.443A1 1 0 0110 20.656V3.344zM14 12a1 1 0 11-2 0 1 1 0 012 0z",
      "evenodd": true
    },
    {
      "d": "M5 5a1 1 0 00-1 1v12a1 1 0 001 1h3V5H5z",
      "evenodd": false
    }
  ],
  "info": [
    {
      "d": "M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 15v-6h-2v6h2zm-1-8a1.274 1.274 0 100-2.548A1.274 1.274 0 0012 9z",
      "evenodd": true
    }
  ],
  "warn": [
    {
      "d": "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm-1-9V7h2v6h-2zm0 4v-2h2v2h-2z",
      "evenodd": true
    }
  ],
  "calendar": [
    {
      "d": "M9 12v2H7v-2h2zm0 6v-2H7v2h2zm2-6h2v2h-2v-2zm2 4h-2v2h2v-2zm4-4v2h-2v-2h2z",
      "evenodd": false
    },
    {
      "d": "M6 2h2v2h8V2h2v2h3v16a3 3 0 01-3 3H6a3 3 0 01-3-3V4h3V2zm13 7H5v11a1 1 0 001 1h12a1 1 0 001-1V9z",
      "evenodd": true
    }
  ],
  "lightning": [
    {
      "d": "M6.5 12l2-9h7l-3 7 5 1-10 10 3-8-4-1z",
      "evenodd": false
    }
  ],
  "chevronRight": [
    {
      "d": "M14 12l-5.5 5.5L10 19l7-7-7-7-1.5 1.5L14 12z",
      "evenodd": false
    }
  ],
  "arrowUp": [
    {
      "d": "M11 7.5V19h2V7.5l3.5 3.5L18 9.5 12 4 6 9.5 7.5 11 11 7.5z",
      "evenodd": false
    }
  ],
  "arrowDown": [
    {
      "d": "M11 16.5V5h2v11.5l3.5-3.5 1.5 1.5-6 5.5-6-5.5L7.5 13l3.5 3.5z",
      "evenodd": false
    }
  ],
  "minus": [
    {
      "d": "M3 11h18v2H3v-2z",
      "evenodd": false
    }
  ]
};

export function icon(name, size = 24) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('fill', 'currentColor'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  for (const p of PATHS[name] || []) {
    const el = document.createElementNS(ns, 'path');
    el.setAttribute('d', p.d);
    if (p.evenodd) { el.setAttribute('fill-rule', 'evenodd'); el.setAttribute('clip-rule', 'evenodd'); }
    svg.append(el);
  }
  return svg;
}

// Знак Альфа-Банка из @alfalab/icons-logotype 2.37.0 (AlfaBankLIcon), используется с разрешения для прототипа хакатона
const ALFA_LOGO = 'M10.471 4.886l-3.081 8.89h6.106l-2.91-8.89h-.115zM10.7 0c2.474 0 3.196 1.432 3.822 3.245L21 22h-4.794l-1.455-4.459H6.077L4.508 22H0L6.798 3.245C7.458 1.426 8.226 0 10.7 0zM0 27h21v5H0v-5z';
export function alfaLogo(height = 20) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 21 32'); svg.setAttribute('height', height); svg.setAttribute('width', Math.round(height * 21 / 32));
  svg.setAttribute('fill', 'currentColor'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Альфа-Банк');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ALFA_LOGO); p.setAttribute('fill-rule', 'evenodd'); p.setAttribute('clip-rule', 'evenodd');
  svg.append(p);
  return svg;
}
