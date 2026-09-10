function assertDimension(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > 8000) throw new Error(`Invalid SVG ${name}`)
}

function assertUnits(units) {
  if (typeof units !== 'string' || !/^[a-zA-Z%]*$/.test(units)) throw new Error('Invalid SVG units')
}

/** A deterministic, self-contained SVG with styled shapes and local defs. */
export function svgFixture(width = 160, height = 80, { viewBoxOnly = false, units = 'px' } = {}) {
  assertDimension(width, 'width')
  assertDimension(height, 'height')
  if (typeof viewBoxOnly !== 'boolean') throw new Error('Invalid SVG viewBoxOnly')
  assertUnits(units)
  const half = width / 2
  const dimensions = viewBoxOnly ? '' : ` width="${width}${units}" height="${height}${units}"`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"${dimensions} viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="local-wash" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f0461e"/>
      <stop offset="1" stop-color="#1e46f0"/>
    </linearGradient>
    <clipPath id="left-half"><rect x="0" y="0" width="${half}" height="${height}"/></clipPath>
  </defs>
  <style>
    .left { fill: #f0461e; }
    .right { fill: #1e46f0; }
    .wash { fill: url(#local-wash); opacity: .08; }
  </style>
  <rect class="left" x="0" y="0" width="${half}" height="${height}" clip-path="url(#left-half)"/>
  <rect class="right" x="${half}" y="0" width="${width - half}" height="${height}"/>
  <rect class="wash" x="0" y="0" width="${width}" height="${height}"/>
</svg>
`
  return Buffer.from(svg, 'utf8')
}
