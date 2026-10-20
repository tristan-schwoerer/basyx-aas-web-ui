/**
 * Vertical layout of one AIMC route.
 *
 * A route is drawn in lanes (the request lane, and below it the reply lane of
 * a bi-directional route). Each lane has three columns — sources, the
 * transformation, sinks — and every column is centered on the lane's midline,
 * so a transformation always sits level with the middle of its endpoints no
 * matter how many sources and sinks it has, or how tall each node renders.
 *
 * The layout is pure: it takes the node heights (measured by Vue Flow once the
 * nodes have rendered) and returns the top edge of every node and the extent
 * of every group frame. x positions are fixed per column and stay with the
 * caller.
 */

/** A node in a column; endpoints sharing a `group` are framed together. */
export interface AimcLayoutItem {
  id: string
  group?: string
  /** Space above this node, instead of the row gap; e.g. where a column's reply part begins. */
  gapBefore?: number
}

/** A lane is a list of columns, left to right; a column lists its nodes top to bottom. */
export type AimcLayoutLane = AimcLayoutItem[][]

export interface AimcLayoutResult {
  /** Top edge of every node. */
  top: Map<string, number>
  /** Vertical extent of every group frame. */
  frames: Map<string, { top: number, height: number }>
  /** Lane midlines, top to bottom. */
  midlines: number[]
  /** Total height of the drawing, frames included; it starts at 0. */
  height: number
}

/** Vertical gap between two nodes of a column. */
export const AIMC_ROW_GAP = 24
/** Gap between the bottom of one lane and the top of the next. */
export const AIMC_LANE_GAP = 56
/** Space below the last node of a group frame. */
export const AIMC_GROUP_PAD_BOTTOM = 14

interface StackedColumn {
  /** Node tops relative to the column's node-extent center. */
  tops: Map<string, number>
  frames: Map<string, { top: number, bottom: number }>
  /** Outer extent, frames included, relative to the center. */
  extentTop: number
  extentBottom: number
}

/**
 * Keeps the members of a group contiguous (in order of first appearance), so
 * a group is drawn as one frame instead of being split by other endpoints.
 */
function contiguousByGroup (items: AimcLayoutItem[]): AimcLayoutItem[] {
  const buckets = new Map<string, AimcLayoutItem[]>()
  for (const item of items) {
    const key = item.group ?? `\u0000${item.id}`
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(item)
    } else {
      buckets.set(key, [item])
    }
  }
  return [...buckets.values()].flat()
}

function stackColumn (
  items: AimcLayoutItem[],
  heightOf: (id: string) => number,
  groupPadTop: (group: string) => number,
): StackedColumn {
  const absolute = new Map<string, number>()
  const frames = new Map<string, { top: number, bottom: number }>()
  let cursor = 0
  let firstTop = 0
  let previousGroup: string | undefined

  for (const [index, item] of contiguousByGroup(items).entries()) {
    if (index > 0) {
      cursor += item.gapBefore ?? AIMC_ROW_GAP
      if (previousGroup !== undefined && item.group !== previousGroup) {
        cursor += AIMC_GROUP_PAD_BOTTOM
      }
    }
    if (item.group !== undefined && item.group !== previousGroup) {
      const padTop = groupPadTop(item.group)
      frames.set(item.group, { top: cursor, bottom: cursor })
      cursor += padTop
    }
    if (index === 0) {
      firstTop = cursor
    }
    absolute.set(item.id, cursor)
    cursor += heightOf(item.id)
    if (item.group !== undefined) {
      frames.get(item.group)!.bottom = cursor + AIMC_GROUP_PAD_BOTTOM
    }
    previousGroup = item.group
  }

  // Center on the nodes themselves, not on their frames: a frame's label strip
  // makes it taller at the top, and the edges connect to the nodes.
  const center = (firstTop + cursor) / 2
  const tops = new Map([...absolute].map(([id, top]) => [id, top - center]))
  const relativeFrames = new Map([...frames].map(([group, frame]) => [
    group,
    { top: frame.top - center, bottom: frame.bottom - center },
  ]))
  const frameTops = [...relativeFrames.values()].map(frame => frame.top)
  const frameBottoms = [...relativeFrames.values()].map(frame => frame.bottom)

  return {
    tops,
    frames: relativeFrames,
    extentTop: Math.min(firstTop - center, ...frameTops),
    extentBottom: Math.max(cursor - center, ...frameBottoms),
  }
}

/**
 * Lays out the lanes of a route.
 *
 * @param lanes the lanes, top to bottom; empty columns and lanes are skipped.
 * @param heightOf the rendered height of a node.
 * @param groupPadTop the space a group frame needs above its first node (its label strip).
 */
export function layoutAimcGraph (
  lanes: AimcLayoutLane[],
  heightOf: (id: string) => number,
  groupPadTop: (group: string) => number,
): AimcLayoutResult {
  const top = new Map<string, number>()
  const frames = new Map<string, { top: number, height: number }>()
  const midlines: number[] = []
  let laneTop = 0
  let height = 0

  for (const lane of lanes) {
    const columns = lane
      .filter(column => column.length > 0)
      .map(column => stackColumn(column, heightOf, groupPadTop))
    if (columns.length === 0) {
      continue
    }
    const above = Math.max(...columns.map(column => -column.extentTop))
    const below = Math.max(...columns.map(column => column.extentBottom))
    const midline = laneTop + above

    for (const column of columns) {
      for (const [id, relative] of column.tops) {
        top.set(id, midline + relative)
      }
      for (const [group, frame] of column.frames) {
        frames.set(group, { top: midline + frame.top, height: frame.bottom - frame.top })
      }
    }
    midlines.push(midline)
    height = midline + below
    laneTop = height + AIMC_LANE_GAP
  }

  return { top, frames, midlines, height }
}

/**
 * Where the `rank`-th of `count` connection points on one side of a node
 * sits, as a share of the node's height: evenly spaced and centered, so one
 * point is in the middle, two are at 1/3 and 2/3, and so on. Every node side
 * in the graph follows this rule.
 */
export function handleShare (rank: number, count: number): number {
  return (rank + 1) / (count + 1)
}
