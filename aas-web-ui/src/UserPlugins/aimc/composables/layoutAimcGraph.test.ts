import { describe, expect, it } from 'vitest'
import { AIMC_GROUP_PAD_BOTTOM, AIMC_LANE_GAP, AIMC_ROW_GAP, AIMC_SECTION_HEIGHT, handleShare, layoutAimcGraph } from './layoutAimcGraph'

const heights: Record<string, number> = {
  s0: 70,
  s1: 70,
  s2: 90,
  t: 110,
  r: 110,
  k0: 70,
}
const heightOf = (id: string): number => heights[id] ?? 70
const noPad = (): number => 0
const centerOf = (top: Map<string, number>, id: string): number => top.get(id)! + heightOf(id) / 2

describe('layoutAimcGraph', () => {
  it('centers a single source, a taller transformation and a single sink on one midline', () => {
    const { top, midlines } = layoutAimcGraph([[[{ id: 's0' }], [{ id: 't' }], [{ id: 'k0' }]]], heightOf, noPad)
    expect(centerOf(top, 's0')).toBe(midlines[0])
    expect(centerOf(top, 't')).toBe(midlines[0])
    expect(centerOf(top, 'k0')).toBe(midlines[0])
  })

  it('centers the transformation on a fan-in of nodes with different heights', () => {
    const { top, midlines } = layoutAimcGraph(
      [[[{ id: 's0' }, { id: 's1' }, { id: 's2' }], [{ id: 't' }], [{ id: 'k0' }]]],
      heightOf,
      noPad,
    )
    const columnTop = top.get('s0')!
    const columnBottom = top.get('s2')! + heightOf('s2')
    expect(top.get('s1')! - (top.get('s0')! + heightOf('s0'))).toBe(AIMC_ROW_GAP)
    expect((columnTop + columnBottom) / 2).toBe(midlines[0])
    expect(centerOf(top, 't')).toBe(midlines[0])
    expect(centerOf(top, 'k0')).toBe(midlines[0])
    expect(columnTop).toBe(0)
  })

  it('keeps a group contiguous and leaves room for its label strip', () => {
    const { top, frames } = layoutAimcGraph(
      [[[{ id: 's0', group: 'a' }, { id: 's1' }, { id: 's2', group: 'a' }], [{ id: 't' }], []]],
      heightOf,
      group => (group === 'a' ? 30 : 0),
    )
    const frame = frames.get('a')!
    expect(top.get('s2')!).toBeLessThan(top.get('s1')!)
    expect(top.get('s0')! - frame.top).toBe(30)
    expect(frame.top + frame.height).toBe(top.get('s2')! + heightOf('s2') + AIMC_GROUP_PAD_BOTTOM)
    // Nothing is placed above the top of the graph.
    expect(Math.min(frame.top, ...top.values())).toBe(0)
  })

  it('places the reply lane below the request lane, centered on its own midline', () => {
    const { top, midlines } = layoutAimcGraph(
      [
        [[{ id: 's0' }], [{ id: 't' }], [{ id: 'k0' }]],
        [[], [{ id: 'r' }], []],
      ],
      heightOf,
      noPad,
    )
    expect(midlines).toHaveLength(2)
    expect(top.get('r')!).toBe(top.get('t')! + heightOf('t') + AIMC_LANE_GAP)
    expect(centerOf(top, 'r')).toBe(midlines[1])
  })
})

describe('handleShare', () => {
  it('spaces the connection points of a side evenly around its middle', () => {
    expect(handleShare(0, 1)).toBe(1 / 2)
    expect([0, 1].map(rank => handleShare(rank, 2))).toEqual([1 / 3, 2 / 3])
    expect([0, 1, 2].map(rank => handleShare(rank, 3))).toEqual([1 / 4, 2 / 4, 3 / 4])
  })
})

describe('layoutAimcGraph (request and reply in one lane)', () => {
  it('orders In/Outputs between input and output sections regardless of reference order', () => {
    const { top } = layoutAimcGraph([[[
      { id: 's0', group: 'operation', section: 'In/Outputs' },
      { id: 's1', group: 'operation', section: 'Outputs' },
      { id: 's2', group: 'operation', section: 'Inputs' },
    ]]], heightOf, () => 30)
    expect(top.get('s2')!).toBeLessThan(top.get('s0')!)
    expect(top.get('s0')!).toBeLessThan(top.get('s1')!)
  })

  it('frames inputs and outputs together with room for distinct section labels', () => {
    const { top, frames } = layoutAimcGraph([[[
      { id: 's0', group: 'operation', section: 'Inputs' },
      { id: 's1', group: 'other', section: 'Inputs' },
      { id: 's2', group: 'operation', section: 'Outputs', gapBefore: AIMC_LANE_GAP },
    ]]], heightOf, () => 30)
    const frame = frames.get('operation')!
    expect(frames.size).toBe(2)
    expect(top.get('s0')! - frame.top).toBe(30 + AIMC_SECTION_HEIGHT)
    expect(top.get('s2')! - top.get('s0')! - heightOf('s0'), 'outputs follow inputs at the row gap')
      .toBe(AIMC_ROW_GAP + AIMC_SECTION_HEIGHT)
    expect(frame.top + frame.height).toBe(top.get('s2')! + heightOf('s2') + AIMC_GROUP_PAD_BOTTOM)
    expect(top.get('s1')!).toBeGreaterThan(frame.top + frame.height)
  })

  it('fills a frame with inputs, In/Outputs and outputs at the row gap, a label between sections', () => {
    const { top } = layoutAimcGraph([[[
      { id: 'in', group: 'operation', section: 'Inputs' },
      { id: 'io0', group: 'operation', section: 'In/Outputs' },
      { id: 'io1', group: 'operation', section: 'In/Outputs' },
      { id: 'out', group: 'operation', section: 'Outputs', gapBefore: AIMC_LANE_GAP },
    ]]], heightOf, () => 30)
    const gap = (above: string, below: string): number => top.get(below)! - top.get(above)! - heightOf(above)
    expect(gap('in', 'io0')).toBe(AIMC_ROW_GAP + AIMC_SECTION_HEIGHT)
    expect(gap('io0', 'io1')).toBe(AIMC_ROW_GAP)
    expect(gap('io1', 'out')).toBe(AIMC_ROW_GAP + AIMC_SECTION_HEIGHT)
  })

  it('centers a source and sink serving both directions between the two transformations', () => {
    const { top, midlines } = layoutAimcGraph(
      [[[{ id: 's0' }], [{ id: 't' }, { id: 'r', gapBefore: AIMC_LANE_GAP }], [{ id: 'k0' }]]],
      heightOf,
      noPad,
    )
    expect(top.get('r')!).toBe(top.get('t')! + heightOf('t') + AIMC_LANE_GAP)
    const pairCenter = (top.get('t')! + top.get('r')! + heightOf('r')) / 2
    expect(pairCenter).toBe(midlines[0])
    expect(centerOf(top, 's0')).toBe(midlines[0])
    expect(centerOf(top, 'k0')).toBe(midlines[0])
  })
})
