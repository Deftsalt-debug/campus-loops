import { describe, expect, it } from 'vitest'
import { campusOverviewPaths } from '../src/ui/mapTiles'
import { tinyDataset, twoWay } from './helpers'

describe('saved campus overview', () => {
  it('draws one line per physical path without doubling reverse directions or showing restricted paths', () => {
    const dataset = tinyDataset(['A', 'B', 'C'], [
      ...twoWay('ab', 'A', 'B', 100),
      ...twoWay('bc', 'B', 'C', 100, { allowed: false }),
      ['ac', 'A', 'C', 200],
    ])
    const before = structuredClone(dataset.edges)
    expect(campusOverviewPaths(dataset.edges)).toEqual([
      dataset.edges[0].geometry,
      dataset.edges[4].geometry,
    ])
    expect(dataset.edges).toEqual(before)
  })

  it('keeps a permitted reverse arc when its matching forward arc is restricted', () => {
    const dataset = tinyDataset(['A', 'B'], twoWay('ab', 'A', 'B', 100))
    dataset.edges[0].allowed = false
    expect(campusOverviewPaths(dataset.edges)).toEqual([dataset.edges[1].geometry])
  })

  it('can show an empty overview without a network fallback', () => {
    expect(campusOverviewPaths([])).toEqual([])
  })
})
