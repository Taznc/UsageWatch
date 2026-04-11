/**
 * Renders a 144×144 key image as an SVG data URI.
 *
 * The Stream Deck software uses Chromium internally, so SVG data URIs render
 * correctly without requiring any native image libraries.
 */

function bgColor(pct: number): string {
  if (pct >= 90) return "#5c1111";
  if (pct >= 75) return "#5c4800";
  return "#0f4a1f";
}

function barColor(pct: number): string {
  if (pct >= 90) return "#ff5555";
  if (pct >= 75) return "#ffd93d";
  return "#55cc77";
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderUsageKey(label: string, pct: number | null): string {
  const size = 144;

  if (pct === null) {
    // Offline / not yet polled state
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" fill="#111122" rx="8"/>
      <text x="72" y="52" font-size="14" font-weight="bold" fill="#666688"
            text-anchor="middle" font-family="system-ui,sans-serif">${escapeXml(label)}</text>
      <text x="72" y="82" font-size="24" font-weight="bold" fill="#444466"
            text-anchor="middle" font-family="system-ui,sans-serif">—</text>
      <text x="72" y="108" font-size="11" fill="#444455"
            text-anchor="middle" font-family="system-ui,sans-serif">offline</text>
    </svg>`;
    return svgToDataUri(svg);
  }

  const rounded = Math.round(pct);
  const bg = bgColor(pct);
  const bar = barColor(pct);

  // Progress bar dimensions
  const barW = 110;
  const barH = 10;
  const barX = (size - barW) / 2;
  const barY = 114;
  const fillW = pct === 0 ? 0 : Math.max(2, Math.round((pct / 100) * barW));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" fill="${bg}" rx="8"/>
    <text x="72" y="30" font-size="15" font-weight="600" fill="rgba(255,255,255,0.65)"
          text-anchor="middle" font-family="system-ui,sans-serif">${escapeXml(label)}</text>
    <text x="72" y="92" font-size="48" font-weight="bold" fill="#ffffff"
          text-anchor="middle" font-family="system-ui,sans-serif">${rounded}%</text>
    <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="5" fill="rgba(0,0,0,0.4)"/>
    <rect x="${barX}" y="${barY}" width="${fillW}" height="${barH}" rx="5" fill="${bar}"/>
  </svg>`;

  return svgToDataUri(svg);
}

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
