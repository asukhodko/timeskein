export const MIN_WORK_AREA_HEIGHT_PX = 260
export const RESERVED_INVENTORY_HEIGHT_PX = 260

export function defaultWorkAreaHeight(viewportHeight: number) {
  return clampWorkAreaHeight(Math.round(viewportHeight * 0.58), viewportHeight)
}

export function clampWorkAreaHeight(height: number, viewportHeight: number) {
  const safeViewportHeight = Number.isFinite(viewportHeight) ? viewportHeight : 720
  const maxHeight = Math.max(
    MIN_WORK_AREA_HEIGHT_PX,
    safeViewportHeight - RESERVED_INVENTORY_HEIGHT_PX
  )
  const safeHeight = Number.isFinite(height) ? Math.round(height) : MIN_WORK_AREA_HEIGHT_PX
  return Math.max(MIN_WORK_AREA_HEIGHT_PX, Math.min(maxHeight, safeHeight))
}
