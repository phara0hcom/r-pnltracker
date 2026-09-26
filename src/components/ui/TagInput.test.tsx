import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { TagInput, withDraft } from './TagInput'

function Harness({ initial, onTags }: { initial: string[]; onTags?: (tags: string[]) => void }) {
  const [tags, setTags] = useState(initial)
  const [draft, setDraft] = useState('')
  return (
    <>
      <span id="tags-label">Tags</span>
      <TagInput
        tags={tags}
        draft={draft}
        onChange={(next) => {
          setTags(next)
          onTags?.(next)
        }}
        onDraftChange={setDraft}
        labelledBy="tags-label"
      />
    </>
  )
}

describe('withDraft', () => {
  it('adds what is still being typed, trimmed and without repeats', () => {
    expect(withDraft(['plan-followed'], ' gap-up , plan-followed,')).toEqual(['plan-followed', 'gap-up'])
    expect(withDraft(['a'], '   ')).toEqual(['a'])
  })
})

describe('TagInput', () => {
  it('turns Enter and a comma into chips', () => {
    let latest: string[] = []
    render(<Harness initial={[]} onTags={(tags) => (latest = tags)} />)
    const input = screen.getByRole('textbox', { name: 'Tags' })
    fireEvent.change(input, { target: { value: 'late-exit' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'sizing,' } })
    expect(latest).toEqual(['late-exit', 'sizing'])
    expect(screen.getByRole('button', { name: 'Remove tag sizing' })).toBeDefined()
  })

  it('removes a chip by its own button', () => {
    let latest: string[] = []
    render(<Harness initial={['a', 'b']} onTags={(tags) => (latest = tags)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag a' }))
    expect(latest).toEqual(['b'])
  })

  it('takes the last chip back into the field on Backspace', () => {
    render(<Harness initial={['a', 'b']} />)
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Tags' })
    fireEvent.keyDown(input, { key: 'Backspace' })
    expect(input.value).toBe('b')
    expect(screen.queryByRole('button', { name: 'Remove tag b' })).toBeNull()
  })
})
