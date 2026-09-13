/**
 * Draws every app icon from one definition of the mark.
 *
 * The mark is the sidebar's: a near-black ¥ on the profit green. The ¥ is drawn
 * as strokes rather than typed as a character, so no icon depends on which fonts
 * happen to be installed on the machine that renders it.
 *
 * Run after changing the mark: `npm run icons`. The outputs are committed and
 * nothing in the build runs this, because it needs a browser to rasterise.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const GREEN = '#2dd4a7' // --color-profit
const INK = '#0b0d10' // --color-bg

/** ¥ in a 100-unit square: two arms meeting on the axis, a stem, two bars. */
const YEN = 'M31 19 L50 45 L69 19 M50 45 V83 M33 57 H67 M33 70 H67'

/**
 * @param {{ rounded: boolean, scale: number }} options
 *   `rounded` for icons shown as-is; platforms that apply their own mask get a
 *   full-bleed square. `scale` shrinks the ¥ about the centre.
 */
function svg({ rounded, scale }) {
  const offset = 50 * (1 - scale)
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    `<rect width="100" height="100"${rounded ? ' rx="20"' : ''} fill="${GREEN}"/>` +
    `<path d="${YEN}" transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${INK}" stroke-width="10"/>` +
    '</svg>\n'
  )
}

/** Browser tabs, Android launchers that show the icon unmasked. */
const ROUNDED = svg({ rounded: true, scale: 0.78 })
/** iOS rounds the corners itself, and fills transparency with black. */
const FULL_BLEED = svg({ rounded: false, scale: 0.78 })
/** Android masks to anything from a circle to a squircle; the ¥ stays inside the 80% safe zone. */
const MASKABLE = svg({ rounded: false, scale: 0.62 })

/**
 * An ICO holding PNG images, which every browser that still asks for
 * `/favicon.ico` reads.
 *
 * @param {{ size: number, data: Buffer }[]} images
 */
function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)

  const directory = Buffer.alloc(16 * images.length)
  let offset = header.length + directory.length
  images.forEach(({ size, data }, index) => {
    const at = index * 16
    directory.writeUInt8(size, at)
    directory.writeUInt8(size, at + 1)
    directory.writeUInt16LE(1, at + 4) // colour planes
    directory.writeUInt16LE(32, at + 6) // bits per pixel
    directory.writeUInt32LE(data.length, at + 8)
    directory.writeUInt32LE(offset, at + 12)
    offset += data.length
  })

  return Buffer.concat([header, directory, ...images.map((image) => image.data)])
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })

  /** @param {string} markup @param {number} size */
  const render = async (markup, size) => {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
    )
    return page.screenshot({ type: 'png', omitBackground: true })
  }

  await mkdir('public/icons', { recursive: true })
  await writeFile('public/favicon.svg', ROUNDED)
  await writeFile('public/icons/icon-192.png', await render(ROUNDED, 192))
  await writeFile('public/icons/icon-512.png', await render(ROUNDED, 512))
  await writeFile('public/icons/icon-maskable-512.png', await render(MASKABLE, 512))
  await writeFile('public/icons/apple-touch-icon.png', await render(FULL_BLEED, 180))
  // One size at a time: every render resizes the same page, so concurrent
  // renders screenshot each other's viewport.
  const favicons = []
  for (const size of [16, 32, 48]) favicons.push({ size, data: await render(ROUNDED, size) })
  await writeFile('public/favicon.ico', ico(favicons))
} finally {
  await browser.close()
}

console.log('[icons] wrote public/favicon.svg, public/favicon.ico and public/icons/*')
