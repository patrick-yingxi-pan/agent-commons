/** A small sunburst glyph evoking the Claude mark — purely decorative. */
export function ClaudeMark({ size = 22 }: { size?: number }) {
  const rays = Array.from({ length: 12 })
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="text-accent"
    >
      {rays.map((_, i) => {
        const angle = (i * 360) / rays.length
        return (
          <rect
            key={i}
            x="11.1"
            y="2.4"
            width="1.8"
            height="7.2"
            rx="0.9"
            fill="currentColor"
            transform={`rotate(${angle} 12 12)`}
          />
        )
      })}
    </svg>
  )
}
