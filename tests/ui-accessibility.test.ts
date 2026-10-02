import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { OutingBuilder } from '../src/ui/OutingBuilder'
import { initialForm } from '../src/ui/planningState'
import { fixture } from './helpers'

describe('outing validation announcements', () => {
  it('keeps every invalid choice described by its own visible error with the tray closed', () => {
    const dataset = fixture()
    const html = renderToStaticMarkup(createElement(OutingBuilder, {
      dataset,
      state: { ...initialForm(dataset), durationMin: NaN, budgetInr: NaN, previewAt: 'invalid' },
      onChange: () => {},
      durationError: 'Choose between 30 and 90 minutes.',
      budgetError: 'Choose a budget between ₹0 and ₹100,000.',
      previewError: 'Choose a valid date and time.',
    }))
    for (const [editor, message] of [
      ['duration', 'Choose between 30 and 90 minutes.'],
      ['budget', 'Choose a budget between ₹0 and ₹100,000.'],
      ['options', 'Preview time: Choose a valid date and time.'],
    ]) {
      const id = html.match(new RegExp(`aria-describedby="([^"]+-${editor}-error)"`))?.[1]
      expect(id).toBeDefined()
      expect(html).toContain(`id="${id}" role="alert">${message}</p>`)
    }
  })
})
