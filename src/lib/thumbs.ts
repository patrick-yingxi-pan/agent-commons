/** Deterministic gradient for a photo/image, so the same item shows the same
 *  color everywhere it appears (picker, composer thumbnail, preview panel). */
export const PHOTO_GRADIENTS = [
  'bg-gradient-to-br from-[#f3d9c9] to-[#cf8f6e]',
  'bg-gradient-to-br from-[#cfe0e6] to-[#86a7b3]',
  'bg-gradient-to-br from-[#e3dcc9] to-[#b3a786]',
  'bg-gradient-to-br from-[#e6cfd9] to-[#b386a0]',
]

export function gradientFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PHOTO_GRADIENTS[h % PHOTO_GRADIENTS.length]
}
