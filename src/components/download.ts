/**
 * Hand the browser a file.
 *
 * Lives here rather than in `lib` because it touches the DOM: `lib` is pure and
 * testable without a browser, and one import of `document` from there would end
 * that.
 */
export function downloadTextFile(filename: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  // Firefox only dispatches the click for a link that is in the document.
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoked on the next tick, not inline: Safari reads the object URL after the
  // click handler returns, and tearing it down synchronously yields an empty
  // file there.
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}
